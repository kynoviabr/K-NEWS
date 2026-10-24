-- K-NEWS Ad Management & Revenue Center ponta a ponta (ADR-014)
-- NAO APLICAR EM PRODUCAO SEM APROVACAO EXPLICITA
--
-- Antes: o banco tinha campanhas, placements e reserve_ad, mas nenhuma decisao de
-- entrega, nenhum registro de impressao/clique confirmados, nenhum contrato, receita
-- ou link afiliado, e editores de redacao podiam enviar criativos.
--
-- Agora:
--  * papel comercial separado do editorial (can_sell_portal);
--  * contratos, campanhas com targeting por portal/cidade/bairro/categoria/dispositivo,
--    pacing, caps diario/total/frequencia, criativos com aprovacao;
--  * knews.serve_ad decide e reserva numa unica transacao (service_role);
--  * impressao e clique confirmados por token, idempotentes;
--  * fallback: campanha paga -> provedor programatico aprovado -> campanha da casa;
--  * links afiliados/produtos proprios com redirecionamento e contagem de cliques;
--  * receitas (estimadas/confirmadas) e comissao por contrato.

-- 0. Papel comercial ----------------------------------------------------------
create or replace function knews.can_sell_portal(target_portal_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select knews.is_super_admin() or exists (
    select 1 from knews.portal_members m
    where m.portal_id = target_portal_id and m.user_id = auth.uid() and m.status = 'active'
      and m.role in ('regional_manager', 'commercial_partner')
  );
$$;
revoke all on function knews.can_sell_portal(uuid) from public, anon;
grant execute on function knews.can_sell_portal(uuid) to authenticated, service_role;

-- Registro sem portal (escopo de rede) so para super_admin.
create or replace function knews.can_sell_scope(target_portal_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when target_portal_id is null then knews.is_super_admin() else knews.can_sell_portal(target_portal_id) end;
$$;
revoke all on function knews.can_sell_scope(uuid) from public, anon;
grant execute on function knews.can_sell_scope(uuid) to authenticated, service_role;

-- Criativos e campanhas passam a ser responsabilidade comercial, nao da redacao.
create or replace function knews.can_edit_campaign(target_campaign_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from knews.ad_campaigns c
    where c.id = target_campaign_id and knews.can_sell_scope(c.portal_id)
  );
$$;

-- 1. Anunciantes ----------------------------------------------------------------
alter table knews.advertisers add column if not exists portal_id uuid references knews.portals(id) on delete restrict;
alter table knews.advertisers add column if not exists contact_name text;
alter table knews.advertisers add column if not exists contact_email text;
alter table knews.advertisers add column if not exists contact_phone text;
alter table knews.advertisers add column if not exists status text not null default 'active' check (status in ('active', 'inactive'));
alter table knews.advertisers add column if not exists notes text;
alter table knews.advertisers add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table knews.advertisers add column if not exists updated_at timestamptz not null default now();
create trigger update_knews_advertisers_updated_at before update on knews.advertisers for each row execute function knews.update_updated_at_column();

drop policy if exists knews_advertisers_admin on knews.advertisers;
create policy knews_advertisers_select on knews.advertisers for select to authenticated using (knews.can_sell_scope(portal_id));
create policy knews_advertisers_write on knews.advertisers for all to authenticated
  using (knews.can_sell_scope(portal_id)) with check (knews.can_sell_scope(portal_id));

-- 2. Contratos -------------------------------------------------------------------
create table if not exists knews.ad_contracts (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references knews.advertisers(id) on delete restrict,
  portal_id uuid not null references knews.portals(id) on delete restrict,
  reference text not null check (length(reference) between 2 and 60),
  status text not null default 'draft' check (status in ('draft', 'signed', 'cancelled', 'ended')),
  starts_on date not null,
  ends_on date not null,
  total_value_cents bigint not null default 0 check (total_value_cents >= 0),
  partner_id uuid references knews.partners(id) on delete set null,
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  signed_at timestamptz,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (portal_id, reference)
);
create trigger update_knews_ad_contracts_updated_at before update on knews.ad_contracts for each row execute function knews.update_updated_at_column();
alter table knews.ad_contracts enable row level security;
revoke all on knews.ad_contracts from anon;
grant select, insert, update, delete on knews.ad_contracts to authenticated;
grant all on knews.ad_contracts to service_role;
create policy knews_contracts_select on knews.ad_contracts for select to authenticated using (knews.can_sell_portal(portal_id));
create policy knews_contracts_write on knews.ad_contracts for all to authenticated
  using (knews.can_sell_portal(portal_id)) with check (knews.can_sell_portal(portal_id));

-- 3. Campanhas -------------------------------------------------------------------
alter table knews.ad_campaigns add column if not exists contract_id uuid references knews.ad_contracts(id) on delete restrict;
alter table knews.ad_campaigns add column if not exists kind text not null default 'direct' check (kind in ('direct', 'house'));
alter table knews.ad_campaigns add column if not exists pacing text not null default 'asap' check (pacing in ('asap', 'even'));
alter table knews.ad_campaigns add column if not exists daily_impressions_cap integer check (daily_impressions_cap is null or daily_impressions_cap > 0);
alter table knews.ad_campaigns add column if not exists device_targets text[] not null default '{}' check (device_targets <@ array['desktop', 'mobile', 'tablet']);
alter table knews.ad_campaigns add column if not exists category_targets text[] not null default '{}';
alter table knews.ad_campaigns add column if not exists pricing_model text not null default 'flat' check (pricing_model in ('flat', 'cpm', 'cpc'));
alter table knews.ad_campaigns add column if not exists rate_cents integer not null default 0 check (rate_cents >= 0);
alter table knews.ad_campaigns add column if not exists impressions_confirmed integer not null default 0 check (impressions_confirmed >= 0);
alter table knews.ad_campaigns add column if not exists clicks integer not null default 0 check (clicks >= 0);
alter table knews.ad_campaigns add column if not exists disclosure_label text not null default 'Publicidade' check (length(disclosure_label) between 3 and 40);
alter table knews.ad_campaigns add column if not exists status_reason text;
alter table knews.ad_campaigns add column if not exists created_by uuid references auth.users(id) on delete set null;
create index if not exists idx_knews_campaigns_serving on knews.ad_campaigns(status, portal_id) where status = 'active';

-- Contadores de entrega so mudam pelas funcoes do motor (service_role/definer).
drop policy if exists knews_campaigns_write on knews.ad_campaigns;
create policy knews_campaigns_write on knews.ad_campaigns for all to authenticated
  using (knews.can_sell_scope(portal_id)) with check (knews.can_sell_scope(portal_id));
revoke insert, update on knews.ad_campaigns from authenticated;
grant insert (advertiser_id, portal_id, contract_id, name, kind, status, status_reason, starts_at, ends_at, impressions_cap, budget_cents,
              frequency_cap_per_user, daily_impressions_cap, priority, pacing, device_targets, category_targets, pricing_model, rate_cents,
              disclosure_label, created_by)
  on knews.ad_campaigns to authenticated;
grant update (advertiser_id, contract_id, name, kind, status, status_reason, starts_at, ends_at, impressions_cap, budget_cents,
              frequency_cap_per_user, daily_impressions_cap, priority, pacing, device_targets, category_targets, pricing_model, rate_cents,
              disclosure_label)
  on knews.ad_campaigns to authenticated;

-- Placements e geo: escrita de quem vende a campanha.
create policy knews_ad_placements_write on knews.ad_campaign_placements for all to authenticated
  using (knews.can_edit_campaign(campaign_id)) with check (knews.can_edit_campaign(campaign_id));

alter table knews.ad_campaign_geo_targets add column if not exists neighborhood_slug text;
alter table knews.ad_campaign_geo_targets drop constraint if exists ad_campaign_geo_targets_check;
alter table knews.ad_campaign_geo_targets add constraint ad_campaign_geo_targets_check
  check (city_slug is not null or portal_slug is not null or neighborhood_slug is not null);
drop index if exists knews.uq_knews_ad_geo_targets;
create unique index if not exists uq_knews_ad_geo_targets on knews.ad_campaign_geo_targets(
  campaign_id, coalesce(city_slug, ''), coalesce(portal_slug, ''), coalesce(neighborhood_slug, ''));
create policy knews_ad_geo_write on knews.ad_campaign_geo_targets for all to authenticated
  using (knews.can_edit_campaign(campaign_id)) with check (knews.can_edit_campaign(campaign_id));

-- 4. Criativos ---------------------------------------------------------------------
alter table knews.ad_creatives add column if not exists format text not null default 'image' check (format in ('image', 'text'));
alter table knews.ad_creatives add column if not exists status text not null default 'pending' check (status in ('pending', 'approved', 'rejected'));
alter table knews.ad_creatives add column if not exists click_url text;
alter table knews.ad_creatives add column if not exists alt_text text;
alter table knews.ad_creatives add column if not exists headline text;
alter table knews.ad_creatives add column if not exists body_text text;
alter table knews.ad_creatives add column if not exists width integer check (width is null or width between 1 and 4000);
alter table knews.ad_creatives add column if not exists height integer check (height is null or height between 1 and 4000);
alter table knews.ad_creatives add column if not exists weight smallint not null default 1 check (weight between 1 and 100);
alter table knews.ad_creatives add column if not exists reviewed_by uuid references auth.users(id) on delete set null;
alter table knews.ad_creatives add column if not exists reviewed_at timestamptz;
alter table knews.ad_creatives alter column storage_path drop not null;
alter table knews.ad_creatives alter column file_name drop not null;
alter table knews.ad_creatives alter column content_type drop not null;
alter table knews.ad_creatives alter column size_bytes drop not null;
alter table knews.ad_creatives add constraint knews_creatives_content check (
  (format = 'image' and storage_path is not null and alt_text is not null and length(alt_text) >= 3)
  or (format = 'text' and headline is not null and length(headline) >= 3)
);
-- Destino sempre https; o clique passa pelo redirecionador que valida de novo.
alter table knews.ad_creatives add constraint knews_creatives_click_url check (click_url is null or click_url ~ '^https://[^/\s@]+(/\S*)?$');
alter table knews.ad_creatives add constraint knews_creatives_image_type check (
  content_type is null or content_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
);
drop policy if exists knews_creatives_write on knews.ad_creatives;
create policy knews_creatives_write on knews.ad_creatives for all to authenticated
  using (knews.can_edit_campaign(campaign_id)) with check (knews.can_edit_campaign(campaign_id));

-- 5. Slots e provedores programaticos ------------------------------------------
alter table knews.ad_slots add column if not exists enabled boolean not null default true;
alter table knews.ad_slots add column if not exists description text;
alter table knews.ad_slots add column if not exists fallback_provider text check (fallback_provider in ('adsense', 'mgid'));

-- Posicoes padrao da rede (definicao de inventario, nao dado de negocio).
insert into knews.ad_slots (portal_id, code, name, width, height, description, fallback_provider) values
  (null, 'portal-topo', 'Topo da capa', 970, 250, 'Capa do portal, acima das manchetes', 'adsense'),
  (null, 'portal-meio', 'Meio da capa', 728, 90, 'Entre blocos de notícias da capa', 'mgid'),
  (null, 'artigo-topo', 'Topo do artigo', 728, 90, 'Abaixo do título da matéria', 'adsense'),
  (null, 'artigo-rodape', 'Rodapé do artigo', 728, 90, 'Após o corpo da matéria', 'mgid')
on conflict (code) do nothing;

create table if not exists knews.portal_ad_providers (
  id uuid primary key default gen_random_uuid(),
  portal_id uuid not null references knews.portals(id) on delete cascade,
  provider text not null check (provider in ('adsense', 'mgid')),
  publisher_id text not null check (publisher_id ~ '^[A-Za-z0-9._-]{3,80}$'),
  -- Ligado so depois da aprovacao do provedor (CLAUDE.md: integracao condicionada).
  enabled boolean not null default false,
  approved_at timestamptz,
  ads_txt_line text check (ads_txt_line is null or ads_txt_line ~ '^[A-Za-z0-9.-]+, *[A-Za-z0-9._-]+, *(DIRECT|RESELLER)(, *[A-Za-z0-9]+)?$'),
  slot_map jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (portal_id, provider),
  check (not enabled or approved_at is not null)
);
create trigger update_knews_portal_ad_providers_updated_at before update on knews.portal_ad_providers for each row execute function knews.update_updated_at_column();
alter table knews.portal_ad_providers enable row level security;
revoke all on knews.portal_ad_providers from anon;
grant select, insert, update, delete on knews.portal_ad_providers to authenticated;
grant all on knews.portal_ad_providers to service_role;
create policy knews_ad_providers_select on knews.portal_ad_providers for select to authenticated using (knews.can_sell_portal(portal_id));
create policy knews_ad_providers_write on knews.portal_ad_providers for all to authenticated
  using (knews.is_super_admin()) with check (knews.is_super_admin());

-- 6. Reservas, eventos, estatisticas e frequencia --------------------------------
alter table knews.ad_reservations add column if not exists token text not null
  default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
alter table knews.ad_reservations add column if not exists portal_id uuid references knews.portals(id) on delete cascade;
alter table knews.ad_reservations add column if not exists creative_id uuid references knews.ad_creatives(id) on delete set null;
alter table knews.ad_reservations add column if not exists visitor_hash text;
alter table knews.ad_reservations add column if not exists device text;
alter table knews.ad_reservations add column if not exists impression_at timestamptz;
alter table knews.ad_reservations add column if not exists clicked_at timestamptz;
create unique index if not exists uq_knews_ad_reservations_token on knews.ad_reservations(token);

alter table knews.ad_events add column if not exists portal_id uuid references knews.portals(id) on delete cascade;
alter table knews.ad_events add column if not exists slot_code text;
alter table knews.ad_events add column if not exists creative_id uuid references knews.ad_creatives(id) on delete set null;
-- Impressao e clique contam uma vez por reserva, mesmo com beacon repetido.
create unique index if not exists uq_knews_ad_events_once on knews.ad_events(reservation_id, kind) where kind in ('impression', 'click');

create table if not exists knews.ad_daily_stats (
  campaign_id uuid not null references knews.ad_campaigns(id) on delete cascade,
  portal_id uuid not null references knews.portals(id) on delete cascade,
  slot_code text not null,
  day date not null,
  reserved integer not null default 0,
  impressions integer not null default 0,
  clicks integer not null default 0,
  primary key (campaign_id, portal_id, slot_code, day)
);
create index if not exists idx_knews_ad_daily_stats_portal_day on knews.ad_daily_stats(portal_id, day);
alter table knews.ad_daily_stats enable row level security;
revoke all on knews.ad_daily_stats from anon;
grant select on knews.ad_daily_stats to authenticated;
grant all on knews.ad_daily_stats to service_role;
create policy knews_ad_daily_stats_select on knews.ad_daily_stats for select to authenticated using (knews.can_read_portal(portal_id));

create table if not exists knews.ad_frequency (
  campaign_id uuid not null references knews.ad_campaigns(id) on delete cascade,
  visitor_hash text not null,
  day date not null,
  impressions integer not null default 0,
  primary key (campaign_id, visitor_hash, day)
);
alter table knews.ad_frequency enable row level security;
revoke all on knews.ad_frequency from anon, authenticated;
grant all on knews.ad_frequency to service_role;

-- 7. Links afiliados e produtos proprios -----------------------------------------
create table if not exists knews.ad_links (
  id uuid primary key default gen_random_uuid(),
  portal_id uuid not null references knews.portals(id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9][a-z0-9-]{2,59}$'),
  title text not null check (length(title) between 3 and 120),
  kind text not null check (kind in ('affiliate', 'own_product', 'partner')),
  destination_url text not null check (destination_url ~ '^https://[^/\s@]+(/\S*)?$'),
  rel text not null default 'sponsored nofollow noopener' check (rel ~ 'sponsored'),
  disclosure text not null default 'Link patrocinado: o portal pode receber comissão.' check (length(disclosure) >= 10),
  advertiser_id uuid references knews.advertisers(id) on delete set null,
  active boolean not null default true,
  clicks integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (portal_id, code)
);
create trigger update_knews_ad_links_updated_at before update on knews.ad_links for each row execute function knews.update_updated_at_column();
alter table knews.ad_links enable row level security;
revoke all on knews.ad_links from anon;
grant select, delete on knews.ad_links to authenticated;
grant insert (portal_id, code, title, kind, destination_url, rel, disclosure, advertiser_id, active, created_by) on knews.ad_links to authenticated;
grant update (title, kind, destination_url, rel, disclosure, advertiser_id, active) on knews.ad_links to authenticated;
grant all on knews.ad_links to service_role;
create policy knews_ad_links_select on knews.ad_links for select to authenticated using (knews.can_read_portal(portal_id));
create policy knews_ad_links_write on knews.ad_links for all to authenticated
  using (knews.can_sell_portal(portal_id)) with check (knews.can_sell_portal(portal_id));

create table if not exists knews.ad_link_clicks (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references knews.ad_links(id) on delete cascade,
  portal_id uuid not null references knews.portals(id) on delete cascade,
  at timestamptz not null default now(),
  visitor_hash text,
  referrer_path text
);
create index if not exists idx_knews_ad_link_clicks_link_at on knews.ad_link_clicks(link_id, at);
alter table knews.ad_link_clicks enable row level security;
revoke all on knews.ad_link_clicks from anon;
grant select on knews.ad_link_clicks to authenticated;
grant all on knews.ad_link_clicks to service_role;
create policy knews_ad_link_clicks_select on knews.ad_link_clicks for select to authenticated using (knews.can_sell_portal(portal_id));

-- 8. Receitas --------------------------------------------------------------------
-- Clique nao e venda: receita afiliada/programatica entra como lancamento (estimado ou
-- confirmado pelo relatorio do parceiro), nunca derivada de cliques.
create table if not exists knews.ad_revenue_entries (
  id uuid primary key default gen_random_uuid(),
  portal_id uuid not null references knews.portals(id) on delete restrict,
  source text not null check (source in ('direct', 'adsense', 'mgid', 'affiliate', 'own_product', 'other')),
  contract_id uuid references knews.ad_contracts(id) on delete restrict,
  campaign_id uuid references knews.ad_campaigns(id) on delete set null,
  link_id uuid references knews.ad_links(id) on delete set null,
  period_start date not null,
  period_end date not null,
  amount_cents bigint not null check (amount_cents >= 0),
  status text not null default 'estimated' check (status in ('estimated', 'confirmed', 'paid', 'cancelled')),
  reference text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  check (source <> 'direct' or contract_id is not null)
);
create index if not exists idx_knews_revenue_portal_period on knews.ad_revenue_entries(portal_id, period_start);
create trigger update_knews_ad_revenue_updated_at before update on knews.ad_revenue_entries for each row execute function knews.update_updated_at_column();
alter table knews.ad_revenue_entries enable row level security;
revoke all on knews.ad_revenue_entries from anon;
grant select, insert, update, delete on knews.ad_revenue_entries to authenticated;
grant all on knews.ad_revenue_entries to service_role;
create policy knews_revenue_select on knews.ad_revenue_entries for select to authenticated using (knews.can_sell_portal(portal_id));
create policy knews_revenue_write on knews.ad_revenue_entries for all to authenticated
  using (knews.can_sell_portal(portal_id)) with check (knews.can_sell_portal(portal_id));

-- 9. Guarda de ativacao ------------------------------------------------------------
-- Campanha so fica ativa com contrato assinado do mesmo anunciante/portal (exceto
-- campanhas da casa), janela definida, ao menos um slot e um criativo aprovado.
create or replace function knews.guard_campaign_activation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_contract knews.ad_contracts%rowtype;
  v_activating boolean := false;
  v_terms_changed boolean := false;
begin
  if new.status = 'active' then
    if tg_op = 'INSERT' then
      raise exception 'crie a campanha como rascunho, cadastre slots e criativos e depois ative' using errcode = 'P0004';
    end if;
    v_activating := old.status is distinct from 'active';
    -- Campanha no ar com janela, contrato ou anunciante alterados e revalidada.
    v_terms_changed := new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
      or new.contract_id is distinct from old.contract_id or new.advertiser_id is distinct from old.advertiser_id
      or new.kind is distinct from old.kind;
  end if;

  if v_activating or v_terms_changed then
    if new.ends_at is null then
      raise exception 'campanha sem data de termino nao pode ser ativada' using errcode = 'P0004';
    end if;
    if new.ends_at <= now() then
      raise exception 'campanha com termino no passado nao pode ser ativada' using errcode = 'P0004';
    end if;
    if new.kind = 'direct' then
      select * into v_contract from knews.ad_contracts where id = new.contract_id;
      if not found or v_contract.status <> 'signed' then
        raise exception 'campanha paga exige contrato assinado' using errcode = 'P0004';
      end if;
      if v_contract.advertiser_id <> new.advertiser_id or v_contract.portal_id is distinct from new.portal_id then
        raise exception 'contrato pertence a outro anunciante ou portal' using errcode = 'P0004';
      end if;
      if new.ends_at::date > v_contract.ends_on or coalesce(new.starts_at::date, v_contract.starts_on) < v_contract.starts_on then
        raise exception 'janela da campanha fora da vigencia do contrato' using errcode = 'P0004';
      end if;
    end if;
  end if;

  if v_activating then
    if not exists (select 1 from knews.ad_campaign_placements p where p.campaign_id = new.id) then
      raise exception 'campanha sem slot contratado' using errcode = 'P0004';
    end if;
    if not exists (select 1 from knews.ad_creatives cr where cr.campaign_id = new.id and cr.status = 'approved') then
      raise exception 'campanha sem criativo aprovado' using errcode = 'P0004';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into knews.audit_logs (portal_id, actor_id, action, target_type, target_id, meta)
      values (new.portal_id, auth.uid(), 'campaign.' || new.status, 'ad_campaign', new.id::text,
              jsonb_build_object('from', old.status, 'reason', new.status_reason));
    end if;
  end if;
  return new;
end;
$$;
revoke all on function knews.guard_campaign_activation() from public, anon, authenticated;
drop trigger if exists trg_knews_guard_campaign_activation on knews.ad_campaigns;
create trigger trg_knews_guard_campaign_activation before insert or update on knews.ad_campaigns
  for each row execute function knews.guard_campaign_activation();

-- Criativo aprovado/rejeitado so por quem vende a campanha; quem envia nao aprova
-- sem registrar quem revisou.
create or replace function knews.guard_creative_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from coalesce(case when tg_op = 'UPDATE' then old.status end, 'pending') then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  -- Trocar arquivo ou destino volta o criativo para revisao.
  if tg_op = 'UPDATE' and old.status = 'approved' and new.status = 'approved'
     and (new.storage_path is distinct from old.storage_path or new.click_url is distinct from old.click_url
          or new.headline is distinct from old.headline or new.body_text is distinct from old.body_text) then
    new.status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;
  return new;
end;
$$;
revoke all on function knews.guard_creative_review() from public, anon, authenticated;
drop trigger if exists trg_knews_guard_creative_review on knews.ad_creatives;
create trigger trg_knews_guard_creative_review before insert or update on knews.ad_creatives
  for each row execute function knews.guard_creative_review();

-- 10. Motor de entrega -------------------------------------------------------------
-- Uma chamada por slot renderizado. Decide e reserva na mesma transacao, com trava
-- da linha da campanha e rechecagem do cap, para nunca vender alem do contratado.
create or replace function knews.serve_ad(p_portal_id uuid, p_slot_code text, p_context jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot knews.ad_slots%rowtype;
  v_portal_slug text;
  v_city_slug text;
  v_device text := nullif(p_context->>'device', '');
  v_category text := nullif(p_context->>'category', '');
  v_neighborhood text := nullif(p_context->>'neighborhood', '');
  v_visitor text := nullif(p_context->>'visitor_hash', '');
  v_ttl int := least(greatest(coalesce((p_context->>'ttl_seconds')::int, 1800), 60), 7200);
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_pass int;
  v_candidate record;
  v_campaign knews.ad_campaigns%rowtype;
  v_creative knews.ad_creatives%rowtype;
  v_reservation knews.ad_reservations%rowtype;
  v_provider knews.portal_ad_providers%rowtype;
begin
  select * into v_slot from knews.ad_slots s
  where s.code = p_slot_code and s.enabled and (s.portal_id is null or s.portal_id = p_portal_id);
  if not found then
    return jsonb_build_object('kind', 'none', 'reason', 'slot inexistente ou desativado');
  end if;

  select p.slug, c.slug into v_portal_slug, v_city_slug
  from knews.portals p join knews.cities c on c.id = p.city_id where p.id = p_portal_id;
  if v_portal_slug is null then
    return jsonb_build_object('kind', 'none', 'reason', 'portal inexistente');
  end if;

  -- Passo 1: campanhas pagas. Passo 2: campanhas da casa (fallback), depois do provedor.
  for v_pass in 1..2 loop
    if v_pass = 2 then
      select * into v_provider from knews.portal_ad_providers pr
      where pr.portal_id = p_portal_id and pr.provider = v_slot.fallback_provider and pr.enabled;
      if found then
        return jsonb_build_object('kind', 'provider', 'provider', v_provider.provider, 'publisher_id', v_provider.publisher_id,
                                  'provider_slot_id', v_provider.slot_map->>p_slot_code, 'slot_code', p_slot_code,
                                  'width', v_slot.width, 'height', v_slot.height);
      end if;
    end if;

    for v_candidate in
      select c.id
      from knews.ad_campaigns c
      join knews.ad_campaign_placements pl on pl.campaign_id = c.id and pl.slot_code = p_slot_code
      left join knews.ad_daily_stats ds on ds.campaign_id = c.id and ds.day = v_today
        and ds.portal_id = p_portal_id and ds.slot_code = p_slot_code
      where c.status = 'active'
        and (c.kind = 'house') = (v_pass = 2)
        and (c.portal_id = p_portal_id or c.portal_id is null)
        and (c.starts_at is null or c.starts_at <= now())
        and c.ends_at > now()
        and (c.impressions_cap is null or c.impressions_served < c.impressions_cap)
        and (c.budget_cents is null or c.pricing_model = 'flat' or c.budget_spent_cents < c.budget_cents)
        and (cardinality(c.device_targets) = 0 or v_device = any(c.device_targets))
        and (cardinality(c.category_targets) = 0 or v_category = any(c.category_targets))
        and (not exists (select 1 from knews.ad_campaign_geo_targets g where g.campaign_id = c.id)
             or exists (select 1 from knews.ad_campaign_geo_targets g where g.campaign_id = c.id
                          and (g.portal_slug is null or g.portal_slug = v_portal_slug)
                          and (g.city_slug is null or g.city_slug = v_city_slug)
                          and (g.neighborhood_slug is null or g.neighborhood_slug = v_neighborhood)))
        and (c.frequency_cap_per_user is null or v_visitor is null
             or coalesce((select f.impressions from knews.ad_frequency f
                          where f.campaign_id = c.id and f.visitor_hash = v_visitor and f.day = v_today), 0) < c.frequency_cap_per_user)
        and (c.daily_impressions_cap is null
             or (select coalesce(sum(d.reserved), 0) from knews.ad_daily_stats d where d.campaign_id = c.id and d.day = v_today) < c.daily_impressions_cap)
        -- Pacing uniforme: distribui o saldo do cap pelos dias restantes.
        and (c.pacing = 'asap' or c.impressions_cap is null
             or (select coalesce(sum(d.reserved), 0) from knews.ad_daily_stats d where d.campaign_id = c.id and d.day = v_today)
                < ceil((c.impressions_cap - c.impressions_served
                        + (select coalesce(sum(d.reserved), 0) from knews.ad_daily_stats d where d.campaign_id = c.id and d.day = v_today))::numeric
                       / greatest(1, ceil(extract(epoch from (c.ends_at - now())) / 86400.0))))
        and exists (select 1 from knews.ad_creatives cr where cr.campaign_id = c.id and cr.status = 'approved')
      -- Prioridade do placement, depois da campanha; empate gira pela menor entrega do dia.
      order by pl.priority desc, c.priority desc, coalesce(ds.reserved, 0) asc, random()
      limit 5
    loop
      -- Trava e recheca: outra transacao pode ter consumido o cap ou pausado a campanha.
      select * into v_campaign from knews.ad_campaigns where id = v_candidate.id for update;
      if v_campaign.status <> 'active' or v_campaign.ends_at <= now()
         or (v_campaign.impressions_cap is not null and v_campaign.impressions_served >= v_campaign.impressions_cap)
         or (v_campaign.budget_cents is not null and v_campaign.pricing_model <> 'flat' and v_campaign.budget_spent_cents >= v_campaign.budget_cents) then
        continue;
      end if;

      -- Rotacao ponderada de criativos (amostragem exponencial pelo peso).
      select * into v_creative from knews.ad_creatives cr
      where cr.campaign_id = v_campaign.id and cr.status = 'approved'
      order by -ln(1.0 - random()) / cr.weight asc
      limit 1;
      if not found then continue; end if;

      update knews.ad_campaigns set impressions_served = impressions_served + 1, updated_at = now() where id = v_campaign.id;

      insert into knews.ad_reservations (campaign_id, idempotency_key, slot_code, status, expires_at, portal_id, creative_id, visitor_hash, device)
      values (v_campaign.id, 'serve:' || gen_random_uuid()::text, p_slot_code, 'reserved', now() + make_interval(secs => v_ttl),
              p_portal_id, v_creative.id, v_visitor, v_device)
      returning * into v_reservation;

      insert into knews.ad_daily_stats (campaign_id, portal_id, slot_code, day, reserved)
      values (v_campaign.id, p_portal_id, p_slot_code, v_today, 1)
      on conflict (campaign_id, portal_id, slot_code, day) do update set reserved = knews.ad_daily_stats.reserved + 1;

      insert into knews.ad_events (campaign_id, reservation_id, kind, portal_id, slot_code, creative_id, meta)
      values (v_campaign.id, v_reservation.id, 'reserve', p_portal_id, p_slot_code, v_creative.id,
              jsonb_build_object('device', v_device, 'category', v_category, 'neighborhood', v_neighborhood));

      return jsonb_build_object(
        'kind', 'campaign',
        'token', v_reservation.token,
        'campaign_id', v_campaign.id,
        'campaign_kind', v_campaign.kind,
        'label', v_campaign.disclosure_label,
        'slot_code', p_slot_code,
        'width', coalesce(v_creative.width, v_slot.width),
        'height', coalesce(v_creative.height, v_slot.height),
        'creative', jsonb_build_object(
          'id', v_creative.id, 'format', v_creative.format, 'storage_path', v_creative.storage_path,
          'alt_text', v_creative.alt_text, 'headline', v_creative.headline, 'body_text', v_creative.body_text,
          'has_click', v_creative.click_url is not null));
    end loop;
  end loop;

  return jsonb_build_object('kind', 'none', 'reason', 'sem campanha elegivel');
end;
$$;
revoke all on function knews.serve_ad(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function knews.serve_ad(uuid, text, jsonb) to service_role;

-- Custo de entrega para CPM/CPC (campanha 'flat' e cobrada pelo contrato).
create or replace function knews.campaign_spend_cents(p_pricing text, p_rate int, p_impressions int, p_clicks int)
returns integer language sql immutable set search_path = '' as $$
  select case p_pricing when 'cpm' then (p_impressions::bigint * p_rate / 1000)::int when 'cpc' then p_clicks * p_rate else 0 end;
$$;
revoke all on function knews.campaign_spend_cents(text, int, int, int) from public, anon, authenticated;
grant execute on function knews.campaign_spend_cents(text, int, int, int) to service_role;

-- Impressao confirmada pelo beacon de visibilidade. Idempotente por reserva.
create or replace function knews.record_ad_impression(p_token text, p_visitor_hash text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_res knews.ad_reservations%rowtype;
  v_visitor text;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into v_res from knews.ad_reservations where token = p_token for update;
  if not found then return jsonb_build_object('counted', false, 'reason', 'token desconhecido'); end if;
  if v_res.status in ('impression', 'clicked') then return jsonb_build_object('counted', false, 'idempotent', true); end if;
  if v_res.status <> 'reserved' or v_res.expires_at < now() then return jsonb_build_object('counted', false, 'reason', 'reserva expirada'); end if;

  v_visitor := coalesce(v_res.visitor_hash, nullif(p_visitor_hash, ''));
  update knews.ad_reservations set status = 'impression', impression_at = now(), visitor_hash = v_visitor where id = v_res.id;
  update knews.ad_campaigns c set impressions_confirmed = c.impressions_confirmed + 1,
         budget_spent_cents = knews.campaign_spend_cents(c.pricing_model, c.rate_cents, c.impressions_confirmed + 1, c.clicks)
  where c.id = v_res.campaign_id;
  update knews.ad_daily_stats set impressions = impressions + 1
  where campaign_id = v_res.campaign_id and portal_id = v_res.portal_id and slot_code = v_res.slot_code
    and day = (v_res.created_at at time zone 'America/Sao_Paulo')::date;
  if v_visitor is not null then
    insert into knews.ad_frequency (campaign_id, visitor_hash, day, impressions) values (v_res.campaign_id, v_visitor, v_today, 1)
    on conflict (campaign_id, visitor_hash, day) do update set impressions = knews.ad_frequency.impressions + 1;
  end if;
  insert into knews.ad_events (campaign_id, reservation_id, kind, portal_id, slot_code, creative_id)
  values (v_res.campaign_id, v_res.id, 'impression', v_res.portal_id, v_res.slot_code, v_res.creative_id);
  return jsonb_build_object('counted', true);
end;
$$;
revoke all on function knews.record_ad_impression(text, text) from public, anon, authenticated;
grant execute on function knews.record_ad_impression(text, text) to service_role;

-- Clique: devolve o destino do criativo. Conta uma vez por reserva, ate 24h depois
-- da exibicao; sem beacon (JS desligado) a impressao e confirmada junto.
create or replace function knews.record_ad_click(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_res knews.ad_reservations%rowtype;
  v_url text;
begin
  select * into v_res from knews.ad_reservations where token = p_token for update;
  if not found then return jsonb_build_object('url', null, 'counted', false); end if;
  select cr.click_url into v_url from knews.ad_creatives cr where cr.id = v_res.creative_id;
  if v_url is null then return jsonb_build_object('url', null, 'counted', false); end if;
  if v_res.status = 'clicked' or v_res.created_at < now() - interval '24 hours' or v_res.status not in ('reserved', 'impression') then
    return jsonb_build_object('url', v_url, 'counted', false);
  end if;
  if v_res.status = 'reserved' then
    if v_res.expires_at < now() then return jsonb_build_object('url', v_url, 'counted', false); end if;
    perform knews.record_ad_impression(p_token, null);
  end if;

  update knews.ad_reservations set status = 'clicked', clicked_at = now() where id = v_res.id;
  update knews.ad_campaigns c set clicks = c.clicks + 1,
         budget_spent_cents = knews.campaign_spend_cents(c.pricing_model, c.rate_cents, c.impressions_confirmed, c.clicks + 1)
  where c.id = v_res.campaign_id;
  update knews.ad_daily_stats set clicks = clicks + 1
  where campaign_id = v_res.campaign_id and portal_id = v_res.portal_id and slot_code = v_res.slot_code
    and day = (v_res.created_at at time zone 'America/Sao_Paulo')::date;
  insert into knews.ad_events (campaign_id, reservation_id, kind, portal_id, slot_code, creative_id)
  values (v_res.campaign_id, v_res.id, 'click', v_res.portal_id, v_res.slot_code, v_res.creative_id);
  return jsonb_build_object('url', v_url, 'counted', true);
end;
$$;
revoke all on function knews.record_ad_click(text) from public, anon, authenticated;
grant execute on function knews.record_ad_click(text) to service_role;

-- Link afiliado/produto: resolve pelo portal + codigo e conta o clique.
create or replace function knews.record_link_click(p_portal_id uuid, p_code text, p_visitor_hash text default null, p_referrer_path text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_link knews.ad_links%rowtype;
begin
  select * into v_link from knews.ad_links where portal_id = p_portal_id and code = p_code and active;
  if not found then return jsonb_build_object('url', null); end if;
  update knews.ad_links set clicks = clicks + 1 where id = v_link.id;
  insert into knews.ad_link_clicks (link_id, portal_id, visitor_hash, referrer_path)
  values (v_link.id, p_portal_id, nullif(p_visitor_hash, ''), left(p_referrer_path, 300));
  return jsonb_build_object('url', v_link.destination_url, 'rel', v_link.rel);
end;
$$;
revoke all on function knews.record_link_click(uuid, text, text, text) from public, anon, authenticated;
grant execute on function knews.record_link_click(uuid, text, text, text) to service_role;

-- Reserva abandonada devolve o inventario. Corrige a versao anterior, que devolvia
-- uma unidade por campanha (e nao por reserva) e reinseria eventos ja expirados.
create or replace function knews.expire_stale_reservations()
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  with expired as (
    update knews.ad_reservations set status = 'expired'
    where status = 'reserved' and expires_at < now()
    returning id, campaign_id, portal_id, slot_code, creative_id
  ), per_campaign as (
    select campaign_id, count(*)::int as n from expired group by campaign_id
  ), released as (
    update knews.ad_campaigns c set impressions_served = greatest(0, c.impressions_served - pc.n), updated_at = now()
    from per_campaign pc where c.id = pc.campaign_id
    returning c.id
  ), logged as (
    insert into knews.ad_events (campaign_id, reservation_id, kind, portal_id, slot_code, creative_id)
    select campaign_id, id, 'expire', portal_id, slot_code, creative_id from expired
    returning id
  )
  select count(*) into v_count from expired;
  return v_count;
end;
$$;
revoke all on function knews.expire_stale_reservations() from public, anon, authenticated;
grant execute on function knews.expire_stale_reservations() to service_role;

-- Encerra campanhas vencidas ou com cap confirmado atingido; roda a cada ciclo do worker.
create or replace function knews.close_finished_campaigns()
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  with closed as (
    update knews.ad_campaigns set status = 'ended',
      status_reason = case when ends_at <= now() then 'termino da janela contratada' else 'cap de impressoes entregue' end
    where status = 'active'
      and (ends_at <= now() or (impressions_cap is not null and impressions_confirmed >= impressions_cap))
    returning id
  )
  select count(*) into v_count from closed;
  return v_count;
end;
$$;
revoke all on function knews.close_finished_campaigns() from public, anon, authenticated;
grant execute on function knews.close_finished_campaigns() to service_role;

-- reserve_ad (API de baixo nivel) nao usa mais o orcamento como contador de reservas.
create or replace function knews.reserve_ad(p_campaign_id uuid, p_slot_code text, p_idempotency_key text, p_ttl_seconds int default 300)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_campaign knews.ad_campaigns%rowtype;
  v_existing knews.ad_reservations%rowtype;
  v_reservation knews.ad_reservations%rowtype;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'idempotency_key invalido' using errcode = '22023';
  end if;
  select * into v_existing from knews.ad_reservations where campaign_id = p_campaign_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('reservation_id', v_existing.id, 'status', v_existing.status, 'idempotent', true);
  end if;
  select * into v_campaign from knews.ad_campaigns where id = p_campaign_id for update;
  if not found then raise exception 'campanha nao encontrada' using errcode = 'P0002'; end if;
  -- Rechecagem apos a trava: a chamada concorrente com a mesma chave ja pode ter gravado.
  select * into v_existing from knews.ad_reservations where campaign_id = p_campaign_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('reservation_id', v_existing.id, 'status', v_existing.status, 'idempotent', true);
  end if;
  if v_campaign.status <> 'active' then raise exception 'campanha nao ativa: %', v_campaign.status using errcode = 'P0004'; end if;
  if v_campaign.starts_at is not null and v_campaign.starts_at > now() then
    raise exception 'fora da janela contratada (ainda nao iniciou)' using errcode = 'P0004';
  end if;
  if v_campaign.ends_at is not null and v_campaign.ends_at <= now() then
    raise exception 'fora da janela contratada (expirada)' using errcode = 'P0004';
  end if;
  if v_campaign.impressions_cap is not null and v_campaign.impressions_served >= v_campaign.impressions_cap then
    raise exception 'cap de impressoes atingido' using errcode = 'P0004';
  end if;
  if v_campaign.budget_cents is not null and v_campaign.pricing_model <> 'flat' and v_campaign.budget_spent_cents >= v_campaign.budget_cents then
    raise exception 'orcamento esgotado' using errcode = 'P0004';
  end if;
  if not exists (select 1 from knews.ad_campaign_placements where campaign_id = p_campaign_id and slot_code = p_slot_code) then
    raise exception 'slot nao contratado para campanha' using errcode = 'P0004';
  end if;
  update knews.ad_campaigns set impressions_served = impressions_served + 1, updated_at = now() where id = p_campaign_id;
  insert into knews.ad_reservations (campaign_id, idempotency_key, slot_code, status, expires_at, portal_id)
  values (p_campaign_id, p_idempotency_key, p_slot_code, 'reserved', now() + make_interval(secs => p_ttl_seconds), v_campaign.portal_id)
  returning * into v_reservation;
  insert into knews.ad_events (campaign_id, reservation_id, kind, meta)
  values (p_campaign_id, v_reservation.id, 'reserve', jsonb_build_object('slot', p_slot_code, 'idempotency_key', p_idempotency_key));
  return jsonb_build_object('reservation_id', v_reservation.id, 'status', v_reservation.status, 'idempotent', false);
end;
$$;
revoke all on function knews.reserve_ad(uuid, text, text, int) from public, anon, authenticated;
grant execute on function knews.reserve_ad(uuid, text, text, int) to service_role;

-- 11. ads.txt publico: so linhas de provedores aprovados e ligados no portal do host.
create or replace function knews_public.ads_txt(p_host text)
returns setof text language sql stable security definer set search_path = '' as $$
  select pr.ads_txt_line
  from knews.portal_ad_providers pr
  join knews.portal_domains d on d.portal_id = pr.portal_id
  where lower(d.domain) = lower(p_host) and pr.enabled and pr.ads_txt_line is not null
  order by pr.provider;
$$;
revoke all on function knews_public.ads_txt(text) from public;
grant execute on function knews_public.ads_txt(text) to anon, authenticated, service_role;

-- 12. Materia publica passa a informar o bairro, usado no targeting de anuncios.
create or replace function knews_public.published_article(p_portal_id uuid, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'slug', a.slug, 'title', a.title, 'excerpt', a.excerpt, 'body', a.body, 'category', a.category,
    'neighborhood', n.slug,
    'published_at', a.published_at, 'updated_at', a.updated_at, 'version', a.version,
    'evidences', (select coalesce(jsonb_agg(jsonb_build_object('url', e.source_url, 'label', e.source_label, 'type', e.source_type, 'captured_at', e.captured_at) order by e.captured_at), '[]'::jsonb)
                  from knews.article_evidences e where e.article_id = a.id),
    'corrections', (select coalesce(jsonb_agg(jsonb_build_object('note', c.note, 'at', c.created_at) order by c.created_at), '[]'::jsonb)
                    from knews.article_corrections c where c.article_id = a.id)
  )
  from knews.articles a
  join knews.portals p on p.id = a.portal_id
  left join knews.neighborhoods n on n.id = a.neighborhood_id
  where a.portal_id = p_portal_id and a.slug = p_slug and a.status = 'published' and p.status = 'active';
$$;

-- 13. Slots de rede (portal_id null) sao definicao de inventario, legivel por membros.
drop policy if exists knews_ad_slots_select on knews.ad_slots;
create policy knews_ad_slots_select on knews.ad_slots for select to authenticated
  using ((portal_id is null and knews.is_member()) or (portal_id is not null and knews.can_read_portal(portal_id)));
