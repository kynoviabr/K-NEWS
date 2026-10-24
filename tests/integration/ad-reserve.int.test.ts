import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connect } from "./db";
import { IDS, seed } from "./fixtures";

// knews.reserve_ad sob concorrencia real: o cap de impressoes nunca e ultrapassado.
const CAMPAIGN = "00000000-0000-4000-8000-000000000061";
const SLOT = "int-test-topo";
let admin: Client;
const conns: Client[] = [];

beforeAll(async () => {
  admin = await connect();
  await seed(admin);
  await admin.query("insert into knews.ad_slots (portal_id, code, name) values ($1, $2, 'Topo (teste)') on conflict (code) do nothing", [IDS.portalGuaruja, SLOT]);
  for (let i = 0; i < 6; i++) {
    const c = await connect();
    await c.query("set role service_role");
    conns.push(c);
  }
});

afterAll(async () => {
  await admin.query("delete from knews.ad_campaigns where id = $1", [CAMPAIGN]);
  await admin.query("delete from knews.ad_slots where code = $1", [SLOT]);
  await Promise.all([admin, ...conns].map((c) => c.end()));
});

async function resetCampaign(cap: number): Promise<void> {
  await admin.query("delete from knews.ad_campaigns where id = $1", [CAMPAIGN]);
  await admin.query(
    `insert into knews.ad_campaigns (id, advertiser_id, portal_id, name, status, starts_at, ends_at, impressions_cap)
     values ($1, $2, $3, 'Campanha teste', 'active', now() - interval '1 day', now() + interval '1 day', $4)`,
    [CAMPAIGN, IDS.advertiser, IDS.portalGuaruja, cap],
  );
  await admin.query("insert into knews.ad_campaign_placements (campaign_id, slot_code) values ($1, $2)", [CAMPAIGN, SLOT]);
}

async function reserve(c: Client, key: string): Promise<"ok" | "idempotent" | "rejected"> {
  try {
    const res = await c.query<{ r: { idempotent: boolean } }>("select knews.reserve_ad($1, $2, $3, 300) as r", [CAMPAIGN, SLOT, key]);
    return res.rows[0]?.r.idempotent ? "idempotent" : "ok";
  } catch {
    return "rejected";
  }
}

describe("knews.reserve_ad concorrente", () => {
  it("60 reservas simultaneas com cap 25 entregam exatamente 25", async () => {
    await resetCampaign(25);
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => reserve(conns[i % conns.length]!, `visita-${i.toString().padStart(4, "0")}`)));
    expect(results.filter((r) => r === "ok").length).toBe(25);
    const row = await admin.query<{ served: number; reservations: string }>(
      `select c.impressions_served as served, (select count(*)::text from knews.ad_reservations r where r.campaign_id = c.id) as reservations
       from knews.ad_campaigns c where c.id = $1`,
      [CAMPAIGN],
    );
    expect(row.rows[0]).toEqual({ served: 25, reservations: "25" });
  });

  it("mesma chave de idempotencia nao consome duas vezes", async () => {
    await resetCampaign(10);
    const results = await Promise.all(conns.map((c) => reserve(c, "mesma-visita-123")));
    expect(results.filter((r) => r === "ok").length).toBe(1);
    const row = await admin.query<{ served: number }>("select impressions_served as served from knews.ad_campaigns where id = $1", [CAMPAIGN]);
    expect(row.rows[0]?.served).toBe(1);
  });
});
