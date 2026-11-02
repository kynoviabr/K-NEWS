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
    `insert into knews.regions (id, name, slug) values ($1, 'Baixada Santista (teste)', 'baixada-teste') on conflict (id) do nothing`,
    [IDS.region],
  );
  await client.query(
    `insert into knews.cities (id, region_id, name, slug) values ($1, $3, 'Guarujá', 'guaruja'), ($2, $3, 'Santos', 'santos') on conflict (id) do nothing`,
    [IDS.cityGuaruja, IDS.citySantos, IDS.region],
  );
  await client.query(
    `insert into knews.portals (id, city_id, name, slug) values ($1, $3, 'Portal 24h Guarujá (teste)', 'guaruja-teste'), ($2, $4, 'Portal 24h Santos (teste)', 'santos-teste') on conflict (id) do nothing`,
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

export type CampaignSpec = {
  id: string;
  portalId?: string;
  slots: string[];
  kind?: "direct" | "house";
  status?: "active" | "draft";
  impressionsCap?: number | null;
  priority?: number;
  extra?: Record<string, unknown>;
  creativeUrl?: string;
};

// Cria campanha pelo caminho real: contrato assinado -> rascunho -> slots e criativo
// aprovado -> ativacao (a guarda do banco recusa qualquer atalho).
export async function createCampaign(client: Client, spec: CampaignSpec): Promise<void> {
  const portalId = spec.portalId ?? IDS.portalGuaruja;
  const kind = spec.kind ?? "direct";
  let contractId: string | null = null;
  if (kind === "direct") {
    const contract = await client.query<{ id: string }>(
      `insert into knews.ad_contracts (advertiser_id, portal_id, reference, status, starts_on, ends_on, total_value_cents, signed_at)
       values ($1, $2, $3, 'signed', current_date - 30, current_date + 60, 100000, now()) returning id`,
      [IDS.advertiser, portalId, `CT-${spec.id.slice(-6)}`],
    );
    contractId = contract.rows[0]!.id;
  }
  const extra = spec.extra ?? {};
  const cols = Object.keys(extra);
  await client.query(
    `insert into knews.ad_campaigns (id, advertiser_id, portal_id, contract_id, kind, name, status, starts_at, ends_at, impressions_cap, priority${cols.map((c) => `, ${c}`).join("")})
     values ($1, $2, $3, $4, $5, $6, 'draft', now() - interval '1 day', now() + interval '20 days', $7, $8${cols.map((_, i) => `, $${i + 9}`).join("")})`,
    [spec.id, IDS.advertiser, portalId, contractId, kind, `Campanha ${spec.id.slice(-4)}`, spec.impressionsCap ?? null, spec.priority ?? 100, ...cols.map((c) => extra[c])],
  );
  for (const slot of spec.slots) {
    await client.query("insert into knews.ad_campaign_placements (campaign_id, slot_code) values ($1, $2)", [spec.id, slot]);
  }
  await client.query(
    `insert into knews.ad_creatives (campaign_id, format, headline, body_text, click_url, status) values ($1, 'text', $2, 'Oferta sintetica', $3, 'approved')`,
    [spec.id, `Anuncio ${spec.id.slice(-4)}`, spec.creativeUrl ?? "https://anunciante.example/oferta"],
  );
  if ((spec.status ?? "active") === "active") {
    await client.query("update knews.ad_campaigns set status = 'active' where id = $1", [spec.id]);
  }
}

export async function deleteCampaigns(client: Client, ids: string[]): Promise<void> {
  const res = await client.query<{ contract_id: string | null }>("delete from knews.ad_campaigns where id = any($1) returning contract_id", [ids]);
  const contracts = res.rows.map((r) => r.contract_id).filter(Boolean);
  if (contracts.length) await client.query("delete from knews.ad_contracts where id = any($1)", [contracts]);
  await client.query("delete from knews.audit_logs where target_type = 'ad_campaign' and target_id = any($1)", [ids]);
}
