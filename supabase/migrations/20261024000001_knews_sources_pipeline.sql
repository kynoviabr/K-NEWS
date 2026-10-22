-- K-NEWS News Intelligence — fontes e pipeline
-- NAO APLICAR EM PRODUCAO SEM APROVACAO EXPLICITA

create table if not exists knews.sources (
  id uuid primary key default gen_random_uuid(),
  portal_id uuid references knews.portals(id) on delete cascade,
  url text not null,
  kind text not null check (kind in ('rss','official_api','diary','licensed_api','event')),
  license text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists knews.fetch_logs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references knews.sources(id) on delete cascade,
  fetched_at timestamptz not null default now(),
  status text not null check (status in ('success','failed','skipped')),
  items_found int not null default 0,
  error text
);
create index if not exists idx_knews_fetch_logs_source on knews.fetch_logs(source_id, fetched_at desc);

alter table knews.sources enable row level security;
alter table knews.fetch_logs enable row level security;
revoke all on knews.sources, knews.fetch_logs from anon;
grant select, insert, update, delete on knews.sources, knews.fetch_logs to authenticated;
grant all on knews.sources, knews.fetch_logs to service_role;

create policy knews_sources_select on knews.sources for select to authenticated using (portal_id is null or knews.can_read_portal(portal_id));
create policy knews_fetch_logs_select on knews.fetch_logs for select to authenticated using (
  exists (select 1 from knews.sources s where s.id = source_id and (s.portal_id is null or knews.can_read_portal(s.portal_id)))
);
