-- K-NEWS Parceiros regionais (P6): territorios exclusivos, acesso comercial delegado
-- pelo territorio, comissoes em livro-razao e indicadores. NAO APLICAR EM PRODUCAO
-- SEM APROVACAO EXPLICITA.
--
-- Principios:
--  * Territorio (cidade ou regiao) tem no maximo um parceiro ativo; o parceiro vende so ali.
--  * O acesso ao painel vem do territorio: vinculos commercial_partner sao criados e
--    removidos por gatilho, entao encerrar o territorio corta o acesso na mesma transacao.
--  * Parceiro nao define a propria comissao nem confirma receita que gera comissao.
--  * Comercial nao le conteudo editorial em andamento: so materia publicada.

-- 1. Parceiros e usuarios ------------------------------------------------------------
alter table knews.partners add column if not exists status text not null default 'active';
alter table knews.partners add column if not exists contact_name text;
alter table knews.partners add column if not exists contact_email text;
alter table knews.partners add column if not exists contact_phone text;
alter table knews.partners add column if not exists notes text;
alter table knews.partners add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table knews.partners add column if not exists updated_at timestamptz not null default now();
alter table knews.partners drop constraint if exists knews_partners_status;
alter table knews.partners add constraint knews_partners_status check (status in ('active','suspended','ended'));
alter table knews.partners drop constraint if exists knews_partners_name;
alter table knews.partners add constraint knews_partners_name check (char_length(btrim(name)) between 2 and 120);
drop trigger if exists update_knews_partners_updated_at on knews.partners;
create trigger update_knews_partners_updated_at before update on knews.partners for each row execute function knews.update_updated_at_column();

create table if not exists knews.partner_users (
  partner_id uuid not null references knews.partners(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (partner_id, user_id),
  -- Uma pessoa representa um parceiro so: evita misturar carteiras.
  unique (user_id)
);
alter table knews.partner_users enable row level security;
revoke all on knews.partner_users from anon;
grant select, insert, delete on knews.partner_users to authenticated;
grant all on knews.partner_users to service_role;

create or replace function knews.my_partner_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select pu.partner_id from knews.partner_users pu join knews.partners p on p.id = pu.partner_id
  where pu.user_id = auth.uid() and p.status = 'active';
$$;
revoke all on function knews.my_partner_id() from public, anon;
grant execute on function knews.my_partner_id() to authenticated, service_role;

create policy knews_partner_users_admin on knews.partner_users for all to authenticated
  using (knews.is_super_admin()) with check (knews.is_super_admin());
create policy knews_partner_users_self on knews.partner_users for select to authenticated using (user_id = auth.uid());
drop policy if exists knews_partners_self on knews.partners;
create policy knews_partners_self on knews.partners for select to authenticated using (id = knews.my_partner_id());

-- 2. Territorios ---------------------------------------------------------------------
drop index if exists knews.uq_knews_partner_territories;
alter table knews.partner_territories add column if not exists status text not null default 'active';
alter table knews.partner_territories add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table knews.partner_territories add column if not exists created_at timestamptz not null default now();
alter table knews.partner_territories add column if not exists ended_at timestamptz;
alter table knews.partner_territories drop constraint if exists knews_territories_status;
alter table knews.partner_territories add constraint knews_territories_status check (status in ('active','ended'));
alter table knews.partner_territories drop constraint if exists knews_territories_scope;
alter table knews.partner_territories add constraint knews_territories_scope check (num_nonnulls(city_id, region_id) = 1);
create index if not exists idx_knews_territories_city on knews.partner_territories(city_id) where status = 'active';
create index if not exists idx_knews_territories_region on knews.partner_territories(region_id) where status = 'active';

drop policy if exists knews_territories_self on knews.partner_territories;
create policy knews_territories_self on knews.partner_territories for select to authenticated using (partner_id = knews.my_partner_id());

-- Exclusividade: cidade e a regiao que a contem nao podem ter parceiros diferentes ativos.
create or replace function knews.guard_partner_territory()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_conflict text;
begin
  if new.status = 'ended' then
    new.ended_at := coalesce(new.ended_at, now());
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'ended' then
    raise exception 'territorio encerrado nao reabre; cadastre outro';
  end if;
  if new.city_id is not null then
    select p.name into v_conflict from knews.partner_territories t join knews.partners p on p.id = t.partner_id
    where t.status = 'active' and t.id <> new.id
      and (t.city_id = new.city_id or t.region_id = (select c.region_id from knews.cities c where c.id = new.city_id))
    limit 1;
  else
    select p.name into v_conflict from knews.partner_territories t join knews.partners p on p.id = t.partner_id
    where t.status = 'active' and t.id <> new.id
      and (t.region_id = new.region_id or t.city_id in (select c.id from knews.cities c where c.region_id = new.region_id))
    limit 1;
  end if;
  if v_conflict is not null then
    raise exception 'territorio ja atribuido ao parceiro %', v_conflict;
  end if;
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end;
$$;
revoke all on function knews.guard_partner_territory() from public, anon, authenticated;
drop trigger if exists trg_knews_guard_partner_territory on knews.partner_territories;
create trigger trg_knews_guard_partner_territory before insert or update on knews.partner_territories
  for each row execute function knews.guard_partner_territory();

-- Territorio ativo que cobre o portal (pela cidade ou pela regiao da cidade).
create or replace function knews.portal_territory(p_portal_id uuid)
returns table (partner_id uuid, commission_pct numeric)
language sql stable security definer set search_path = '' as $$
  select t.partner_id, t.commission_pct
  from knews.portals po
  join knews.cities c on c.id = po.city_id
  join knews.partner_territories t on t.status = 'active' and (t.city_id = c.id or t.region_id = c.region_id)
  join knews.partners pa on pa.id = t.partner_id and pa.status = 'active'
  where po.id = p_portal_id
  limit 1;
$$;
revoke all on function knews.portal_territory(uuid) from public, anon, authenticated;
grant execute on function knews.portal_territory(uuid) to service_role;

-- 3. Acesso delegado pelo territorio ---------------------------------------------------
alter table knews.portal_members add column if not exists partner_id uuid references knews.partners(id) on delete cascade;
create index if not exists idx_knews_portal_members_partner on knews.portal_members(partner_id) where partner_id is not null;

create or replace function knews.sync_partner_memberships(p_partner_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  with desired as (
    select po.id as portal_id, pu.user_id
    from knews.partners pa
    join knews.partner_users pu on pu.partner_id = pa.id
    join knews.partner_territories t on t.partner_id = pa.id and t.status = 'active'
    join knews.cities c on c.id = t.city_id or c.region_id = t.region_id
    join knews.portals po on po.city_id = c.id
    where pa.id = p_partner_id and pa.status = 'active'
  )
  delete from knews.portal_members m
  where m.partner_id = p_partner_id
    and not exists (select 1 from desired d where d.portal_id = m.portal_id and d.user_id = m.user_id);

  insert into knews.portal_members (portal_id, user_id, role, status, partner_id)
  select distinct po.id, pu.user_id, 'commercial_partner', 'active', pa.id
  from knews.partners pa
  join knews.partner_users pu on pu.partner_id = pa.id
  join knews.partner_territories t on t.partner_id = pa.id and t.status = 'active'
  join knews.cities c on c.id = t.city_id or c.region_id = t.region_id
  join knews.portals po on po.city_id = c.id
  where pa.id = p_partner_id and pa.status = 'active'
  on conflict (portal_id, user_id) do nothing;
end;
$$;
revoke all on function knews.sync_partner_memberships(uuid) from public, anon, authenticated;

create or replace function knews.trg_sync_partner_memberships()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_portal record;
begin
  if tg_table_name = 'portals' then
    for v_portal in select distinct t.partner_id from knews.cities c
      join knews.partner_territories t on t.status = 'active' and (t.city_id = c.id or t.region_id = c.region_id)
      where c.id = new.city_id
    loop
      perform knews.sync_partner_memberships(v_portal.partner_id);
    end loop;
    return null;
  end if;
  -- Campos acessados so no ramo da propria tabela (plpgsql resolve o registro na hora).
  if tg_table_name = 'partners' then
    perform knews.sync_partner_memberships(new.id);
    return null;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    perform knews.sync_partner_memberships(old.partner_id);
  end if;
  if tg_op in ('INSERT','UPDATE') then
    perform knews.sync_partner_memberships(new.partner_id);
  end if;
  return null;
end;
$$;
revoke all on function knews.trg_sync_partner_memberships() from public, anon, authenticated;

drop trigger if exists trg_knews_partner_users_sync on knews.partner_users;
create trigger trg_knews_partner_users_sync after insert or delete on knews.partner_users
  for each row execute function knews.trg_sync_partner_memberships();
drop trigger if exists trg_knews_territories_sync on knews.partner_territories;
create trigger trg_knews_territories_sync after insert or update or delete on knews.partner_territories
  for each row execute function knews.trg_sync_partner_memberships();
drop trigger if exists trg_knews_partners_sync on knews.partners;
create trigger trg_knews_partners_sync after update of status on knews.partners
  for each row execute function knews.trg_sync_partner_memberships();
drop trigger if exists trg_knews_portals_partner_sync on knews.portals;
create trigger trg_knews_portals_partner_sync after insert on knews.portals
  for each row execute function knews.trg_sync_partner_memberships();

-- Vincular usuario por e-mail (authenticated nao le auth.users).
create or replace function knews.add_partner_user(p_partner_id uuid, p_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if not knews.is_super_admin() then raise exception 'somente super_admin vincula usuarios a parceiros' using errcode = '42501'; end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then raise exception 'usuario nao encontrado: convide a pessoa antes'; end if;
  if exists (select 1 from knews.portal_members m where m.user_id = v_user and m.partner_id is null and m.role <> 'commercial_partner') then
    raise exception 'usuario ja tem funcao interna no K-NEWS; use outra conta para o parceiro';
  end if;
  insert into knews.partner_users (partner_id, user_id, created_by) values (p_partner_id, v_user, auth.uid());
  insert into knews.audit_logs (actor_id, action, target_type, target_id, meta)
  values (auth.uid(), 'partner.user_added', 'partner', p_partner_id::text, jsonb_build_object('user_id', v_user));
  return v_user;
end;
$$;
revoke all on function knews.add_partner_user(uuid, text) from public, anon;
grant execute on function knews.add_partner_user(uuid, text) to authenticated, service_role;

-- 4. Comercial so ve materia publicada ---------------------------------------------------
drop policy if exists knews_articles_select on knews.articles;
create policy knews_articles_select on knews.articles for select to authenticated
  using (knews.can_edit_portal(portal_id) or (status = 'published' and knews.can_read_portal(portal_id)));
drop policy if exists knews_sources_select on knews.sources;
create policy knews_sources_select on knews.sources for select to authenticated using (knews.can_edit_portal(portal_id) or (portal_id is null and knews.is_super_admin()));
drop policy if exists knews_source_items_select on knews.source_items;
create policy knews_source_items_select on knews.source_items for select to authenticated using (knews.can_edit_portal(portal_id));
drop policy if exists knews_canonicals_select on knews.processed_canonicals;
create policy knews_canonicals_select on knews.processed_canonicals for select to authenticated using (knews.can_edit_portal(portal_id));
drop policy if exists knews_editorial_decisions_select on knews.editorial_decisions;
create policy knews_editorial_decisions_select on knews.editorial_decisions for select to authenticated using (
  exists (select 1 from knews.articles a where a.id = article_id and knews.can_edit_portal(a.portal_id)));
drop policy if exists knews_article_claims_select on knews.article_claims;
create policy knews_article_claims_select on knews.article_claims for select to authenticated using (
  exists (select 1 from knews.articles a where a.id = article_id and knews.can_edit_portal(a.portal_id)));

-- 5. Contratos: parceiro e comissao vem do territorio ----------------------------------
create or replace function knews.guard_contract_partner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_territory record;
begin
  if auth.uid() is null then return new; end if; -- sistema/migracoes
  if tg_op = 'INSERT' then
    if not knews.is_super_admin() then
      select * into v_territory from knews.portal_territory(new.portal_id);
      new.partner_id := v_territory.partner_id;
      new.commission_pct := coalesce(v_territory.commission_pct, 0);
    elsif new.partner_id is null then
      -- super_admin pode negociar outra comissao; sem valor, vale a do territorio.
      select * into v_territory from knews.portal_territory(new.portal_id);
      new.partner_id := v_territory.partner_id;
      new.commission_pct := case when v_territory.partner_id is null then 0
                                 when new.commission_pct > 0 then new.commission_pct
                                 else v_territory.commission_pct end;
    end if;
  elsif (new.partner_id, new.commission_pct) is distinct from (old.partner_id, old.commission_pct) and not knews.is_super_admin() then
    raise exception 'somente super_admin altera parceiro ou comissao do contrato' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function knews.guard_contract_partner() from public, anon, authenticated;
drop trigger if exists trg_knews_guard_contract_partner on knews.ad_contracts;
create trigger trg_knews_guard_contract_partner before insert or update on knews.ad_contracts
  for each row execute function knews.guard_contract_partner();

-- Receita que gera comissao so e confirmada pela gestao (conflito de interesse).
create or replace function knews.guard_revenue_confirmation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and new.status in ('confirmed','paid')
     and (tg_op = 'INSERT' or old.status is distinct from new.status or old.amount_cents <> new.amount_cents)
     and not (knews.is_super_admin() or knews.can_manage_portal(new.portal_id)) then
    raise exception 'somente a gestao do portal confirma receita' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function knews.guard_revenue_confirmation() from public, anon, authenticated;
drop trigger if exists trg_knews_guard_revenue_confirmation on knews.ad_revenue_entries;
create trigger trg_knews_guard_revenue_confirmation before insert or update on knews.ad_revenue_entries
  for each row execute function knews.guard_revenue_confirmation();

-- 6. Comissoes -----------------------------------------------------------------------
create table if not exists knews.partner_commissions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references knews.partners(id) on delete restrict,
  portal_id uuid not null references knews.portals(id) on delete restrict,
  contract_id uuid not null references knews.ad_contracts(id) on delete restrict,
  revenue_entry_id uuid not null unique references knews.ad_revenue_entries(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  base_cents bigint not null check (base_cents >= 0),
  pct numeric(5,2) not null check (pct between 0 and 100),
  amount_cents bigint not null check (amount_cents >= 0),
  status text not null default 'pending' check (status in ('pending','approved','paid','cancelled')),
  needs_review boolean not null default false,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  paid_at timestamptz,
  payment_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'paid' or payment_reference is not null)
);
create index if not exists idx_knews_commissions_partner on knews.partner_commissions(partner_id, status);
create trigger update_knews_partner_commissions_updated_at before update on knews.partner_commissions for each row execute function knews.update_updated_at_column();
alter table knews.partner_commissions enable row level security;
revoke all on knews.partner_commissions from anon, authenticated;
grant select on knews.partner_commissions to authenticated;
grant all on knews.partner_commissions to service_role;
create policy knews_commissions_select on knews.partner_commissions for select to authenticated
  using (knews.is_super_admin() or partner_id = knews.my_partner_id() or knews.can_manage_portal(portal_id));

-- Livro-razao alimentado pela receita confirmada do contrato com parceiro.
create or replace function knews.sync_revenue_commission()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_contract record;
  v_existing knews.partner_commissions%rowtype;
  v_amount bigint;
begin
  select * into v_existing from knews.partner_commissions where revenue_entry_id = new.id;
  select id, partner_id, commission_pct into v_contract from knews.ad_contracts where id = new.contract_id;
  if new.status in ('confirmed','paid') and v_contract.partner_id is not null and v_contract.commission_pct > 0 then
    v_amount := round(new.amount_cents * v_contract.commission_pct / 100);
    if v_existing.id is null then
      insert into knews.partner_commissions (partner_id, portal_id, contract_id, revenue_entry_id, period_start, period_end, base_cents, pct, amount_cents)
      values (v_contract.partner_id, new.portal_id, v_contract.id, new.id, new.period_start, new.period_end, new.amount_cents, v_contract.commission_pct, v_amount);
    elsif v_existing.status in ('pending','cancelled') then
      update knews.partner_commissions set status = 'pending', base_cents = new.amount_cents, pct = v_contract.commission_pct,
        amount_cents = v_amount, period_start = new.period_start, period_end = new.period_end, needs_review = false
      where id = v_existing.id;
    elsif v_existing.amount_cents <> v_amount then
      update knews.partner_commissions set needs_review = true where id = v_existing.id;
    end if;
  elsif v_existing.id is not null then
    if v_existing.status = 'pending' then
      update knews.partner_commissions set status = 'cancelled' where id = v_existing.id;
    elsif v_existing.status in ('approved','paid') then
      update knews.partner_commissions set needs_review = true where id = v_existing.id;
    end if;
  end if;
  return null;
end;
$$;
revoke all on function knews.sync_revenue_commission() from public, anon, authenticated;
drop trigger if exists trg_knews_sync_revenue_commission on knews.ad_revenue_entries;
create trigger trg_knews_sync_revenue_commission after insert or update on knews.ad_revenue_entries
  for each row execute function knews.sync_revenue_commission();

create or replace function knews.set_commission_status(p_commission_id uuid, p_status text, p_payment_reference text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c knews.partner_commissions%rowtype;
begin
  if not knews.is_super_admin() then raise exception 'somente super_admin aprova e paga comissoes' using errcode = '42501'; end if;
  select * into v_c from knews.partner_commissions where id = p_commission_id for update;
  if v_c.id is null then raise exception 'comissao nao encontrada'; end if;
  if not ((v_c.status = 'pending' and p_status in ('approved','cancelled'))
          or (v_c.status = 'approved' and p_status in ('paid','cancelled'))) then
    raise exception 'transicao de comissao nao permitida: % -> %', v_c.status, p_status;
  end if;
  if p_status = 'paid' and nullif(btrim(p_payment_reference), '') is null then
    raise exception 'informe o comprovante do pagamento';
  end if;
  update knews.partner_commissions set
    status = p_status,
    approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    paid_at = case when p_status = 'paid' then now() else paid_at end,
    payment_reference = case when p_status = 'paid' then btrim(p_payment_reference) else payment_reference end,
    needs_review = false
  where id = p_commission_id;
  insert into knews.audit_logs (portal_id, actor_id, action, target_type, target_id, meta)
  values (v_c.portal_id, auth.uid(), 'commission.' || p_status, 'partner_commission', p_commission_id::text,
          jsonb_build_object('amount_cents', v_c.amount_cents, 'partner_id', v_c.partner_id));
end;
$$;
revoke all on function knews.set_commission_status(uuid, text, text) from public, anon;
grant execute on function knews.set_commission_status(uuid, text, text) to authenticated, service_role;

-- 7. Indicadores comerciais ----------------------------------------------------------
-- Carteira do parceiro (contratos e receitas com o parceiro) e audiencia vendida nos
-- portais do territorio no periodo. So super_admin ou o proprio parceiro.
create or replace function knews.partner_indicators(p_partner_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  -- coalesce: sem parceiro, my_partner_id() e null e a comparacao tambem.
  if not (knews.is_super_admin() or coalesce(p_partner_id = knews.my_partner_id(), false)) then
    return null;
  end if;
  with portals as (
    select distinct po.id, po.name
    from knews.partner_territories t
    join knews.cities c on c.id = t.city_id or c.region_id = t.region_id
    join knews.portals po on po.city_id = c.id
    where t.partner_id = p_partner_id and t.status = 'active'
  ),
  contracts as (
    select portal_id, count(*) filter (where status = 'signed') as signed,
      coalesce(sum(total_value_cents) filter (where status in ('signed','ended') and starts_on <= p_to and ends_on >= p_from), 0) as contracted_cents
    from knews.ad_contracts where partner_id = p_partner_id group by portal_id
  ),
  revenue as (
    select r.portal_id,
      coalesce(sum(r.amount_cents) filter (where r.status in ('confirmed','paid')), 0) as confirmed_cents,
      coalesce(sum(r.amount_cents) filter (where r.status = 'estimated'), 0) as estimated_cents
    from knews.ad_revenue_entries r join knews.ad_contracts k on k.id = r.contract_id
    where k.partner_id = p_partner_id and r.period_start <= p_to and r.period_end >= p_from
    group by r.portal_id
  ),
  delivery as (
    select s.portal_id, sum(s.impressions) as impressions, sum(s.clicks) as clicks
    from knews.ad_daily_stats s where s.portal_id in (select id from portals) and s.day between p_from and p_to
    group by s.portal_id
  ),
  campaigns as (
    select portal_id, count(*) as active from knews.ad_campaigns
    where status = 'active' and portal_id in (select id from portals) group by portal_id
  ),
  commissions as (
    select coalesce(sum(amount_cents) filter (where status = 'pending'), 0) as pending_cents,
      coalesce(sum(amount_cents) filter (where status = 'approved'), 0) as approved_cents,
      coalesce(sum(amount_cents) filter (where status = 'paid'), 0) as paid_cents,
      count(*) filter (where needs_review) as needs_review
    from knews.partner_commissions where partner_id = p_partner_id and period_start <= p_to and period_end >= p_from
  )
  select jsonb_build_object(
    'portals', coalesce((select jsonb_agg(jsonb_build_object(
        'portal_id', p.id, 'portal_name', p.name,
        'contracts_signed', coalesce(ct.signed, 0), 'contracted_cents', coalesce(ct.contracted_cents, 0),
        'revenue_confirmed_cents', coalesce(rv.confirmed_cents, 0), 'revenue_estimated_cents', coalesce(rv.estimated_cents, 0),
        'campaigns_active', coalesce(cp.active, 0), 'impressions', coalesce(d.impressions, 0), 'clicks', coalesce(d.clicks, 0)
      ) order by p.name)
      from portals p left join contracts ct on ct.portal_id = p.id left join revenue rv on rv.portal_id = p.id
      left join delivery d on d.portal_id = p.id left join campaigns cp on cp.portal_id = p.id), '[]'::jsonb),
    'commissions', (select to_jsonb(c) from commissions c)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function knews.partner_indicators(uuid, date, date) from public, anon;
grant execute on function knews.partner_indicators(uuid, date, date) to authenticated, service_role;

-- E-mails das pessoas do parceiro para o painel (authenticated nao le auth.users).
create or replace function knews.partner_user_emails(p_partner_id uuid)
returns table (user_id uuid, email text)
language sql stable security definer set search_path = '' as $$
  select pu.user_id, u.email::text from knews.partner_users pu join auth.users u on u.id = pu.user_id
  where pu.partner_id = p_partner_id
    and (knews.is_super_admin() or coalesce(p_partner_id = knews.my_partner_id(), false))
  order by u.email;
$$;
revoke all on function knews.partner_user_emails(uuid) from public, anon;
grant execute on function knews.partner_user_emails(uuid) to authenticated, service_role;
