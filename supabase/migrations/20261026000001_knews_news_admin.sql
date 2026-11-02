-- K-NEWS News Intelligence — fontes gerenciaveis + dedup persistente + evidencias
-- NAO APLICAR EM PRODUCAO SEM APROVACAO EXPLICITA

-- Evidencias rastreaveis por artigo (fonte independente de verificacao — IA nunca conta como fonte)
-- knews.article_evidences ja existe (20261022000002); "create table if not exists" era
-- ignorado em silencio e as colunas abaixo nunca eram criadas. Adiciona as colunas.
alter table knews.article_evidences add column if not exists source_type text not null default 'other'
  check (source_type in ('official','licensed','rss','api','other'));
alter table knews.article_evidences add column if not exists content_snippet text;
create index if not exists idx_knews_evidences_article on knews.article_evidences(article_id);

-- Dedup persistente por portal (canonical normalizado)
create table if not exists knews.processed_canonicals (
  portal_id uuid not null references knews.portals(id) on delete cascade,
  dedup_key text not null,
  article_id uuid references knews.articles(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  primary key (portal_id, dedup_key)
);

-- Historico de custos IA por artigo/job
create table if not exists knews.ai_costs (
  id uuid primary key default gen_random_uuid(),
  article_id uuid references knews.articles(id) on delete set null,
  job_id uuid references knews.jobs(id) on delete set null,
  provider text not null,
  model text not null,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  cost_cents int not null default 0,
  at timestamptz not null default now()
);
create index if not exists idx_knews_ai_costs_article on knews.ai_costs(article_id, at);

alter table knews.processed_canonicals enable row level security;
alter table knews.ai_costs enable row level security;
revoke all on knews.processed_canonicals, knews.ai_costs from anon;
grant select, insert, update, delete on knews.processed_canonicals, knews.ai_costs to authenticated;
grant all on knews.processed_canonicals, knews.ai_costs to service_role;

-- politica knews_evidences_select ja criada em 20261022000002
create policy knews_canonicals_select on knews.processed_canonicals for select to authenticated using (knews.can_read_portal(portal_id));
create policy knews_ai_costs_select on knews.ai_costs for select to authenticated using (
  article_id is null or exists (select 1 from knews.articles a where a.id = article_id and knews.can_read_portal(a.portal_id))
);
