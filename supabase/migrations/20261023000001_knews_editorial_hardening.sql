-- K-NEWS Editorial hardening — evidencias rastreaveis e trilha de decisao
-- NAO APLICAR EM PRODUCAO SEM APROVACAO EXPLICITA

create table if not exists knews.editorial_decisions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references knews.articles(id) on delete cascade,
  risk_level text not null check (risk_level in ('low','medium','high','blocked')),
  evidence_quality text not null check (evidence_quality in ('none','weak','sufficient','strong')),
  blocked_reasons jsonb not null default '[]'::jsonb,
  is_auto_publishable boolean not null default false,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_knews_editorial_decisions_article on knews.editorial_decisions(article_id, created_at desc);

alter table knews.editorial_decisions enable row level security;
revoke all on knews.editorial_decisions from anon;
grant select, insert, update, delete on knews.editorial_decisions to authenticated;
grant all on knews.editorial_decisions to service_role;

create policy knews_editorial_decisions_select on knews.editorial_decisions for select to authenticated using (
  exists (select 1 from knews.articles a where a.id = article_id and knews.can_read_portal(a.portal_id))
);
create policy knews_editorial_decisions_write on knews.editorial_decisions for all to authenticated using (
  exists (select 1 from knews.articles a where a.id = article_id and knews.can_edit_portal(a.portal_id))
) with check (
  exists (select 1 from knews.articles a where a.id = article_id and knews.can_edit_portal(a.portal_id))
);
