-- K-NEWS Jobs hardening — claim atomico, lease, retry/backoff, DLQ
-- NAO APLICAR EM PRODUCAO SEM APROVACAO EXPLICITA
-- Requer knews.jobs da migration 20261021000001

create table if not exists knews.job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references knews.jobs(id) on delete cascade,
  from_status text,
  to_status text not null,
  at timestamptz not null default now(),
  error text,
  attempt int not null default 0
);
create index if not exists idx_knews_job_events_job on knews.job_events(job_id, at);

alter table knews.job_events enable row level security;
revoke all on knews.job_events from anon;
grant select, insert on knews.job_events to authenticated;
grant all on knews.job_events to service_role;
create policy knews_job_events_select on knews.job_events for select to authenticated using (
  exists (select 1 from knews.jobs j where j.id = job_id and (j.portal_id is null or knews.can_read_portal(j.portal_id)))
);

-- Claim atomico: SKIP LOCKED, lease, recupera leases expirados, respeita scheduled_at e max_attempts
create or replace function knews.claim_jobs(p_worker_id text, p_limit int default 1, p_lease_seconds int default 60)
returns setof knews.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Recupera leases expirados: running com lease vencido vira retrying ou dead_letter
  update knews.jobs
  set status = case when attempts >= max_attempts then 'dead_letter'::text else 'retrying'::text end,
      lease_expires_at = null,
      claimed_at = null,
      claimed_by = null,
      last_error = coalesce(last_error, 'lease expired')
  where status = 'running' and lease_expires_at is not null and lease_expires_at < now();

  return query
  with cte as (
    select id from knews.jobs
    where status in ('queued','retrying')
      and scheduled_at <= now()
      and attempts < max_attempts
    order by priority desc, scheduled_at asc, created_at asc
    limit p_limit
    for update skip locked
  )
  update knews.jobs j
  set status = 'running',
      claimed_at = now(),
      claimed_by = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempts = j.attempts + 1,
      updated_at = now()
  from cte where j.id = cte.id
  returning j.*;
end;
$$;

-- Complete / fail / heartbeat
create or replace function knews.complete_job(p_job_id uuid, p_result jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update knews.jobs set status='completed', result=p_result, lease_expires_at=null, claimed_at=null, claimed_by=null, updated_at=now() where id=p_job_id and status='running';
  insert into knews.job_events(job_id, from_status, to_status, attempt) values (p_job_id, 'running', 'completed', (select attempts from knews.jobs where id=p_job_id));
end; $$;

create or replace function knews.fail_job(p_job_id uuid, p_error text, p_retry boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare v_attempts int; v_max int;
begin
  select attempts, max_attempts into v_attempts, v_max from knews.jobs where id=p_job_id;
  if p_retry and v_attempts < v_max then
    update knews.jobs set status='retrying', last_error=p_error, lease_expires_at=null, claimed_at=null, claimed_by=null, scheduled_at=now() + (power(2, v_attempts) * interval '30 seconds'), updated_at=now() where id=p_job_id;
    insert into knews.job_events(job_id, from_status, to_status, error, attempt) values (p_job_id, 'running', 'retrying', p_error, v_attempts);
  else
    update knews.jobs set status='dead_letter', last_error=p_error, lease_expires_at=null, claimed_at=null, claimed_by=null, failed_at=now(), updated_at=now() where id=p_job_id;
    insert into knews.job_events(job_id, from_status, to_status, error, attempt) values (p_job_id, 'running', 'dead_letter', p_error, v_attempts);
  end if;
end; $$;

create or replace function knews.heartbeat_job(p_job_id uuid, p_lease_seconds int default 60)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update knews.jobs set lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at=now() where id=p_job_id and status='running';
end; $$;
