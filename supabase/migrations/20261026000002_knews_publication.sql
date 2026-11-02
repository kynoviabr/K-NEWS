-- K-NEWS Publicacao — rascunho, revisao, agendamento, correcoes e identidade por portal
-- NAO APLICAR EM PRODUCAO SEM APROVACAO EXPLICITA

alter table knews.portals add column if not exists theme jsonb not null default '{}'::jsonb;

create table if not exists knews.article_versions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references knews.articles(id) on delete cascade,
  version int not null,
  title text not null,
  body text not null,
  excerpt text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(article_id, version)
);

create table if not exists knews.article_corrections (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references knews.articles(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now()
);

alter table knews.article_versions enable row level security;
alter table knews.article_corrections enable row level security;
revoke all on knews.article_versions, knews.article_corrections from anon;
grant select, insert, update, delete on knews.article_versions, knews.article_corrections to authenticated;
grant all on knews.article_versions, knews.article_corrections to service_role;
create policy knews_versions_select on knews.article_versions for select to authenticated using (
  exists (select 1 from knews.articles a where a.id = article_id and knews.can_read_portal(a.portal_id))
);
create policy knews_corrections_select on knews.article_corrections for select to authenticated using (
  exists (select 1 from knews.articles a where a.id = article_id and knews.can_read_portal(a.portal_id))
);
