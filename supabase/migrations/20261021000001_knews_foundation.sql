-- K-NEWS Foundation — schema isolado knews (não tocar public.* do BLOGGER)
-- NÃO APLICAR EM PRODUÇÃO SEM AUTORIZAÇÃO EXPLÍCITA (Fase 1)
create schema if not exists knews;
revoke all on schema knews from public, anon;
grant usage on schema knews to authenticated, service_role;

create or replace function knews.update_updated_at_column()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

-- Localidades e portais
create table if not exists knews.regions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active','inactive','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger update_knews_regions_updated_at before update on knews.regions for each row execute function knews.update_updated_at_column();

create table if not exists knews.cities (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references knews.regions(id) on delete cascade,
  name text not null,
  slug text not null,
  status text not null default 'active' check (status in ('active','inactive','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(region_id, slug)
);
create trigger update_knews_cities_updated_at before update on knews.cities for each row execute function knews.update_updated_at_column();

create table if not exists knews.neighborhoods (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references knews.cities(id) on delete cascade,
  name text not null,
  slug text not null,
  status text not null default 'active' check (status in ('active','inactive','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(city_id, slug)
);
create trigger update_knews_neighborhoods_updated_at before update on knews.neighborhoods for each row execute function knews.update_updated_at_column();

create table if not exists knews.portals (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references knews.cities(id) on delete restrict,
  name text not null,
  slug text not null unique,
  domain text,
  status text not null default 'active' check (status in ('active','inactive','archived')),
  seo jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger update_knews_portals_updated_at before update on knews.portals for each row execute function knews.update_updated_at_column();

create table if not exists knews.portal_domains (
  id uuid primary key default gen_random_uuid(),
  portal_id uuid not null references knews.portals(id) on delete cascade,
  domain text not null unique,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists knews.portal_members (
  portal_id uuid not null references knews.portals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('super_admin','regional_manager','regional_editor','commercial_partner','technical_operator','advertiser')),
  status text not null default 'active' check (status in ('active','invited','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (portal_id, user_id)
);
create trigger update_knews_portal_members_updated_at before update on knews.portal_members for each row execute function knews.update_updated_at_column();

-- Jornalismo mínimo (Fase 3 expande)
create table if not exists knews.articles (
  id uuid primary key default gen_random_uuid(),
  portal_id uuid not null references knews.portals(id) on delete cascade,
  slug text not null,
  title text not null,
  excerpt text,
  body text not null default '',
  status text not null default 'draft' check (status in ('draft','reviewing','ready','scheduled','published','blocked','archived')),
  risk_level text not null default 'low' check (risk_level in ('low','medium','high','blocked')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(portal_id, slug)
);
create trigger update_knews_articles_updated_at before update on knews.articles for each row execute function knews.update_updated_at_column();

-- Fila durável K-NEWS (Fase 3 — sem reusar public.background_jobs)
create table if not exists knews.jobs (
  id uuid primary key default gen_random_uuid(),
  portal_id uuid references knews.portals(id) on delete cascade,
  job_type text not null check (job_type in ('rss_fetch','normalize','classify','draft','publish','social_publish','ad_serve','affiliate_sync','research')),
  status text not null default 'queued' check (status in ('queued','running','retrying','completed','dead_letter','cancelled')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  result jsonb,
  priority smallint not null default 100 check (priority between 0 and 1000),
  attempts smallint not null default 0 check (attempts >= 0),
  max_attempts smallint not null default 5 check (max_attempts between 1 and 20),
  idempotency_key text check (idempotency_key is null or length(idempotency_key) between 1 and 200),
  scheduled_at timestamptz not null default now(),
  claimed_at timestamptz, claimed_by text, lease_expires_at timestamptz,
  completed_at timestamptz, failed_at timestamptz, last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knews_jobs_claim_consistency check (
    (status='running' and claimed_at is not null and claimed_by is not null and lease_expires_at is not null)
    or (status<>'running' and claimed_at is null and claimed_by is null and lease_expires_at is null)
  )
);
create unique index if not exists uq_knews_jobs_idempotency on knews.jobs(portal_id, idempotency_key) where idempotency_key is not null;
create index if not exists idx_knews_jobs_claimable on knews.jobs(priority, scheduled_at, created_at) where status in ('queued','retrying');
create index if not exists idx_knews_jobs_portal_status on knews.jobs(portal_id, status, created_at desc);
create trigger update_knews_jobs_updated_at before update on knews.jobs for each row execute function knews.update_updated_at_column();

-- RLS — Fase 1 (políticas restritivas; anon revogado)
alter table knews.regions enable row level security;
alter table knews.cities enable row level security;
alter table knews.neighborhoods enable row level security;
alter table knews.portals enable row level security;
alter table knews.portal_domains enable row level security;
alter table knews.portal_members enable row level security;
alter table knews.articles enable row level security;
alter table knews.jobs enable row level security;

revoke all on knews.regions, knews.cities, knews.neighborhoods, knews.portals, knews.portal_domains, knews.portal_members, knews.articles, knews.jobs from anon;
grant select, insert, update, delete on knews.regions, knews.cities, knews.neighborhoods, knews.portals, knews.portal_domains, knews.portal_members, knews.articles, knews.jobs to authenticated;
grant all on knews.regions, knews.cities, knews.neighborhoods, knews.portals, knews.portal_domains, knews.portal_members, knews.articles, knews.jobs to service_role;

-- Helper: membro do portal
create or replace function knews.can_read_portal(target_portal_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from knews.portal_members m where m.portal_id = target_portal_id and m.user_id = auth.uid() and m.status='active');
$$;
revoke all on function knews.can_read_portal(uuid) from public, anon;
grant execute on function knews.can_read_portal(uuid) to authenticated, service_role;

create or replace function knews.can_edit_portal(target_portal_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from knews.portal_members m where m.portal_id = target_portal_id and m.user_id = auth.uid() and m.status='active' and m.role in ('super_admin','regional_manager','regional_editor'));
$$;
revoke all on function knews.can_edit_portal(uuid) from public, anon;
grant execute on function knews.can_edit_portal(uuid) to authenticated, service_role;

-- Políticas mínimas (leitura para membros, escrita para editores; super_admin para delete)
-- Regions/cities/neighborhoods: leitura para qualquer authenticated (catálogo), escrita para super_admin — refinado na Fase 6 por território
create policy knews_regions_select on knews.regions for select to authenticated using (true);
create policy knews_regions_write on knews.regions for all to authenticated using (exists (select 1 from knews.portal_members m where m.user_id=auth.uid() and m.role='super_admin' and m.status='active')) with check (exists (select 1 from knews.portal_members m where m.user_id=auth.uid() and m.role='super_admin' and m.status='active'));

-- Portals/articles/jobs: por membership
create policy knews_portals_select on knews.portals for select to authenticated using (knews.can_read_portal(id));
create policy knews_portals_insert on knews.portals for insert to authenticated with check (exists (select 1 from knews.portal_members m where m.user_id=auth.uid() and m.role='super_admin' and m.status='active'));
create policy knews_articles_select on knews.articles for select to authenticated using (knews.can_read_portal(portal_id));
create policy knews_articles_write on knews.articles for all to authenticated using (knews.can_edit_portal(portal_id)) with check (knews.can_edit_portal(portal_id));
create policy knews_jobs_select on knews.jobs for select to authenticated using (portal_id is null or knews.can_read_portal(portal_id));
