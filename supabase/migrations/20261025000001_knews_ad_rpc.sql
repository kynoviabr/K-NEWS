-- K-NEWS Ad RPC transacional — DB como fonte da verdade
-- NAO APLICAR EM PRODUCAO SEM APROVACAO EXPLICITA

create table if not exists knews.ad_reservations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references knews.ad_campaigns(id) on delete cascade,
  idempotency_key text not null,
  slot_code text not null,
  status text not null check (status in ('reserved','impression','clicked','expired','cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique(campaign_id, idempotency_key)
);
create index if not exists idx_knews_ad_reservations_expires on knews.ad_reservations(expires_at) where status='reserved';

create table if not exists knews.ad_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references knews.ad_campaigns(id) on delete cascade,
  reservation_id uuid references knews.ad_reservations(id) on delete set null,
  kind text not null check (kind in ('reserve','impression','click','expire','refund')),
  at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);
create index if not exists idx_knews_ad_events_campaign on knews.ad_events(campaign_id, at);

alter table knews.ad_reservations enable row level security;
alter table knews.ad_events enable row level security;
revoke all on knews.ad_reservations, knews.ad_events from anon;
grant select on knews.ad_reservations, knews.ad_events to authenticated;
grant all on knews.ad_reservations, knews.ad_events to service_role;
create policy knews_reservations_select on knews.ad_reservations for select to authenticated using (
  exists (select 1 from knews.ad_campaigns c where c.id = campaign_id and (c.portal_id is null or knews.can_read_portal(c.portal_id)))
);
create policy knews_events_select on knews.ad_events for select to authenticated using (
  exists (select 1 from knews.ad_campaigns c where c.id = campaign_id and (c.portal_id is null or knews.can_read_portal(c.portal_id)))
);

-- RPC: reserva atomica — valida no banco, trava linha da campanha
create or replace function knews.reserve_ad(
  p_campaign_id uuid,
  p_slot_code text,
  p_idempotency_key text,
  p_ttl_seconds int default 300
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign knews.ad_campaigns%rowtype;
  v_existing knews.ad_reservations%rowtype;
  v_reservation knews.ad_reservations%rowtype;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'idempotency_key invalido' using errcode = '22023';
  end if;

  -- Idempotencia: se ja existe mesma campanha+chave, retorna ela
  select * into v_existing from knews.ad_reservations where campaign_id = p_campaign_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('reservation_id', v_existing.id, 'status', v_existing.status, 'idempotent', true);
  end if;

  -- Lock da campanha para checagem atomica
  select * into v_campaign from knews.ad_campaigns where id = p_campaign_id for update;
  if not found then
    raise exception 'campanha nao encontrada' using errcode = 'P0002';
  end if;
  if v_campaign.status <> 'active' then
    raise exception 'campanha nao ativa: %', v_campaign.status using errcode = 'P0004';
  end if;
  if v_campaign.starts_at is not null and v_campaign.starts_at > now() then
    raise exception 'fora da janela contratada (ainda nao iniciou)' using errcode = 'P0004';
  end if;
  if v_campaign.ends_at is not null and v_campaign.ends_at <= now() then
    raise exception 'fora da janela contratada (expirada)' using errcode = 'P0004';
  end if;
  if v_campaign.impressions_cap is not null and v_campaign.impressions_served >= v_campaign.impressions_cap then
    raise exception 'cap de impressoes atingido' using errcode = 'P0004';
  end if;
  if v_campaign.budget_cents is not null and v_campaign.budget_spent_cents >= v_campaign.budget_cents then
    raise exception 'orcamento esgotado' using errcode = 'P0004';
  end if;
  if not exists (select 1 from knews.ad_campaign_placements where campaign_id = p_campaign_id and slot_code = p_slot_code) then
    raise exception 'slot nao contratado para campanha' using errcode = 'P0004';
  end if;

  -- Consome 1 de orcamento/impressao atomica (contabiliza reserva; impressao real confirma depois)
  update knews.ad_campaigns
  set impressions_served = impressions_served + 1,
      budget_spent_cents = case when budget_cents is not null then budget_spent_cents + 1 else budget_spent_cents end,
      updated_at = now()
  where id = p_campaign_id;

  insert into knews.ad_reservations(campaign_id, idempotency_key, slot_code, status, expires_at)
  values (p_campaign_id, p_idempotency_key, p_slot_code, 'reserved', now() + make_interval(secs => p_ttl_seconds))
  returning * into v_reservation;

  insert into knews.ad_events(campaign_id, reservation_id, kind, meta)
  values (p_campaign_id, v_reservation.id, 'reserve', jsonb_build_object('slot', p_slot_code, 'idempotency_key', p_idempotency_key));

  return jsonb_build_object('reservation_id', v_reservation.id, 'status', v_reservation.status, 'idempotent', false);
end;
$$;
revoke all on function knews.reserve_ad(uuid, text, text, int) from public, anon;
grant execute on function knews.reserve_ad(uuid, text, text, int) to authenticated, service_role;

-- Expira reservas abandonadas (chamar via cron)
create or replace function knews.expire_stale_reservations()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_count int;
begin
  with expired as (
    update knews.ad_reservations set status='expired' where status='reserved' and expires_at < now() returning campaign_id, id
  )
  update knews.ad_campaigns c set impressions_served = greatest(0, impressions_served - 1), updated_at = now()
  where c.id in (select campaign_id from expired);

  insert into knews.ad_events(campaign_id, reservation_id, kind)
  select campaign_id, id, 'expire' from knews.ad_reservations where status='expired' and expires_at < now();

  select count(*) into v_count from knews.ad_reservations where status='expired';
  return v_count;
end;
$$;
