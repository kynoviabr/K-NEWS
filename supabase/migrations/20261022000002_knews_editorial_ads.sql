-- K-NEWS Fase 3-4: editorial + ads — sem tocar public.* do BLOGGER
-- NAO APLICAR EM PRODUCAO SEM APROVACAO EXPLICITA

-- Evidencias por artigo
create table if not exists knews.article_evidences (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references knews.articles(id) on delete cascade,
  source_url text not null,
  source_label text,
  captured_at timestamptz not null default now()
);

-- Categorias por portal
create table if not exists knews.categories (
  id uuid primary key default gen_random_uuid(),
  portal_id uuid not null references knews.portals(id) on delete cascade,
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(portal_id, slug)
);
create trigger update_knews_categories_updated_at before update on knews.categories for each row execute function knews.update_updated_at_column();

-- Slots publicitarios (estrutura — Ad Center Fase 4 expandira)
create table if not exists knews.ad_slots (
  id uuid primary key default gen_random_uuid(),
  portal_id uuid references knews.portals(id) on delete cascade,
  code text not null unique,
  name text not null,
  width int, height int,
  created_at timestamptz not null default now()
);

-- Anunciantes e campanhas (MVP obrigatorio — esqueleto)
create table if not exists knews.advertisers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  document text,
  created_at timestamptz not null default now()
);

create table if not exists knews.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references knews.advertisers(id) on delete cascade,
  portal_id uuid references knews.portals(id) on delete set null,
  name text not null,
  status text not null default 'draft' check (status in ('draft','active','paused','ended','blocked')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create trigger update_knews_ad_campaigns_updated_at before update on knews.ad_campaigns for each row execute function knews.update_updated_at_column();

alter table knews.article_evidences enable row level security;
alter table knews.categories enable row level security;
alter table knews.ad_slots enable row level security;
alter table knews.advertisers enable row level security;
alter table knews.ad_campaigns enable row level security;

revoke all on knews.article_evidences, knews.categories, knews.ad_slots, knews.advertisers, knews.ad_campaigns from anon;
grant select, insert, update, delete on knews.article_evidences, knews.categories, knews.ad_slots, knews.advertisers, knews.ad_campaigns to authenticated;
grant all on knews.article_evidences, knews.categories, knews.ad_slots, knews.advertisers, knews.ad_campaigns to service_role;

create policy knews_evidences_select on knews.article_evidences for select to authenticated using (
  exists (select 1 from knews.articles a where a.id = article_id and knews.can_read_portal(a.portal_id))
);
create policy knews_categories_select on knews.categories for select to authenticated using (knews.can_read_portal(portal_id));
create policy knews_categories_write on knews.categories for all to authenticated using (knews.can_edit_portal(portal_id)) with check (knews.can_edit_portal(portal_id));
create policy knews_ad_slots_select on knews.ad_slots for select to authenticated using (portal_id is null or knews.can_read_portal(portal_id));
create policy knews_advertisers_all on knews.advertisers for all to authenticated using (true) with check (true);
create policy knews_campaigns_select on knews.ad_campaigns for select to authenticated using (portal_id is null or knews.can_read_portal(portal_id));
