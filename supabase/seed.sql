-- Dados sinteticos para o Supabase LOCAL (aplicado por `supabase db reset`).
-- Nunca executar no projeto remoto compartilhado.
insert into knews.regions (id, name, slug) values
  ('10000000-0000-4000-8000-000000000001', 'Baixada Santista', 'baixada-santista')
on conflict do nothing;

insert into knews.cities (id, region_id, name, slug) values
  ('10000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', 'Guarujá', 'guaruja'),
  ('10000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', 'Santos', 'santos')
on conflict do nothing;

insert into knews.neighborhoods (city_id, name, slug) values
  ('10000000-0000-4000-8000-000000000011', 'Perequê', 'pereque'),
  ('10000000-0000-4000-8000-000000000011', 'Enseada', 'enseada'),
  ('10000000-0000-4000-8000-000000000011', 'Vicente de Carvalho', 'vicente-de-carvalho'),
  ('10000000-0000-4000-8000-000000000011', 'Pitangueiras', 'pitangueiras'),
  ('10000000-0000-4000-8000-000000000012', 'Gonzaga', 'gonzaga'),
  ('10000000-0000-4000-8000-000000000012', 'Ponta da Praia', 'ponta-da-praia')
on conflict do nothing;

insert into knews.portals (id, city_id, name, slug) values
  ('10000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000011', 'Portal 24h Guarujá', 'guaruja'),
  ('10000000-0000-4000-8000-000000000022', '10000000-0000-4000-8000-000000000012', 'Portal 24h Santos', 'santos')
on conflict do nothing;

-- guaruja.localhost / santos.localhost resolvem para 127.0.0.1 nos navegadores.
insert into knews.portal_domains (portal_id, domain, is_primary) values
  ('10000000-0000-4000-8000-000000000021', 'guaruja.localhost', false),
  ('10000000-0000-4000-8000-000000000022', 'santos.localhost', false)
on conflict do nothing;

-- Identidade e editorias sinteticas (P3)
update knews.portals set theme = '{"primary": "#0e7490", "accent": "#f59e0b", "tagline": "Notícias de Guarujá com fonte e correção pública", "logo_text": "Portal 24h Guarujá"}',
  seo = '{"description": "Notícias de Guarujá e dos bairros, com fontes verificáveis."}'
where id = '10000000-0000-4000-8000-000000000021';
update knews.portals set theme = '{"primary": "#1d4ed8", "accent": "#10b981", "tagline": "Santos de ponta a ponta", "logo_text": "Portal 24h Santos"}'
where id = '10000000-0000-4000-8000-000000000022';

insert into knews.categories (portal_id, name, slug, position)
select p.id, c.name, c.slug, c.pos
from knews.portals p
cross join (values ('Cidade', 'cidade', 10), ('Saúde', 'saude', 20), ('Educação', 'educacao', 30), ('Trânsito', 'transito', 40),
                   ('Economia', 'economia', 50), ('Cultura', 'cultura', 60), ('Esportes', 'esportes', 70), ('Meio ambiente', 'meio-ambiente', 80)) as c(name, slug, pos)
where p.id in ('10000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000022')
on conflict do nothing;
