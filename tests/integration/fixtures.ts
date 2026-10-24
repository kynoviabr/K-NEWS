import type { Client } from "pg";

// Dados sinteticos de Guaruja e Santos. IDs fixos para facilitar asserts.
export const IDS = {
  region: "00000000-0000-4000-8000-000000000001",
  cityGuaruja: "00000000-0000-4000-8000-000000000011",
  citySantos: "00000000-0000-4000-8000-000000000012",
  portalGuaruja: "00000000-0000-4000-8000-000000000021",
  portalSantos: "00000000-0000-4000-8000-000000000022",
  editorGuaruja: "00000000-0000-4000-8000-000000000031",
  editorSantos: "00000000-0000-4000-8000-000000000032",
  commercialGuaruja: "00000000-0000-4000-8000-000000000033",
  superAdmin: "00000000-0000-4000-8000-000000000034",
  // Usuario autenticado sem vinculo K-NEWS (ex.: cliente do BLOGGER no Auth compartilhado)
  outsider: "00000000-0000-4000-8000-000000000035",
  articleGuaruja: "00000000-0000-4000-8000-000000000041",
  articleSantos: "00000000-0000-4000-8000-000000000042",
  advertiser: "00000000-0000-4000-8000-000000000051",
} as const;

export async function seed(client: Client): Promise<void> {
  const users = [IDS.editorGuaruja, IDS.editorSantos, IDS.commercialGuaruja, IDS.superAdmin, IDS.outsider];
  for (const id of users) {
    await client.query(
      `insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(), now())
       on conflict (id) do nothing`,
      [id, `${id.slice(-4)}@knews.test`],
    );
  }
  await client.query(
    `insert into knews.regions (id, name, slug) values ($1, 'Baixada Santista', 'baixada-santista') on conflict (id) do nothing`,
    [IDS.region],
  );
  await client.query(
    `insert into knews.cities (id, region_id, name, slug) values ($1, $3, 'Guarujá', 'guaruja'), ($2, $3, 'Santos', 'santos') on conflict (id) do nothing`,
    [IDS.cityGuaruja, IDS.citySantos, IDS.region],
  );
  await client.query(
    `insert into knews.portals (id, city_id, name, slug) values ($1, $3, 'Portal 24h Guarujá', 'guaruja'), ($2, $4, 'Portal 24h Santos', 'santos') on conflict (id) do nothing`,
    [IDS.portalGuaruja, IDS.portalSantos, IDS.cityGuaruja, IDS.citySantos],
  );
  await client.query(
    `insert into knews.portal_members (portal_id, user_id, role) values
       ($1, $3, 'regional_editor'), ($2, $4, 'regional_editor'), ($1, $5, 'commercial_partner'), ($1, $6, 'super_admin')
     on conflict do nothing`,
    [IDS.portalGuaruja, IDS.portalSantos, IDS.editorGuaruja, IDS.editorSantos, IDS.commercialGuaruja, IDS.superAdmin],
  );
  await client.query(
    `insert into knews.articles (id, portal_id, slug, title, status) values
       ($1, $3, 'teste-guaruja', 'Teste Guarujá', 'draft'), ($2, $4, 'teste-santos', 'Teste Santos', 'draft')
     on conflict (id) do nothing`,
    [IDS.articleGuaruja, IDS.articleSantos, IDS.portalGuaruja, IDS.portalSantos],
  );
  await client.query(`insert into knews.advertisers (id, name) values ($1, 'Anunciante Sintético') on conflict (id) do nothing`, [
    IDS.advertiser,
  ]);
}
