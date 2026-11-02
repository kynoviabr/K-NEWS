-- K-NEWS Observabilidade — logs, alertas e health
-- NAO APLICAR EM PRODUCAO SEM APROVACAO EXPLICITA

create table if not exists knews.audit_logs (
  id uuid primary key default gen_random_uuid(),
  portal_id uuid references knews.portals(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  meta jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists idx_knews_audit_portal_at on knews.audit_logs(portal_id, at desc);

alter table knews.audit_logs enable row level security;
revoke all on knews.audit_logs from anon;
grant select, insert on knews.audit_logs to authenticated;
grant all on knews.audit_logs to service_role;
create policy knews_audit_select on knews.audit_logs for select to authenticated using (
  portal_id is null or knews.can_read_portal(portal_id)
);

create or replace function knews.get_job_health()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'jobs_by_status', (select jsonb_object_agg(status, count) from (select status, count(*) from knews.jobs group by status) s),
    'dead_letter', (select count(*) from knews.jobs where status='dead_letter'),
    'running_leased', (select count(*) from knews.jobs where status='running' and lease_expires_at is not null),
    'pending_reservations', (select count(*) from knews.ad_reservations where status='reserved' and expires_at > now())
  );
$$;
