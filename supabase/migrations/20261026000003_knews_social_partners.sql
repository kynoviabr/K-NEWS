-- K-NEWS Social e Parceiros — Fase E/F
-- NAO APLICAR EM PRODUCAO SEM APROVACAO EXPLICITA

create table if not exists knews.portal_social_accounts (
  id uuid primary key default gen_random_uuid(),
  portal_id uuid not null references knews.portals(id) on delete cascade,
  provider text not null check (provider in ('facebook','instagram')),
  external_account_id text not null,
  access_token_encrypted text not null,
  scopes text[] not null default '{}',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique(portal_id, provider)
);

create table if not exists knews.social_posts (
  id uuid primary key default gen_random_uuid(),
  portal_id uuid not null references knews.portals(id) on delete cascade,
  article_id uuid references knews.articles(id) on delete set null,
  provider text not null check (provider in ('facebook','instagram')),
  external_post_id text,
  status text not null default 'pending' check (status in ('pending','scheduled','publishing','published','failed','cancelled')),
  idempotency_key text not null,
  scheduled_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  unique(portal_id, idempotency_key)
);
create index if not exists idx_knews_social_posts_scheduled on knews.social_posts(scheduled_at) where status='scheduled';

create table if not exists knews.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  document text,
  created_at timestamptz not null default now()
);

create table if not exists knews.partner_territories (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references knews.partners(id) on delete cascade,
  city_id uuid references knews.cities(id) on delete cascade,
  region_id uuid references knews.regions(id) on delete cascade,
  commission_pct numeric(5,2) not null default 0 check (commission_pct >= 0 and commission_pct <= 100)
);
-- Expressoes nao sao permitidas em constraint UNIQUE de tabela; usar indice unico.
create unique index if not exists uq_knews_partner_territories on knews.partner_territories(partner_id, coalesce(city_id::text, ''), coalesce(region_id::text, ''));

alter table knews.portal_social_accounts enable row level security;
alter table knews.social_posts enable row level security;
alter table knews.partners enable row level security;
alter table knews.partner_territories enable row level security;
revoke all on knews.portal_social_accounts, knews.social_posts, knews.partners, knews.partner_territories from anon;
grant select, insert, update, delete on knews.portal_social_accounts, knews.social_posts, knews.partners, knews.partner_territories to authenticated;
grant all on knews.portal_social_accounts, knews.social_posts, knews.partners, knews.partner_territories to service_role;
create policy knews_social_accounts_select on knews.portal_social_accounts for select to authenticated using (knews.can_read_portal(portal_id));
create policy knews_social_posts_select on knews.social_posts for select to authenticated using (knews.can_read_portal(portal_id));
create policy knews_partners_all on knews.partners for all to authenticated using (true) with check (true);
create policy knews_territories_select on knews.partner_territories for select to authenticated using (true);
