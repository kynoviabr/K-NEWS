-- K-NEWS RLS hardening — achados da homologacao em PostgreSQL local (2026-10-24)
-- NAO APLICAR EM PRODUCAO SEM APROVACAO EXPLICITA
--
-- 1. knews.advertisers aceitava leitura/escrita de QUALQUER usuario autenticado
--    (using true). Como o Auth e compartilhado com o BLOGGER, clientes do BLOGGER
--    podiam ler e alterar anunciantes do K-NEWS. Agora: somente super_admin.
-- 2. knews.regions era legivel por qualquer autenticado. Agora: somente quem tem
--    vinculo ativo no K-NEWS. cities/neighborhoods/portal_domains ganham leitura
--    pelo mesmo criterio (antes nao tinham politica e ficavam invisiveis).
-- 3. portal_members nao tinha politica: o painel nao conseguia descobrir os
--    portais do proprio usuario. Agora cada usuario le seus vinculos.
-- 4. knews.update_updated_at_column era executavel por anon/authenticated (PUBLIC).

create or replace function knews.is_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from knews.portal_members m where m.user_id = auth.uid() and m.status = 'active');
$$;
revoke all on function knews.is_member() from public, anon;
grant execute on function knews.is_member() to authenticated, service_role;

create or replace function knews.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from knews.portal_members m where m.user_id = auth.uid() and m.status = 'active' and m.role = 'super_admin');
$$;
revoke all on function knews.is_super_admin() from public, anon;
grant execute on function knews.is_super_admin() to authenticated, service_role;

revoke all on function knews.update_updated_at_column() from public, anon, authenticated;

-- Anunciantes: escopo de rede, apenas super_admin (refinar por territorio na Fase 4/6)
drop policy if exists knews_advertisers_all on knews.advertisers;
create policy knews_advertisers_admin on knews.advertisers for all to authenticated
  using (knews.is_super_admin()) with check (knews.is_super_admin());

-- Catalogo territorial: apenas membros K-NEWS
drop policy if exists knews_regions_select on knews.regions;
create policy knews_regions_select on knews.regions for select to authenticated using (knews.is_member());

drop policy if exists knews_regions_write on knews.regions;
create policy knews_regions_write on knews.regions for all to authenticated
  using (knews.is_super_admin()) with check (knews.is_super_admin());

create policy knews_cities_select on knews.cities for select to authenticated using (knews.is_member());
create policy knews_cities_write on knews.cities for all to authenticated
  using (knews.is_super_admin()) with check (knews.is_super_admin());

create policy knews_neighborhoods_select on knews.neighborhoods for select to authenticated using (knews.is_member());
create policy knews_neighborhoods_write on knews.neighborhoods for all to authenticated
  using (knews.is_super_admin()) with check (knews.is_super_admin());

create policy knews_portal_domains_select on knews.portal_domains for select to authenticated using (knews.can_read_portal(portal_id));

drop policy if exists knews_portals_insert on knews.portals;
create policy knews_portals_insert on knews.portals for insert to authenticated with check (knews.is_super_admin());

create policy knews_portal_members_self on knews.portal_members for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Achados nas migrations de feat/homologacao-final (20261024000002..20261027000001)
-- ---------------------------------------------------------------------------

-- 5. Funcoes SECURITY DEFINER da fila e do ad server nasciam com EXECUTE para PUBLIC.
--    Qualquer usuario autenticado (inclusive do BLOGGER) podia reivindicar, concluir
--    ou falhar jobs e consumir orcamento de qualquer campanha via RPC.
--    Agora somente service_role (workers e rotas de servidor).
revoke all on function knews.claim_jobs(text, int, int) from public, anon, authenticated;
revoke all on function knews.complete_job(uuid, jsonb) from public, anon, authenticated;
revoke all on function knews.fail_job(uuid, text, boolean) from public, anon, authenticated;
revoke all on function knews.heartbeat_job(uuid, int) from public, anon, authenticated;
revoke all on function knews.expire_stale_reservations() from public, anon, authenticated;
revoke all on function knews.get_job_health() from public, anon, authenticated;
revoke all on function knews.reserve_ad(uuid, text, text, int) from public, anon, authenticated;
grant execute on function knews.claim_jobs(text, int, int) to service_role;
grant execute on function knews.complete_job(uuid, jsonb) to service_role;
grant execute on function knews.fail_job(uuid, text, boolean) to service_role;
grant execute on function knews.heartbeat_job(uuid, int) to service_role;
grant execute on function knews.expire_stale_reservations() to service_role;
grant execute on function knews.get_job_health() to service_role;
grant execute on function knews.reserve_ad(uuid, text, text, int) to service_role;

-- 6. Storage knews-creative: qualquer autenticado lia e enviava qualquer criativo.
--    Agora o caminho e <campaign_id>/<arquivo> e exige poder editar a campanha.
create or replace function knews.can_edit_campaign(target_campaign_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from knews.ad_campaigns c
    where c.id = target_campaign_id
      and (knews.is_super_admin() or (c.portal_id is not null and knews.can_edit_portal(c.portal_id)))
  );
$$;
revoke all on function knews.can_edit_campaign(uuid) from public, anon;
grant execute on function knews.can_edit_campaign(uuid) to authenticated, service_role;

drop policy if exists "knews_creative_insert" on storage.objects;
drop policy if exists "knews_creative_select" on storage.objects;
create policy "knews_creative_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'knews-creative'
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and knews.can_edit_campaign(((storage.foldername(name))[1])::uuid)
);
create policy "knews_creative_select" on storage.objects for select to authenticated
using (
  bucket_id = 'knews-creative'
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and knews.can_edit_campaign(((storage.foldername(name))[1])::uuid)
);

-- 7. Parceiros: knews.partners com using (true) e territorios legiveis por qualquer
--    autenticado (comissoes expostas). Agora somente super_admin ate o RBAC da Fase 6.
drop policy if exists knews_partners_all on knews.partners;
create policy knews_partners_admin on knews.partners for all to authenticated
  using (knews.is_super_admin()) with check (knews.is_super_admin());
drop policy if exists knews_territories_select on knews.partner_territories;
create policy knews_territories_admin on knews.partner_territories for all to authenticated
  using (knews.is_super_admin()) with check (knews.is_super_admin());
