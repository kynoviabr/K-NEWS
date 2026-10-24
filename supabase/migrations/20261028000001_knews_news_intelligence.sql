-- K-NEWS News Intelligence ponta a ponta — fontes, intake deduplicado, rascunhos,
-- claims, revisao humana, publicacao/despublicacao e leitura publica do portal.
-- NAO APLICAR EM PRODUCAO SEM APROVACAO EXPLICITA

-- ---------------------------------------------------------------------------
-- Fontes gerenciaveis
-- ---------------------------------------------------------------------------
alter table knews.sources add column if not exists name text;
alter table knews.sources add column if not exists fetch_interval_minutes int not null default 60
  check (fetch_interval_minutes between 5 and 1440);
alter table knews.sources add column if not exists last_fetched_at timestamptz;
alter table knews.sources add column if not exists last_status text check (last_status is null or last_status in ('success','failed','skipped'));
alter table knews.sources add column if not exists last_error text;
alter table knews.sources add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table knews.sources add column if not exists updated_at timestamptz not null default now();
create unique index if not exists uq_knews_sources_portal_url on knews.sources(coalesce(portal_id::text, ''), url);
create trigger update_knews_sources_updated_at before update on knews.sources for each row execute function knews.update_updated_at_column();

-- Fonte de rede (portal_id null) somente super_admin; de portal, editores do portal.
create policy knews_sources_write on knews.sources for all to authenticated
  using (case when portal_id is null then knews.is_super_admin() else knews.can_edit_portal(portal_id) end)
  with check (case when portal_id is null then knews.is_super_admin() else knews.can_edit_portal(portal_id) end);

-- ---------------------------------------------------------------------------
-- Intake: itens coletados, deduplicados por portal
-- ---------------------------------------------------------------------------
create table if not exists knews.source_items (
  id uuid primary key default gen_random_uuid(),
  portal_id uuid not null references knews.portals(id) on delete cascade,
  source_id uuid not null references knews.sources(id) on delete cascade,
  dedup_key text not null,
  title_fingerprint text not null,
  url text not null,
  canonical_url text,
  title text not null,
  summary text,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new','drafting','drafted','discarded','duplicate')),
  discard_reason text,
  duplicate_of uuid references knews.source_items(id) on delete set null,
  article_id uuid references knews.articles(id) on delete set null,
  unique (portal_id, dedup_key)
);
create index if not exists idx_knews_source_items_fingerprint on knews.source_items(portal_id, title_fingerprint, fetched_at desc);
create index if not exists idx_knews_source_items_status on knews.source_items(portal_id, status, fetched_at desc);

alter table knews.source_items enable row level security;
revoke all on knews.source_items from anon;
grant select on knews.source_items to authenticated;
grant all on knews.source_items to service_role;
create policy knews_source_items_select on knews.source_items for select to authenticated using (knews.can_read_portal(portal_id));

-- Ingestao atomica: o ledger knews.processed_canonicals garante que a mesma URL
-- canonica nunca gera dois itens no portal, mesmo com workers concorrentes ou
-- depois de limpeza de source_items. Mesmo titulo normalizado em 72h vira duplicata.
create or replace function knews.ingest_source_items(p_source_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source knews.sources%rowtype;
  v_item jsonb;
  v_inserted int := 0;
  v_duplicates int := 0;
  v_near int := 0;
  v_new_ids uuid[] := '{}';
  v_id uuid;
  v_dup uuid;
begin
  select * into v_source from knews.sources where id = p_source_id;
  if not found then raise exception 'fonte nao encontrada' using errcode = 'P0002'; end if;
  if v_source.portal_id is null then raise exception 'fonte sem portal nao gera intake' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'p_items deve ser array' using errcode = '22023'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into knews.processed_canonicals (portal_id, dedup_key)
    values (v_source.portal_id, v_item->>'dedup_key')
    on conflict do nothing;
    if not found then
      v_duplicates := v_duplicates + 1;
      continue;
    end if;

    select si.id into v_dup from knews.source_items si
    where si.portal_id = v_source.portal_id
      and si.title_fingerprint = v_item->>'title_fingerprint'
      and si.fetched_at > now() - interval '72 hours'
      and si.status <> 'duplicate'
    order by si.fetched_at asc limit 1;

    insert into knews.source_items (portal_id, source_id, dedup_key, title_fingerprint, url, canonical_url, title, summary, published_at, status, duplicate_of)
    values (
      v_source.portal_id, p_source_id, v_item->>'dedup_key', v_item->>'title_fingerprint', v_item->>'url',
      nullif(v_item->>'canonical_url', ''), v_item->>'title', nullif(v_item->>'summary', ''),
      (nullif(v_item->>'published_at', ''))::timestamptz,
      case when v_dup is null then 'new' else 'duplicate' end, v_dup
    )
    returning id into v_id;

    if v_dup is null then
      v_inserted := v_inserted + 1;
      v_new_ids := array_append(v_new_ids, v_id);
    else
      v_near := v_near + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'duplicates', v_duplicates, 'near_duplicates', v_near, 'new_item_ids', to_jsonb(v_new_ids));
end;
$$;
revoke all on function knews.ingest_source_items(uuid, jsonb) from public, anon, authenticated;
grant execute on function knews.ingest_source_items(uuid, jsonb) to service_role;

-- Enfileiramento idempotente (retorna o job existente quando a chave se repete)
create or replace function knews.enqueue_job(
  p_portal_id uuid, p_job_type text, p_payload jsonb, p_idempotency_key text default null,
  p_priority int default 100, p_scheduled_at timestamptz default now(), p_max_attempts int default 5
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  insert into knews.jobs (portal_id, job_type, payload, idempotency_key, priority, scheduled_at, max_attempts)
  values (p_portal_id, p_job_type, coalesce(p_payload, '{}'::jsonb), p_idempotency_key, p_priority, coalesce(p_scheduled_at, now()), p_max_attempts)
  on conflict (portal_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from knews.jobs where portal_id is not distinct from p_portal_id and idempotency_key = p_idempotency_key;
  end if;
  return v_id;
end;
$$;
revoke all on function knews.enqueue_job(uuid, text, jsonb, text, int, timestamptz, int) from public, anon, authenticated;
grant execute on function knews.enqueue_job(uuid, text, jsonb, text, int, timestamptz, int) to service_role;

-- Chamado pelo agendador: uma coleta por fonte vencida, idempotente por janela.
create or replace function knews.enqueue_due_source_fetches()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_count int := 0; v_source record;
begin
  for v_source in
    select s.id, s.portal_id, s.fetch_interval_minutes from knews.sources s
    join knews.portals p on p.id = s.portal_id
    where s.enabled and s.kind = 'rss' and p.status = 'active'
      and (s.last_fetched_at is null or s.last_fetched_at < now() - make_interval(mins => s.fetch_interval_minutes))
  loop
    perform knews.enqueue_job(
      v_source.portal_id, 'rss_fetch', jsonb_build_object('source_id', v_source.id),
      'rss_fetch:' || v_source.id || ':' || floor(extract(epoch from now()) / (v_source.fetch_interval_minutes * 60))::bigint
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function knews.enqueue_due_source_fetches() from public, anon, authenticated;
grant execute on function knews.enqueue_due_source_fetches() to service_role;

-- ---------------------------------------------------------------------------
-- Artigos: origem, territorio, IA, revisao humana, despublicacao
-- ---------------------------------------------------------------------------
alter table knews.articles drop constraint if exists articles_status_check;
alter table knews.articles add constraint articles_status_check
  check (status in ('draft','reviewing','ready','scheduled','published','unpublished','blocked','archived'));
alter table knews.articles add column if not exists source_item_id uuid references knews.source_items(id) on delete set null;
alter table knews.articles add column if not exists city_id uuid references knews.cities(id) on delete set null;
alter table knews.articles add column if not exists neighborhood_id uuid references knews.neighborhoods(id) on delete set null;
alter table knews.articles add column if not exists category text;
alter table knews.articles add column if not exists ai_provider text;
alter table knews.articles add column if not exists ai_model text;
alter table knews.articles add column if not exists reviewed_by uuid references auth.users(id) on delete set null;
alter table knews.articles add column if not exists reviewed_at timestamptz;
alter table knews.articles add column if not exists unpublished_at timestamptz;
alter table knews.articles add column if not exists unpublish_reason text;
alter table knews.articles add column if not exists version int not null default 1;
create unique index if not exists uq_knews_articles_source_item on knews.articles(source_item_id) where source_item_id is not null;
create index if not exists idx_knews_articles_portal_published on knews.articles(portal_id, published_at desc) where status = 'published';

-- Kill switch persistente por portal (o lib/kill-switch em memoria nao sobrevive a serverless)
alter table knews.portals add column if not exists publishing_enabled boolean not null default true;

create table if not exists knews.article_claims (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references knews.articles(id) on delete cascade,
  claim text not null,
  kind text not null check (kind in ('factual','quote','opinion')),
  status text not null default 'needs_review' check (status in ('supported','unsupported','needs_review')),
  evidence_id uuid references knews.article_evidences(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_knews_article_claims_article on knews.article_claims(article_id);
alter table knews.article_claims enable row level security;
revoke all on knews.article_claims from anon;
grant select, insert, update, delete on knews.article_claims to authenticated;
grant all on knews.article_claims to service_role;
create policy knews_article_claims_select on knews.article_claims for select to authenticated using (
  exists (select 1 from knews.articles a where a.id = article_id and knews.can_read_portal(a.portal_id))
);
create policy knews_article_claims_write on knews.article_claims for all to authenticated using (
  exists (select 1 from knews.articles a where a.id = article_id and knews.can_edit_portal(a.portal_id))
) with check (
  exists (select 1 from knews.articles a where a.id = article_id and knews.can_edit_portal(a.portal_id))
);

create or replace function knews.can_manage_portal(target_portal_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from knews.portal_members m where m.portal_id = target_portal_id and m.user_id = auth.uid()
                 and m.status = 'active' and m.role in ('super_admin','regional_manager'));
$$;
revoke all on function knews.can_manage_portal(uuid) from public, anon;
grant execute on function knews.can_manage_portal(uuid) to authenticated, service_role;

-- Guarda deterministica de publicacao: vale para TODOS os caminhos (RPC, update
-- direto do editor, service_role). Publicacao exige uma pessoa autenticada.
create or replace function knews.guard_article_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rank_old int;
  v_rank_new int;
begin
  -- Reduzir o risco calculado exige gestor regional ou super_admin.
  if tg_op = 'UPDATE' and new.risk_level is distinct from old.risk_level then
    v_rank_old := array_position(array['low','medium','high','blocked'], old.risk_level);
    v_rank_new := array_position(array['low','medium','high','blocked'], new.risk_level);
    if v_rank_new < v_rank_old and v_uid is not null and not knews.can_manage_portal(new.portal_id) then
      raise exception 'somente gestor regional pode reduzir o risco editorial' using errcode = '42501';
    end if;
  end if;

  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    if v_uid is null then
      raise exception 'publicacao exige revisao humana autenticada' using errcode = '42501';
    end if;
    if not exists (select 1 from knews.portals p where p.id = new.portal_id and p.publishing_enabled and p.status = 'active') then
      raise exception 'publicacao suspensa neste portal (kill switch)' using errcode = 'P0004';
    end if;
    if new.risk_level = 'blocked' then
      raise exception 'artigo com risco bloqueado nao pode ser publicado' using errcode = 'P0004';
    end if;
    if tg_op = 'INSERT' or not exists (select 1 from knews.article_evidences e where e.article_id = new.id) then
      raise exception 'publicacao exige ao menos uma evidencia rastreavel' using errcode = 'P0004';
    end if;
    if exists (select 1 from knews.article_claims c where c.article_id = new.id and c.status <> 'supported') then
      raise exception 'ha afirmacoes sem verificacao humana' using errcode = 'P0004';
    end if;
    if length(trim(new.body)) < 200 then
      raise exception 'texto insuficiente para publicacao' using errcode = 'P0004';
    end if;
    new.reviewed_by := v_uid;
    new.reviewed_at := now();
    new.published_at := coalesce(new.published_at, now());
    new.unpublished_at := null;
    new.unpublish_reason := null;
  end if;
  return new;
end;
$$;
revoke all on function knews.guard_article_publication() from public, anon, authenticated;
drop trigger if exists guard_knews_article_publication on knews.articles;
create trigger guard_knews_article_publication before insert or update on knews.articles
  for each row execute function knews.guard_article_publication();

-- Revisao humana: aprovar (publica), devolver ou rejeitar. Registra decisao, versao e auditoria.
create or replace function knews.review_article(p_article_id uuid, p_decision text, p_note text default null)
returns knews.articles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_article knews.articles%rowtype;
begin
  if v_uid is null then raise exception 'nao autenticado' using errcode = '42501'; end if;
  if p_decision not in ('approve','reject','request_changes') then raise exception 'decisao invalida' using errcode = '22023'; end if;

  select * into v_article from knews.articles where id = p_article_id for update;
  if not found or not knews.can_edit_portal(v_article.portal_id) then
    raise exception 'artigo nao encontrado' using errcode = 'P0002';
  end if;
  if v_article.status not in ('draft','reviewing','ready','blocked','unpublished') then
    raise exception 'artigo em estado % nao pode ser revisado', v_article.status using errcode = 'P0004';
  end if;

  if p_decision = 'approve' then
    -- A aprovacao humana confirma as afirmacoes pendentes, com nota obrigatoria.
    if p_note is null or length(trim(p_note)) < 10 then
      raise exception 'aprovacao exige nota editorial (min. 10 caracteres)' using errcode = '22023';
    end if;
    update knews.article_claims set status = 'supported', note = coalesce(note, p_note)
    where article_id = p_article_id and status = 'needs_review';
    update knews.articles set status = 'published', version = version + 1 where id = p_article_id returning * into v_article;
    insert into knews.article_versions (article_id, version, title, body, excerpt, created_by)
    values (v_article.id, v_article.version, v_article.title, v_article.body, v_article.excerpt, v_uid)
    on conflict (article_id, version) do nothing;
  elsif p_decision = 'reject' then
    update knews.articles set status = 'archived' where id = p_article_id returning * into v_article;
  else
    update knews.articles set status = 'draft' where id = p_article_id returning * into v_article;
  end if;

  insert into knews.editorial_decisions (article_id, risk_level, evidence_quality, blocked_reasons, is_auto_publishable, decided_by)
  values (v_article.id, v_article.risk_level,
          case when exists (select 1 from knews.article_evidences e where e.article_id = v_article.id) then 'weak' else 'none' end,
          jsonb_build_array(jsonb_build_object('decision', p_decision, 'note', p_note)), false, v_uid);
  insert into knews.audit_logs (portal_id, actor_id, action, target_type, target_id, meta)
  values (v_article.portal_id, v_uid, 'article.' || p_decision, 'article', v_article.id::text, jsonb_build_object('note', p_note));
  return v_article;
end;
$$;
revoke all on function knews.review_article(uuid, text, text) from public, anon;
grant execute on function knews.review_article(uuid, text, text) to authenticated;

create or replace function knews.unpublish_article(p_article_id uuid, p_reason text)
returns knews.articles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_article knews.articles%rowtype;
begin
  if v_uid is null then raise exception 'nao autenticado' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) < 10 then
    raise exception 'despublicacao exige motivo (min. 10 caracteres)' using errcode = '22023';
  end if;
  select * into v_article from knews.articles where id = p_article_id for update;
  if not found or not knews.can_edit_portal(v_article.portal_id) then
    raise exception 'artigo nao encontrado' using errcode = 'P0002';
  end if;
  if v_article.status <> 'published' then raise exception 'artigo nao esta publicado' using errcode = 'P0004'; end if;

  update knews.articles set status = 'unpublished', unpublished_at = now(), unpublish_reason = p_reason
  where id = p_article_id returning * into v_article;
  insert into knews.article_corrections (article_id, note) values (p_article_id, 'Retirado do ar: ' || p_reason);
  insert into knews.audit_logs (portal_id, actor_id, action, target_type, target_id, meta)
  values (v_article.portal_id, v_uid, 'article.unpublish', 'article', v_article.id::text, jsonb_build_object('reason', p_reason));
  return v_article;
end;
$$;
revoke all on function knews.unpublish_article(uuid, text) from public, anon;
grant execute on function knews.unpublish_article(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Leitura publica do portal: schema knews_public exposto ao anon, somente funcoes
-- SECURITY DEFINER que devolvem conteudo publicado. O schema knews continua
-- inacessivel ao anon.
-- ---------------------------------------------------------------------------
create schema if not exists knews_public;
revoke all on schema knews_public from public;
grant usage on schema knews_public to anon, authenticated, service_role;

create or replace function knews_public.portal_by_host(p_host text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with h as (select lower(split_part(coalesce(p_host, ''), ':', 1)) as host),
  found as (
    select p.* from knews.portals p join knews.portal_domains d on d.portal_id = p.id, h where d.domain = h.host
    union all
    select p.* from knews.portals p, h where h.host like '%.portal24h.news' and p.slug = split_part(h.host, '.', 1)
  )
  select jsonb_build_object('id', f.id, 'slug', f.slug, 'name', f.name, 'theme', f.theme, 'seo', f.seo,
                            'city', (select c.name from knews.cities c where c.id = f.city_id))
  from found f where f.status = 'active' limit 1;
$$;

create or replace function knews_public.published_articles(p_portal_id uuid, p_limit int default 20, p_offset int default 0)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(x) order by x.published_at desc), '[]'::jsonb) from (
    select a.slug, a.title, a.excerpt, a.category, a.published_at, a.updated_at
    from knews.articles a join knews.portals p on p.id = a.portal_id
    where a.portal_id = p_portal_id and a.status = 'published' and p.status = 'active'
    order by a.published_at desc
    limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0)
  ) x;
$$;

create or replace function knews_public.published_article(p_portal_id uuid, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'slug', a.slug, 'title', a.title, 'excerpt', a.excerpt, 'body', a.body, 'category', a.category,
    'published_at', a.published_at, 'updated_at', a.updated_at, 'version', a.version,
    'evidences', (select coalesce(jsonb_agg(jsonb_build_object('url', e.source_url, 'label', e.source_label, 'type', e.source_type, 'captured_at', e.captured_at) order by e.captured_at), '[]'::jsonb)
                  from knews.article_evidences e where e.article_id = a.id),
    'corrections', (select coalesce(jsonb_agg(jsonb_build_object('note', c.note, 'at', c.created_at) order by c.created_at), '[]'::jsonb)
                    from knews.article_corrections c where c.article_id = a.id)
  )
  from knews.articles a join knews.portals p on p.id = a.portal_id
  where a.portal_id = p_portal_id and a.slug = p_slug and a.status = 'published' and p.status = 'active';
$$;

revoke all on all functions in schema knews_public from public;
grant execute on function knews_public.portal_by_host(text) to anon, authenticated, service_role;
grant execute on function knews_public.published_articles(uuid, int, int) to anon, authenticated, service_role;
grant execute on function knews_public.published_article(uuid, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Registros sem portal (portal_id null): eram legiveis por QUALQUER autenticado,
-- inclusive usuarios do BLOGGER (jobs, logs de auditoria, fontes, campanhas de
-- rede e derivados). Agora somente super_admin.
-- ---------------------------------------------------------------------------
create or replace function knews.can_read_scope(target_portal_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when target_portal_id is null then knews.is_super_admin() else knews.can_read_portal(target_portal_id) end;
$$;
revoke all on function knews.can_read_scope(uuid) from public, anon;
grant execute on function knews.can_read_scope(uuid) to authenticated, service_role;

drop policy if exists knews_jobs_select on knews.jobs;
create policy knews_jobs_select on knews.jobs for select to authenticated using (knews.can_read_scope(portal_id));
drop policy if exists knews_ad_slots_select on knews.ad_slots;
create policy knews_ad_slots_select on knews.ad_slots for select to authenticated using (knews.can_read_scope(portal_id));
drop policy if exists knews_campaigns_select on knews.ad_campaigns;
create policy knews_campaigns_select on knews.ad_campaigns for select to authenticated using (knews.can_read_scope(portal_id));
drop policy if exists knews_sources_select on knews.sources;
create policy knews_sources_select on knews.sources for select to authenticated using (knews.can_read_scope(portal_id));
drop policy if exists knews_audit_select on knews.audit_logs;
create policy knews_audit_select on knews.audit_logs for select to authenticated using (knews.can_read_scope(portal_id));

drop policy if exists knews_ad_placements_select on knews.ad_campaign_placements;
create policy knews_ad_placements_select on knews.ad_campaign_placements for select to authenticated using (
  exists (select 1 from knews.ad_campaigns c where c.id = campaign_id and knews.can_read_scope(c.portal_id)));
drop policy if exists knews_ad_geo_select on knews.ad_campaign_geo_targets;
create policy knews_ad_geo_select on knews.ad_campaign_geo_targets for select to authenticated using (
  exists (select 1 from knews.ad_campaigns c where c.id = campaign_id and knews.can_read_scope(c.portal_id)));
drop policy if exists knews_creatives_select on knews.ad_creatives;
create policy knews_creatives_select on knews.ad_creatives for select to authenticated using (
  exists (select 1 from knews.ad_campaigns c where c.id = campaign_id and knews.can_read_scope(c.portal_id)));
drop policy if exists knews_reservations_select on knews.ad_reservations;
create policy knews_reservations_select on knews.ad_reservations for select to authenticated using (
  exists (select 1 from knews.ad_campaigns c where c.id = campaign_id and knews.can_read_scope(c.portal_id)));
drop policy if exists knews_events_select on knews.ad_events;
create policy knews_events_select on knews.ad_events for select to authenticated using (
  exists (select 1 from knews.ad_campaigns c where c.id = campaign_id and knews.can_read_scope(c.portal_id)));
drop policy if exists knews_fetch_logs_select on knews.fetch_logs;
create policy knews_fetch_logs_select on knews.fetch_logs for select to authenticated using (
  exists (select 1 from knews.sources s where s.id = source_id and knews.can_read_scope(s.portal_id)));
drop policy if exists knews_job_events_select on knews.job_events;
create policy knews_job_events_select on knews.job_events for select to authenticated using (
  exists (select 1 from knews.jobs j where j.id = job_id and knews.can_read_scope(j.portal_id)));
drop policy if exists knews_ai_costs_select on knews.ai_costs;
create policy knews_ai_costs_select on knews.ai_costs for select to authenticated using (
  case when article_id is null then knews.is_super_admin()
       else exists (select 1 from knews.articles a where a.id = article_id and knews.can_read_portal(a.portal_id)) end);
