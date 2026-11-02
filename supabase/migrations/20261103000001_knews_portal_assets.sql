-- K-NEWS — logotipo e favicon por portal
-- NAO APLICAR EM PRODUCAO SEM APROVACAO EXPLICITA
-- Bucket publico knews-portal-assets: objetos em <portal_id>/<logo|icon>-<uuid>.<ext>.
-- Leitura publica (aparecem no portal); escrita so pela gestao do portal. Sem SVG:
-- um SVG servido pelo dominio do Storage pode carregar script.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('knews-portal-assets', 'knews-portal-assets', true, 524288, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function knews.can_manage_portal_asset(object_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  folder text;
begin
  -- Exatamente <portal_id>/<logo|icon>-<uuid>.<ext>, sem subpastas nem "..".
  if object_name is null
     or object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(logo|icon)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$' then
    return false;
  end if;
  folder := split_part(object_name, '/', 1);
  return knews.is_super_admin() or knews.can_manage_portal(folder::uuid);
end;
$$;
revoke all on function knews.can_manage_portal_asset(text) from public, anon;
grant execute on function knews.can_manage_portal_asset(text) to authenticated, service_role;

create policy "knews_portal_assets_insert" on storage.objects for insert to authenticated
with check (bucket_id = 'knews-portal-assets' and knews.can_manage_portal_asset(name));
create policy "knews_portal_assets_delete" on storage.objects for delete to authenticated
using (bucket_id = 'knews-portal-assets' and knews.can_manage_portal_asset(name));
-- select para a gestao listar e apagar; o publico le pela URL publica do bucket.
create policy "knews_portal_assets_select" on storage.objects for select to authenticated
using (bucket_id = 'knews-portal-assets' and knews.can_manage_portal_asset(name));

-- Tema aceita logo_path e icon_path: caminho no bucket, do proprio portal.
create or replace function knews.valid_portal_theme(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object'
    and not exists (select 1 from jsonb_object_keys(p) k where k not in ('primary', 'accent', 'tagline', 'logo_text', 'logo_path', 'icon_path'))
    and (not p ? 'primary' or (p->>'primary') ~ '^#[0-9a-fA-F]{6}$')
    and (not p ? 'accent' or (p->>'accent') ~ '^#[0-9a-fA-F]{6}$')
    and (not p ? 'tagline' or length(p->>'tagline') <= 120)
    and (not p ? 'logo_text' or length(p->>'logo_text') <= 40)
    and (not p ? 'logo_path' or (p->>'logo_path') ~ '^[0-9a-f-]{36}/logo-[0-9a-f-]{36}\.(png|jpg|webp)$')
    and (not p ? 'icon_path' or (p->>'icon_path') ~ '^[0-9a-f-]{36}/icon-[0-9a-f-]{36}\.(png|jpg|webp)$');
$$;
alter table knews.portals add constraint knews_portals_assets_own check (
  (not theme ? 'logo_path' or split_part(theme->>'logo_path', '/', 1) = id::text)
  and (not theme ? 'icon_path' or split_part(theme->>'icon_path', '/', 1) = id::text)
);
