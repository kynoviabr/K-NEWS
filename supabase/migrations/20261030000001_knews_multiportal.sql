-- K-NEWS portal multirregional (P3)
-- NAO APLICAR EM PRODUCAO SEM APROVACAO EXPLICITA
--
-- Antes: cidades/portais so por SQL; super_admin nao via portal sem vinculo direto;
-- portais sem politica de UPDATE; tema sem validacao; dominio sem formato; editoria
-- e bairro da materia sem conferencia; portal publico sem busca nem filtros.

-- 1. Portais ----------------------------------------------------------------------
drop policy if exists knews_portals_select on knews.portals;
create policy knews_portals_select on knews.portals for select to authenticated
  using (knews.can_read_portal(id) or knews.is_super_admin());

-- Tema: so chaves conhecidas, cores hex e textos curtos (vai para CSS e HTML do portal).
create or replace function knews.valid_portal_theme(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object'
    and not exists (select 1 from jsonb_object_keys(p) k where k not in ('primary', 'accent', 'tagline', 'logo_text'))
    and (not p ? 'primary' or (p->>'primary') ~ '^#[0-9a-fA-F]{6}$')
    and (not p ? 'accent' or (p->>'accent') ~ '^#[0-9a-fA-F]{6}$')
    and (not p ? 'tagline' or length(p->>'tagline') <= 120)
    and (not p ? 'logo_text' or length(p->>'logo_text') <= 40);
$$;
create or replace function knews.valid_portal_seo(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object'
    and not exists (select 1 from jsonb_object_keys(p) k where k not in ('description', 'title_suffix'))
    and (not p ? 'description' or length(p->>'description') <= 200)
    and (not p ? 'title_suffix' or length(p->>'title_suffix') <= 60);
$$;
alter table knews.portals add constraint knews_portals_theme_valid check (knews.valid_portal_theme(theme));
alter table knews.portals add constraint knews_portals_seo_valid check (knews.valid_portal_seo(seo));
alter table knews.portals add constraint knews_portals_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$');

-- Gerente regional edita nome, tema, SEO e a chave de publicacao do proprio portal.
-- Slug e cidade nao mudam pelo painel (quebrariam URLs e o isolamento territorial).
create policy knews_portals_update on knews.portals for update to authenticated
  using (knews.can_manage_portal(id) or knews.is_super_admin())
  with check (knews.can_manage_portal(id) or knews.is_super_admin());
revoke update on knews.portals from authenticated;
grant update (name, status, theme, seo, publishing_enabled) on knews.portals to authenticated;

create or replace function knews.guard_portal_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and auth.uid() is not null and not knews.is_super_admin() then
    raise exception 'somente super_admin ativa ou desativa portais' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function knews.guard_portal_status() from public, anon, authenticated;
drop trigger if exists trg_knews_guard_portal_status on knews.portals;
create trigger trg_knews_guard_portal_status before update on knews.portals for each row execute function knews.guard_portal_status();

-- 2. Dominios ---------------------------------------------------------------------
alter table knews.portal_domains add constraint knews_portal_domains_format
  check (domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$');
create unique index if not exists uq_knews_portal_domains_primary on knews.portal_domains(portal_id) where is_primary;
grant select, insert, update, delete on knews.portal_domains to authenticated;
drop policy if exists knews_portal_domains_write on knews.portal_domains;
create policy knews_portal_domains_write on knews.portal_domains for all to authenticated
  using (knews.is_super_admin()) with check (knews.is_super_admin());
drop policy if exists knews_portal_domains_select on knews.portal_domains;
create policy knews_portal_domains_select on knews.portal_domains for select to authenticated
  using (knews.can_read_portal(portal_id) or knews.is_super_admin());

-- 3. Territorio -------------------------------------------------------------------
-- Bairros: tambem o gerente de um portal daquela cidade.
create or replace function knews.can_manage_city(target_city_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select knews.is_super_admin() or exists (
    select 1 from knews.portals p where p.city_id = target_city_id and knews.can_manage_portal(p.id));
$$;
revoke all on function knews.can_manage_city(uuid) from public, anon;
grant execute on function knews.can_manage_city(uuid) to authenticated, service_role;

drop policy if exists knews_neighborhoods_write on knews.neighborhoods;
create policy knews_neighborhoods_write on knews.neighborhoods for all to authenticated
  using (knews.can_manage_city(city_id)) with check (knews.can_manage_city(city_id));

alter table knews.regions add constraint knews_regions_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$');
alter table knews.cities add constraint knews_cities_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$');
alter table knews.neighborhoods add constraint knews_neighborhoods_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$');
alter table knews.categories add constraint knews_categories_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$');
alter table knews.categories add column if not exists position smallint not null default 100;

-- 4. Criacao de portal: portal + dominio principal + vinculo do criador + editorias
-- padrao numa transacao. Nasce inativo; o super_admin ativa quando houver conteudo.
create or replace function knews.create_portal(p_city_id uuid, p_name text, p_slug text, p_domain text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null or not knews.is_super_admin() then
    raise exception 'somente super_admin cria portais' using errcode = '42501';
  end if;
  insert into knews.portals (city_id, name, slug, status) values (p_city_id, p_name, p_slug, 'inactive') returning id into v_id;
  if p_domain is not null and p_domain <> '' then
    insert into knews.portal_domains (portal_id, domain, is_primary) values (v_id, lower(p_domain), true);
  end if;
  insert into knews.portal_members (portal_id, user_id, role) values (v_id, auth.uid(), 'super_admin');
  insert into knews.categories (portal_id, name, slug, position) values
    (v_id, 'Cidade', 'cidade', 10), (v_id, 'Saúde', 'saude', 20), (v_id, 'Educação', 'educacao', 30),
    (v_id, 'Trânsito', 'transito', 40), (v_id, 'Economia', 'economia', 50), (v_id, 'Cultura', 'cultura', 60),
    (v_id, 'Esportes', 'esportes', 70), (v_id, 'Meio ambiente', 'meio-ambiente', 80);
  insert into knews.audit_logs (portal_id, actor_id, action, target_type, target_id, meta)
  values (v_id, auth.uid(), 'portal.created', 'portal', v_id::text, jsonb_build_object('slug', p_slug, 'domain', p_domain));
  return v_id;
end;
$$;
revoke all on function knews.create_portal(uuid, text, text, text) from public, anon;
grant execute on function knews.create_portal(uuid, text, text, text) to authenticated;

-- 5. Editoria e bairro da materia pertencem ao portal ----------------------------
create or replace function knews.guard_article_taxonomy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.category is not null and (tg_op = 'INSERT' or new.category is distinct from old.category) then
    if not exists (select 1 from knews.categories c where c.portal_id = new.portal_id and c.slug = new.category) then
      raise exception 'editoria % nao existe neste portal', new.category using errcode = '23503';
    end if;
  end if;
  if new.neighborhood_id is not null and (tg_op = 'INSERT' or new.neighborhood_id is distinct from old.neighborhood_id) then
    if not exists (select 1 from knews.neighborhoods n join knews.portals p on p.city_id = n.city_id
                   where n.id = new.neighborhood_id and p.id = new.portal_id) then
      raise exception 'bairro nao pertence a cidade do portal' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function knews.guard_article_taxonomy() from public, anon, authenticated;
drop trigger if exists trg_knews_guard_article_taxonomy on knews.articles;
create trigger trg_knews_guard_article_taxonomy before insert or update on knews.articles
  for each row execute function knews.guard_article_taxonomy();

-- 6. Busca --------------------------------------------------------------------------
-- Sem extensao unaccent (recurso compartilhado do projeto): dobra acentos em SQL puro.
create or replace function knews.fold_text(p text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select translate(lower(coalesce(p, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn');
$$;
alter table knews.articles add column if not exists search_vector tsvector generated always as (
  setweight(to_tsvector('portuguese'::regconfig, knews.fold_text(title)), 'A')
  || setweight(to_tsvector('portuguese'::regconfig, knews.fold_text(excerpt)), 'B')
  || setweight(to_tsvector('portuguese'::regconfig, knews.fold_text(body)), 'C')
) stored;
create index if not exists idx_knews_articles_search on knews.articles using gin(search_vector) where status = 'published';
create index if not exists idx_knews_articles_portal_published on knews.articles(portal_id, published_at desc) where status = 'published';

-- 7. Leitura publica ---------------------------------------------------------------
create or replace function knews_public.portal_by_host(p_host text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with h as (select lower(split_part(coalesce(p_host, ''), ':', 1)) as host),
  found as (
    select p.* from knews.portals p join knews.portal_domains d on d.portal_id = p.id, h where d.domain = h.host
    union all
    select p.* from knews.portals p, h where h.host like '%.portal24h.news' and p.slug = split_part(h.host, '.', 1)
  )
  select jsonb_build_object('id', f.id, 'slug', f.slug, 'name', f.name, 'theme', f.theme, 'seo', f.seo,
                            'city', c.name, 'city_slug', c.slug,
                            'primary_domain', (select d.domain from knews.portal_domains d where d.portal_id = f.id and d.is_primary))
  from found f join knews.cities c on c.id = f.city_id
  where f.status = 'active' limit 1;
$$;

-- Editorias e bairros com contagem de materias publicadas (navegacao e sitemap).
create or replace function knews_public.portal_sections(p_portal_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('slug', c.slug, 'name', c.name, 'count', (
        select count(*) from knews.articles a where a.portal_id = c.portal_id and a.status = 'published' and a.category = c.slug)) order by c.position, c.name)
      from knews.categories c where c.portal_id = p.id), '[]'::jsonb),
    'neighborhoods', coalesce((
      select jsonb_agg(jsonb_build_object('slug', n.slug, 'name', n.name, 'count', (
        select count(*) from knews.articles a where a.portal_id = p.id and a.status = 'published' and a.neighborhood_id = n.id)) order by n.name)
      from knews.neighborhoods n where n.city_id = p.city_id and n.status = 'active'), '[]'::jsonb))
  from knews.portals p where p.id = p_portal_id and p.status = 'active';
$$;

-- Lista/busca filtrada. Consulta limitada a 100 caracteres; paginas de ate 30.
create or replace function knews_public.search_articles(
  p_portal_id uuid, p_query text default null, p_category text default null, p_neighborhood text default null,
  p_limit int default 20, p_offset int default 0)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select case when length(trim(coalesce(p_query, ''))) between 2 and 100
                then websearch_to_tsquery('portuguese'::regconfig, knews.fold_text(trim(p_query))) end as ts
  ), base as (
    select a.slug, a.title, a.excerpt, a.category, n.slug as neighborhood, a.published_at, a.updated_at,
           case when q.ts is null then 0 else ts_rank(a.search_vector, q.ts) end as rank
    from knews.articles a
    join knews.portals p on p.id = a.portal_id and p.status = 'active'
    left join knews.neighborhoods n on n.id = a.neighborhood_id
    cross join q
    where a.portal_id = p_portal_id and a.status = 'published'
      and (p_category is null or a.category = p_category)
      and (p_neighborhood is null or n.slug = p_neighborhood)
      and (q.ts is null or a.search_vector @@ q.ts)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'items', coalesce((
      select jsonb_agg(row_to_json(x)) from (
        select slug, title, excerpt, category, neighborhood, published_at, updated_at from base
        order by rank desc, published_at desc
        limit least(greatest(p_limit, 1), 30) offset greatest(p_offset, 0)) x), '[]'::jsonb));
$$;

revoke all on function knews_public.portal_sections(uuid) from public;
revoke all on function knews_public.search_articles(uuid, text, text, text, int, int) from public;
grant execute on function knews_public.portal_sections(uuid) to anon, authenticated, service_role;
grant execute on function knews_public.search_articles(uuid, text, text, text, int, int) to anon, authenticated, service_role;
revoke all on function knews.fold_text(text) from public, anon;
grant execute on function knews.fold_text(text) to authenticated, service_role;
revoke all on function knews.valid_portal_theme(jsonb) from public, anon;
revoke all on function knews.valid_portal_seo(jsonb) from public, anon;
grant execute on function knews.valid_portal_theme(jsonb), knews.valid_portal_seo(jsonb) to authenticated, service_role;
