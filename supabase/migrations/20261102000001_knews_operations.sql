-- K-NEWS Operacao (P7): painel da fila, reprocessamento e cancelamento auditados,
-- e correcao de leitura da trilha de auditoria. NAO APLICAR EM PRODUCAO SEM
-- APROVACAO EXPLICITA.

-- 1. Auditoria sem portal (rede, parceiros) so para super_admin. Antes, qualquer
--    autenticado do Auth compartilhado (inclusive do BLOGGER) lia essas linhas.
drop policy if exists knews_audit_select on knews.audit_logs;
create policy knews_audit_select on knews.audit_logs for select to authenticated using (
  case when portal_id is null then knews.is_super_admin()
       -- Gestao ve tudo do portal; area comercial ve so o historico dos anuncios.
       else knews.can_manage_portal(portal_id) or (target_type like 'ad\_%' and knews.can_sell_portal(portal_id)) end
);
-- Escrita so pelas funcoes e pelo servidor.
revoke insert on knews.audit_logs from authenticated;

-- 2. Quem opera a automacao: super_admin ou operador tecnico de algum portal.
create or replace function knews.can_operate()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from knews.portal_members m where m.user_id = auth.uid() and m.status = 'active'
                 and m.role in ('super_admin','technical_operator'));
$$;
revoke all on function knews.can_operate() from public, anon;
grant execute on function knews.can_operate() to authenticated, service_role;

-- 3. Visao da operacao. Mesmo conteudo para o painel e para o health interno.
create or replace function knews.ops_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not knews.can_operate() then
    return null;
  end if;
  return jsonb_build_object(
    'generated_at', now(),
    'by_type', coalesce((
      select jsonb_agg(jsonb_build_object('job_type', job_type, 'status', status, 'count', n) order by job_type, status)
      from (select job_type, status, count(*) n from knews.jobs group by job_type, status) s), '[]'::jsonb),
    'due_backlog', (select count(*) from knews.jobs where status in ('queued','retrying') and scheduled_at <= now()),
    'oldest_due_seconds', (select coalesce(extract(epoch from now() - min(scheduled_at))::int, 0)
                           from knews.jobs where status in ('queued','retrying') and scheduled_at <= now()),
    'expired_leases', (select count(*) from knews.jobs where status = 'running' and lease_expires_at < now()),
    'dead_letter', (select count(*) from knews.jobs where status = 'dead_letter'),
    'last_completed', coalesce((
      select jsonb_object_agg(job_type, at) from (
        select job_type, max(updated_at) at from knews.jobs where status = 'completed' group by job_type) c), '{}'::jsonb),
    'recent_dead_letters', coalesce((
      select jsonb_agg(jsonb_build_object('id', j.id, 'job_type', j.job_type, 'portal', p.name, 'attempts', j.attempts,
                                          'last_error', left(j.last_error, 300), 'failed_at', j.failed_at) order by j.failed_at desc nulls last)
      from (select * from knews.jobs where status = 'dead_letter' order by failed_at desc nulls last limit 20) j
      left join knews.portals p on p.id = j.portal_id), '[]'::jsonb),
    'sources_failing', (select count(*) from knews.sources where enabled and last_status = 'failed'),
    'social_attention', (select count(*) from knews.social_posts where status in ('failed','needs_check')),
    'social_accounts_expired', (select count(*) from knews.portal_social_accounts where status = 'expired'),
    'ad_reservations_open', (select count(*) from knews.ad_reservations where status = 'reserved' and expires_at > now())
  );
end;
$$;
revoke all on function knews.ops_overview() from public, anon;
grant execute on function knews.ops_overview() to authenticated, service_role;

-- 4. Reprocessar e cancelar, com trilha. Reprocessar e seguro porque cada handler e
--    idempotente (o envio social, por exemplo, so sai de um post "scheduled").
create or replace function knews.requeue_job(p_job_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_job knews.jobs%rowtype;
begin
  if not knews.can_operate() then raise exception 'somente operacao reprocessa jobs' using errcode = '42501'; end if;
  select * into v_job from knews.jobs where id = p_job_id for update;
  if v_job.id is null then raise exception 'job nao encontrado'; end if;
  if v_job.status not in ('dead_letter','cancelled') then raise exception 'so job em dead-letter ou cancelado volta para a fila'; end if;
  update knews.jobs set status = 'queued', attempts = 0, scheduled_at = now(), failed_at = null where id = p_job_id;
  insert into knews.job_events (job_id, from_status, to_status, attempt, error) values (p_job_id, v_job.status, 'queued', 0, 'reprocessado manualmente');
  insert into knews.audit_logs (portal_id, actor_id, action, target_type, target_id, meta)
  values (v_job.portal_id, auth.uid(), 'job.requeue', 'job', p_job_id::text, jsonb_build_object('job_type', v_job.job_type, 'last_error', left(v_job.last_error, 300)));
end;
$$;
revoke all on function knews.requeue_job(uuid) from public, anon;
grant execute on function knews.requeue_job(uuid) to authenticated, service_role;

create or replace function knews.cancel_job(p_job_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_job knews.jobs%rowtype;
begin
  if not knews.can_operate() then raise exception 'somente operacao cancela jobs' using errcode = '42501'; end if;
  select * into v_job from knews.jobs where id = p_job_id for update;
  if v_job.id is null then raise exception 'job nao encontrado'; end if;
  if v_job.status not in ('queued','retrying','dead_letter') then raise exception 'job em % nao pode ser cancelado', v_job.status; end if;
  update knews.jobs set status = 'cancelled' where id = p_job_id;
  insert into knews.job_events (job_id, from_status, to_status, attempt) values (p_job_id, v_job.status, 'cancelled', v_job.attempts);
  insert into knews.audit_logs (portal_id, actor_id, action, target_type, target_id, meta)
  values (v_job.portal_id, auth.uid(), 'job.cancel', 'job', p_job_id::text, jsonb_build_object('job_type', v_job.job_type));
end;
$$;
revoke all on function knews.cancel_job(uuid) from public, anon;
grant execute on function knews.cancel_job(uuid) to authenticated, service_role;
