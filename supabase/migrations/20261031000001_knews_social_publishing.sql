-- K-NEWS Social Publishing (P5): contas Meta por portal, agendamento, envio idempotente
-- e metricas. NAO APLICAR EM PRODUCAO SEM APROVACAO EXPLICITA.
--
-- Principios:
--  * O token de acesso so existe cifrado (AES-256-GCM no servidor, chave fora do banco)
--    e nunca e legivel por authenticated: privilegio por coluna.
--  * Um post por materia e rede (idempotency_key forcada pelo banco).
--  * Envio no maximo uma vez: begin_social_publish trava a linha e marca "publishing";
--    um job retomado que encontra "publishing" nao reenvia, vira "needs_check".
--  * So materia publicada do proprio portal; despublicar cancela o que estiver agendado.

-- 1. Contas -----------------------------------------------------------------------
alter table knews.portal_social_accounts add column if not exists display_name text;
alter table knews.portal_social_accounts add column if not exists status text not null default 'active';
alter table knews.portal_social_accounts add column if not exists last_error text;
alter table knews.portal_social_accounts add column if not exists daily_post_limit int not null default 25;
alter table knews.portal_social_accounts add column if not exists connected_by uuid references auth.users(id) on delete set null;
alter table knews.portal_social_accounts add column if not exists updated_at timestamptz not null default now();

alter table knews.portal_social_accounts drop constraint if exists knews_social_accounts_status;
alter table knews.portal_social_accounts add constraint knews_social_accounts_status check (status in ('active','disabled','expired'));
alter table knews.portal_social_accounts drop constraint if exists knews_social_accounts_limit;
alter table knews.portal_social_accounts add constraint knews_social_accounts_limit check (daily_post_limit between 1 and 100);
alter table knews.portal_social_accounts drop constraint if exists knews_social_accounts_external_id;
alter table knews.portal_social_accounts add constraint knews_social_accounts_external_id check (external_account_id ~ '^[0-9]{5,30}$');
-- Garante que texto puro nunca seja gravado por engano no lugar do token cifrado.
alter table knews.portal_social_accounts drop constraint if exists knews_social_accounts_token_format;
alter table knews.portal_social_accounts add constraint knews_social_accounts_token_format
  check (access_token_encrypted ~ '^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$');

revoke all on knews.portal_social_accounts from authenticated;
grant select (id, portal_id, provider, external_account_id, display_name, status, scopes, expires_at, last_error, daily_post_limit, created_at, updated_at)
  on knews.portal_social_accounts to authenticated;

-- Conectar/reconectar: gestor do portal. O token chega ja cifrado pelo servidor.
create or replace function knews.save_social_account(
  p_portal_id uuid, p_provider text, p_external_account_id text, p_display_name text,
  p_token_encrypted text, p_expires_at timestamptz default null, p_daily_post_limit int default 25
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not knews.can_manage_portal(p_portal_id) then
    raise exception 'somente gestor do portal conecta contas sociais' using errcode = '42501';
  end if;
  insert into knews.portal_social_accounts (portal_id, provider, external_account_id, display_name, access_token_encrypted, expires_at, daily_post_limit, status, last_error, connected_by, updated_at)
  values (p_portal_id, p_provider, p_external_account_id, nullif(btrim(p_display_name), ''), p_token_encrypted, p_expires_at, coalesce(p_daily_post_limit, 25), 'active', null, auth.uid(), now())
  on conflict (portal_id, provider) do update set
    external_account_id = excluded.external_account_id,
    display_name = excluded.display_name,
    access_token_encrypted = excluded.access_token_encrypted,
    expires_at = excluded.expires_at,
    daily_post_limit = excluded.daily_post_limit,
    status = 'active', last_error = null, connected_by = auth.uid(), updated_at = now()
  returning id into v_id;
  insert into knews.audit_logs (portal_id, actor_id, action, target_type, target_id, meta)
  values (p_portal_id, auth.uid(), 'social_account.connect', 'social_account', v_id::text, jsonb_build_object('provider', p_provider, 'external_account_id', p_external_account_id));
  return v_id;
end;
$$;
revoke all on function knews.save_social_account(uuid, text, text, text, text, timestamptz, int) from public, anon;
grant execute on function knews.save_social_account(uuid, text, text, text, text, timestamptz, int) to authenticated, service_role;

create or replace function knews.set_social_account_status(p_account_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_portal uuid;
begin
  select portal_id into v_portal from knews.portal_social_accounts where id = p_account_id;
  if v_portal is null or not knews.can_manage_portal(v_portal) then
    raise exception 'somente gestor do portal altera contas sociais' using errcode = '42501';
  end if;
  if p_status not in ('active','disabled') then raise exception 'status invalido: %', p_status; end if;
  update knews.portal_social_accounts set status = p_status, updated_at = now() where id = p_account_id;
  insert into knews.audit_logs (portal_id, actor_id, action, target_type, target_id, meta)
  values (v_portal, auth.uid(), 'social_account.status', 'social_account', p_account_id::text, jsonb_build_object('status', p_status));
end;
$$;
revoke all on function knews.set_social_account_status(uuid, text) from public, anon;
grant execute on function knews.set_social_account_status(uuid, text) to authenticated, service_role;

-- 2. Posts ------------------------------------------------------------------------
alter table knews.social_posts add column if not exists account_id uuid references knews.portal_social_accounts(id) on delete set null;
alter table knews.social_posts add column if not exists message text not null default '';
alter table knews.social_posts add column if not exists link_url text;
alter table knews.social_posts add column if not exists image_url text;
alter table knews.social_posts add column if not exists image_rights_confirmed boolean not null default false;
alter table knews.social_posts add column if not exists revision int not null default 1;
alter table knews.social_posts add column if not exists attempts int not null default 0;
alter table knews.social_posts add column if not exists ig_container_id text;
alter table knews.social_posts add column if not exists permalink text;
alter table knews.social_posts add column if not exists published_at timestamptz;
alter table knews.social_posts add column if not exists metrics jsonb not null default '{}'::jsonb;
alter table knews.social_posts add column if not exists metrics_updated_at timestamptz;
alter table knews.social_posts add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table knews.social_posts add column if not exists updated_at timestamptz not null default now();

-- Linhas antigas (tabela criada na Fase E, sem uso) se ajustam ao novo modelo.
update knews.social_posts set status = 'scheduled' where status = 'pending';
update knews.social_posts set message = coalesce(nullif(payload->>'message', ''), '(sem texto)') where message = '';
alter table knews.social_posts drop constraint if exists social_posts_status_check;
alter table knews.social_posts add constraint social_posts_status_check
  check (status in ('scheduled','publishing','published','failed','needs_check','cancelled'));
alter table knews.social_posts alter column status set default 'scheduled';
alter table knews.social_posts drop constraint if exists knews_social_posts_message;
alter table knews.social_posts add constraint knews_social_posts_message check (char_length(message) between 1 and 2200);
alter table knews.social_posts drop constraint if exists knews_social_posts_urls;
alter table knews.social_posts add constraint knews_social_posts_urls
  check ((link_url is null or link_url ~ '^https://[^\s]+$') and (image_url is null or image_url ~ '^https://[^\s]+$'));

create index if not exists idx_knews_social_posts_due on knews.social_posts(scheduled_at) where status = 'scheduled';
create index if not exists idx_knews_social_posts_account_published on knews.social_posts(account_id, published_at) where status = 'published';
create index if not exists idx_knews_social_posts_article on knews.social_posts(article_id);

revoke all on knews.social_posts from authenticated;
grant select on knews.social_posts to authenticated;
grant insert (portal_id, article_id, provider, message, link_url, image_url, image_rights_confirmed, scheduled_at) on knews.social_posts to authenticated;
grant update (message, image_url, image_rights_confirmed, scheduled_at, status) on knews.social_posts to authenticated;

drop policy if exists knews_social_posts_insert on knews.social_posts;
create policy knews_social_posts_insert on knews.social_posts for insert to authenticated with check (knews.can_edit_portal(portal_id));
drop policy if exists knews_social_posts_update on knews.social_posts;
create policy knews_social_posts_update on knews.social_posts for update to authenticated
  using (knews.can_edit_portal(portal_id)) with check (knews.can_edit_portal(portal_id));

-- Regras de negocio para qualquer caminho de escrita. Pessoas (auth.uid() presente)
-- so agendam, editam enquanto agendado, cancelam e reagendam; o resto e do worker.
create or replace function knews.guard_social_post()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_human boolean := auth.uid() is not null;
  v_article record;
  v_account record;
  v_validate boolean := false;
begin
  if tg_op = 'INSERT' then
    new.status := 'scheduled';
    new.idempotency_key := 'article:' || coalesce(new.article_id::text, '') || ':' || new.provider;
    new.created_by := auth.uid();
    new.revision := 1;
    new.attempts := 0;
    new.scheduled_at := coalesce(new.scheduled_at, now());
    v_validate := true;
  elsif v_human then
    if new.status is distinct from old.status then
      if not ((old.status = 'scheduled' and new.status = 'cancelled')
              or (old.status in ('failed','cancelled','needs_check') and new.status = 'scheduled')) then
        raise exception 'transicao de post nao permitida: % -> %', old.status, new.status using errcode = '42501';
      end if;
    elsif new.status <> 'scheduled'
          and (new.message, new.image_url, new.image_rights_confirmed, new.scheduled_at)
              is distinct from (old.message, old.image_url, old.image_rights_confirmed, old.scheduled_at) then
      raise exception 'post so pode ser editado enquanto agendado' using errcode = '42501';
    end if;
    if new.status = 'scheduled' then
      -- Nova revisao invalida qualquer job antigo deste post.
      new.revision := old.revision + 1;
      new.last_error := null;
      if old.status <> 'scheduled' then new.attempts := 0; end if;
      v_validate := true;
    end if;
  end if;

  if v_validate then
    select a.id, a.portal_id, a.status into v_article from knews.articles a where a.id = new.article_id;
    if v_article.id is null or v_article.portal_id <> new.portal_id then
      raise exception 'materia nao pertence ao portal';
    end if;
    if v_article.status <> 'published' then
      raise exception 'so materia publicada pode ser distribuida nas redes';
    end if;
    select s.id, s.status into v_account from knews.portal_social_accounts s where s.portal_id = new.portal_id and s.provider = new.provider;
    if v_account.id is null or v_account.status <> 'active' then
      raise exception 'conta % do portal nao conectada ou inativa', new.provider;
    end if;
    new.account_id := v_account.id;
    if new.provider = 'instagram' and (new.image_url is null or not new.image_rights_confirmed) then
      raise exception 'instagram exige imagem https com direito de uso confirmado';
    end if;
    if new.image_url is not null and not new.image_rights_confirmed then
      raise exception 'confirme o direito de uso da imagem';
    end if;
    if v_human and (new.scheduled_at < now() - interval '5 minutes' or new.scheduled_at > now() + interval '60 days') then
      raise exception 'horario de envio deve estar entre agora e 60 dias';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;
revoke all on function knews.guard_social_post() from public, anon, authenticated;
drop trigger if exists trg_knews_guard_social_post on knews.social_posts;
create trigger trg_knews_guard_social_post before insert or update on knews.social_posts
  for each row execute function knews.guard_social_post();

-- Despublicar (ou bloquear) a materia cancela o que ainda nao saiu.
create or replace function knews.cancel_social_on_unpublish()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'published' and new.status <> 'published' then
    update knews.social_posts set status = 'cancelled', last_error = 'materia saiu do ar'
    where article_id = new.id and status = 'scheduled';
  end if;
  return new;
end;
$$;
revoke all on function knews.cancel_social_on_unpublish() from public, anon, authenticated;
drop trigger if exists trg_knews_cancel_social_on_unpublish on knews.articles;
create trigger trg_knews_cancel_social_on_unpublish after update of status on knews.articles
  for each row execute function knews.cancel_social_on_unpublish();

-- 3. Fila -------------------------------------------------------------------------
alter table knews.jobs drop constraint if exists jobs_job_type_check;
alter table knews.jobs add constraint jobs_job_type_check
  check (job_type in ('rss_fetch','normalize','classify','draft','publish','social_publish','social_metrics','ad_serve','affiliate_sync','research'));

create or replace function knews.enqueue_due_social_posts()
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int := 0; v_post record;
begin
  for v_post in
    select sp.id, sp.portal_id, sp.revision from knews.social_posts sp
    join knews.portals p on p.id = sp.portal_id
    where sp.status = 'scheduled' and sp.scheduled_at <= now() and p.status = 'active'
    order by sp.scheduled_at limit 200
  loop
    perform knews.enqueue_job(v_post.portal_id, 'social_publish', jsonb_build_object('post_id', v_post.id, 'revision', v_post.revision),
      'social_publish:' || v_post.id || ':' || v_post.revision, 90);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function knews.enqueue_due_social_posts() from public, anon, authenticated;
grant execute on function knews.enqueue_due_social_posts() to service_role;

create or replace function knews.enqueue_due_social_metrics()
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int := 0; v_post record; v_window bigint := floor(extract(epoch from now()) / 21600)::bigint;
begin
  for v_post in
    select id, portal_id from knews.social_posts
    where status = 'published' and external_post_id is not null and published_at > now() - interval '14 days'
      and (metrics_updated_at is null or metrics_updated_at < now() - interval '6 hours')
    limit 200
  loop
    perform knews.enqueue_job(v_post.portal_id, 'social_metrics', jsonb_build_object('post_id', v_post.id),
      'social_metrics:' || v_post.id || ':' || v_window, 200, now(), 3);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function knews.enqueue_due_social_metrics() from public, anon, authenticated;
grant execute on function knews.enqueue_due_social_metrics() to service_role;

-- Reivindica o envio de um post. Uma unica transacao trava a linha, revalida tudo e
-- marca "publishing" antes de qualquer chamada externa.
create or replace function knews.begin_social_publish(p_post_id uuid, p_revision int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_post knews.social_posts%rowtype;
  v_account knews.portal_social_accounts%rowtype;
  v_article_status text;
  v_sent_24h int;
begin
  select * into v_post from knews.social_posts where id = p_post_id for update;
  if v_post.id is null then return jsonb_build_object('skip', 'post nao encontrado'); end if;
  if v_post.status = 'publishing' then
    -- Job anterior caiu depois de chamar a Meta ou antes de gravar o resultado:
    -- nao da para saber se saiu. Nunca reenviar sozinho.
    update knews.social_posts set status = 'needs_check', last_error = 'envio interrompido: confira a pagina antes de reagendar' where id = p_post_id;
    return jsonb_build_object('skip', 'resultado incerto');
  end if;
  if v_post.status <> 'scheduled' or v_post.revision <> p_revision then
    return jsonb_build_object('skip', 'post ' || v_post.status || ' ou revisao nova');
  end if;
  select status into v_article_status from knews.articles where id = v_post.article_id;
  if v_article_status is distinct from 'published' then
    update knews.social_posts set status = 'cancelled', last_error = 'materia saiu do ar' where id = p_post_id;
    return jsonb_build_object('skip', 'materia nao publicada');
  end if;
  select * into v_account from knews.portal_social_accounts where id = v_post.account_id;
  if v_account.id is null or v_account.status <> 'active' then
    update knews.social_posts set status = 'failed', last_error = 'conta desconectada ou inativa' where id = p_post_id;
    return jsonb_build_object('skip', 'conta inativa');
  end if;
  select count(*) into v_sent_24h from knews.social_posts
  where account_id = v_account.id and status in ('published','publishing') and coalesce(published_at, updated_at) > now() - interval '24 hours';
  if v_sent_24h >= v_account.daily_post_limit then
    update knews.social_posts set scheduled_at = now() + interval '1 hour', revision = revision + 1,
      last_error = 'limite diario da conta atingido; reagendado' where id = p_post_id;
    return jsonb_build_object('deferred', true);
  end if;
  update knews.social_posts set status = 'publishing', attempts = attempts + 1 where id = p_post_id;
  return jsonb_build_object(
    'post_id', v_post.id, 'portal_id', v_post.portal_id, 'provider', v_post.provider,
    'message', v_post.message, 'link_url', v_post.link_url, 'image_url', v_post.image_url,
    'ig_container_id', v_post.ig_container_id, 'attempts', v_post.attempts + 1,
    'account_id', v_account.id, 'external_account_id', v_account.external_account_id,
    'token', v_account.access_token_encrypted
  );
end;
$$;
revoke all on function knews.begin_social_publish(uuid, int) from public, anon, authenticated;
grant execute on function knews.begin_social_publish(uuid, int) to service_role;

-- Leitura do painel: resumo de metricas por rede no portal.
create or replace function knews.social_summary(p_portal_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not knews.can_read_portal(p_portal_id) then null else coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) end
  from (
    select provider,
      count(*) filter (where status = 'published') as published,
      count(*) filter (where status = 'scheduled') as scheduled,
      count(*) filter (where status in ('failed','needs_check')) as attention,
      coalesce(sum(coalesce((metrics->>'reactions')::int, 0)) filter (where status = 'published'), 0) as reactions,
      coalesce(sum(coalesce((metrics->>'comments')::int, 0)) filter (where status = 'published'), 0) as comments,
      coalesce(sum(coalesce((metrics->>'shares')::int, 0)) filter (where status = 'published'), 0) as shares,
      coalesce(sum(coalesce((metrics->>'reach')::int, 0)) filter (where status = 'published'), 0) as reach
    from knews.social_posts where portal_id = p_portal_id group by provider
  ) t;
$$;
revoke all on function knews.social_summary(uuid) from public, anon;
grant execute on function knews.social_summary(uuid) to authenticated, service_role;
