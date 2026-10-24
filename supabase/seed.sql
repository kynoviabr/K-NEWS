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
