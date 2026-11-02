import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { asActor, connect, tryQuery } from "./db";
import { IDS, createCampaign, deleteCampaigns, seed } from "./fixtures";

// Motor de entrega real (knews.serve_ad + impressao/clique) contra o Postgres local.
// Cada cenario usa slots proprios para nao interferir nos outros.
let admin: Client;
let svc: Client;
const pool: Client[] = [];
const campaigns: string[] = [];
const slots: string[] = [];
let seq = 0;

function cid(): string {
  seq += 1;
  const id = `00000000-0000-4000-8000-0000000007${seq.toString().padStart(2, "0")}`;
  campaigns.push(id);
  return id;
}

async function slot(fallback: "adsense" | "mgid" | null = null): Promise<string> {
  const code = `int-serve-${slots.length + 1}`;
  slots.push(code);
  await admin.query("insert into knews.ad_slots (portal_id, code, name, fallback_provider) values (null, $1, 'Slot de teste', $2) on conflict (code) do nothing", [code, fallback]);
  return code;
}

type Decision = { kind: string; token?: string; campaign_id?: string; reason?: string; provider?: string; label?: string };

async function serve(slotCode: string, ctx: Record<string, unknown> = {}, portalId: string = IDS.portalGuaruja, c: Client = svc): Promise<Decision> {
  const res = await c.query<{ d: Decision }>("select knews.serve_ad($1, $2, $3) as d", [portalId, slotCode, JSON.stringify(ctx)]);
  return res.rows[0]!.d;
}

async function impression(token: string, visitor: string | null = null): Promise<{ counted: boolean }> {
  const res = await svc.query<{ r: { counted: boolean } }>("select knews.record_ad_impression($1, $2) as r", [token, visitor]);
  return res.rows[0]!.r;
}

async function click(token: string): Promise<{ url: string | null; counted: boolean }> {
  const res = await svc.query<{ r: { url: string | null; counted: boolean } }>("select knews.record_ad_click($1) as r", [token]);
  return res.rows[0]!.r;
}

async function campaignRow(id: string) {
  const res = await admin.query<{ status: string; impressions_served: number; impressions_confirmed: number; clicks: number; budget_spent_cents: number }>(
    "select status, impressions_served, impressions_confirmed, clicks, budget_spent_cents from knews.ad_campaigns where id = $1",
    [id],
  );
  return res.rows[0]!;
}

beforeAll(async () => {
  admin = await connect();
  await seed(admin);
  svc = await connect();
  await svc.query("set role service_role");
  for (let i = 0; i < 8; i++) {
    const c = await connect();
    await c.query("set role service_role");
    pool.push(c);
  }
});

afterAll(async () => {
  await deleteCampaigns(admin, campaigns);
  await admin.query("delete from knews.portal_ad_providers where portal_id = any($1)", [[IDS.portalGuaruja, IDS.portalSantos]]);
  await admin.query("delete from knews.ad_links where portal_id = any($1)", [[IDS.portalGuaruja, IDS.portalSantos]]);
  await admin.query("delete from knews.ad_slots where code = any($1)", [slots]);
  await Promise.all([admin, svc, ...pool].map((c) => c.end()));
});

describe("decisao de entrega", () => {
  it("campanha de maior prioridade vence e o retorno nao expoe o destino", async () => {
    const s = await slot();
    const low = cid();
    const high = cid();
    await createCampaign(admin, { id: low, slots: [s], priority: 100 });
    await createCampaign(admin, { id: high, slots: [s], priority: 600 });
    const d = await serve(s);
    expect(d.kind).toBe("campaign");
    expect(d.campaign_id).toBe(high);
    expect(d.label).toBe("Publicidade");
    expect(JSON.stringify(d)).not.toContain("anunciante.example");
  });

  it("empate de prioridade gira entre campanhas", async () => {
    const s = await slot();
    const a = cid();
    const b = cid();
    await createCampaign(admin, { id: a, slots: [s] });
    await createCampaign(admin, { id: b, slots: [s] });
    const winners = new Set<string>();
    for (let i = 0; i < 6; i++) winners.add((await serve(s)).campaign_id!);
    expect(winners).toEqual(new Set([a, b]));
  });

  it("campanha de Santos nunca aparece em Guaruja (portal e geo)", async () => {
    const s = await slot();
    const santos = cid();
    await createCampaign(admin, { id: santos, slots: [s], portalId: IDS.portalSantos });
    expect((await serve(s)).kind).toBe("none");
    expect((await serve(s, {}, IDS.portalSantos)).campaign_id).toBe(santos);

    const geo = cid();
    await createCampaign(admin, { id: geo, slots: [s] });
    await admin.query("insert into knews.ad_campaign_geo_targets (campaign_id, portal_slug) values ($1, 'santos-teste')", [geo]);
    expect((await serve(s)).kind).toBe("none");
  });

  it("segmenta por bairro, dispositivo e editoria", async () => {
    const s = await slot();
    const id = cid();
    await createCampaign(admin, { id, slots: [s], extra: { device_targets: ["mobile"], category_targets: ["saude"] } });
    await admin.query("insert into knews.ad_campaign_geo_targets (campaign_id, city_slug, neighborhood_slug) values ($1, 'guaruja', 'pereque')", [id]);
    expect((await serve(s, { device: "mobile", category: "saude", neighborhood: "pereque" })).campaign_id).toBe(id);
    expect((await serve(s, { device: "desktop", category: "saude", neighborhood: "pereque" })).kind).toBe("none");
    expect((await serve(s, { device: "mobile", category: "esportes", neighborhood: "pereque" })).kind).toBe("none");
    expect((await serve(s, { device: "mobile", category: "saude", neighborhood: "enseada" })).kind).toBe("none");
  });

  it("pausa e termino cessam a entrega na hora; encerramento automatico", async () => {
    const s = await slot();
    const id = cid();
    await createCampaign(admin, { id, slots: [s] });
    expect((await serve(s)).campaign_id).toBe(id);
    await admin.query("update knews.ad_campaigns set status = 'paused', status_reason = 'pedido do cliente' where id = $1", [id]);
    expect((await serve(s)).kind).toBe("none");
    await admin.query("update knews.ad_campaigns set status = 'active' where id = $1", [id]);
    // Simula o relogio passando do termino (a guarda recusaria editar a janela para o passado).
    await admin.query("set session_replication_role = replica");
    await admin.query("update knews.ad_campaigns set starts_at = now() - interval '3 days', ends_at = now() - interval '1 minute' where id = $1", [id]);
    await admin.query("set session_replication_role = origin");
    expect((await serve(s)).kind).toBe("none");
    await svc.query("select knews.close_finished_campaigns()");
    expect((await campaignRow(id)).status).toBe("ended");
    const audit = await admin.query("select action from knews.audit_logs where target_id = $1 order by at", [id]);
    expect(audit.rows.map((r) => r.action)).toEqual(["campaign.active", "campaign.paused", "campaign.active", "campaign.ended"]);
  });

  it("limite de frequencia por visitante conta impressoes confirmadas", async () => {
    const s = await slot();
    const id = cid();
    await createCampaign(admin, { id, slots: [s], extra: { frequency_cap_per_user: 2 } });
    for (let i = 0; i < 2; i++) {
      const d = await serve(s, { visitor_hash: "visitante-a" });
      expect(d.campaign_id).toBe(id);
      expect((await impression(d.token!)).counted).toBe(true);
    }
    expect((await serve(s, { visitor_hash: "visitante-a" })).kind).toBe("none");
    expect((await serve(s, { visitor_hash: "visitante-b" })).campaign_id).toBe(id);
  });

  it("cap diario e pacing uniforme", async () => {
    const s = await slot();
    const daily = cid();
    await createCampaign(admin, { id: daily, slots: [s], extra: { daily_impressions_cap: 3 } });
    const got = [];
    for (let i = 0; i < 5; i++) got.push((await serve(s)).kind);
    expect(got).toEqual(["campaign", "campaign", "campaign", "none", "none"]);

    const s2 = await slot();
    const even = cid();
    // 21 dias de janela restante (20 + 1 iniciado) e cap 42: cerca de 2 por dia.
    await createCampaign(admin, { id: even, slots: [s2], impressionsCap: 42, extra: { pacing: "even" } });
    const today = [];
    for (let i = 0; i < 5; i++) today.push((await serve(s2)).kind);
    expect(today.filter((k) => k === "campaign").length).toBeLessThanOrEqual(3);
    expect(today.filter((k) => k === "campaign").length).toBeGreaterThanOrEqual(2);
  });

  it("fallback: paga -> provedor aprovado -> casa", async () => {
    const s = await slot("adsense");
    const house = cid();
    await createCampaign(admin, { id: house, slots: [s], kind: "house", extra: { disclosure_label: "Conteúdo da casa" } });
    expect((await serve(s)).campaign_id).toBe(house);

    // Provedor cadastrado mas nao aprovado nao entra.
    await admin.query(
      "insert into knews.portal_ad_providers (portal_id, provider, publisher_id, enabled) values ($1, 'adsense', 'pub-0000000000000000', false)",
      [IDS.portalGuaruja],
    );
    expect((await serve(s)).campaign_id).toBe(house);
    await admin.query("update knews.portal_ad_providers set enabled = true, approved_at = now() where portal_id = $1", [IDS.portalGuaruja]);
    expect((await serve(s)).kind).toBe("provider");

    const paid = cid();
    await createCampaign(admin, { id: paid, slots: [s] });
    expect((await serve(s)).campaign_id).toBe(paid);
  });
});

describe("concorrencia e contabilidade", () => {
  it("40 decisoes simultaneas com cap 10 entregam exatamente 10", async () => {
    const s = await slot();
    const id = cid();
    await createCampaign(admin, { id, slots: [s], impressionsCap: 10 });
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => serve(s, {}, IDS.portalGuaruja, pool[i % pool.length]!)));
    expect(results.filter((r) => r.kind === "campaign").length).toBe(10);
    const reservations = await admin.query("select count(*)::int as n from knews.ad_reservations where campaign_id = $1", [id]);
    expect(reservations.rows[0].n).toBe(10);
    expect((await campaignRow(id)).impressions_served).toBe(10);
  });

  it("impressao e clique contam uma vez; CPC esgota orcamento e para a entrega", async () => {
    const s = await slot();
    const id = cid();
    await createCampaign(admin, { id, slots: [s], extra: { pricing_model: "cpc", rate_cents: 50, budget_cents: 100 } });
    const d1 = await serve(s);
    expect((await impression(d1.token!)).counted).toBe(true);
    expect((await impression(d1.token!)).counted).toBe(false);
    const c1 = await click(d1.token!);
    expect(c1).toEqual({ url: "https://anunciante.example/oferta", counted: true });
    expect((await click(d1.token!)).counted).toBe(false);

    // Clique sem beacon (JS desligado) confirma a impressao junto.
    const d2 = await serve(s);
    expect((await click(d2.token!)).counted).toBe(true);
    const row = await campaignRow(id);
    expect(row).toMatchObject({ impressions_confirmed: 2, clicks: 2, budget_spent_cents: 100 });
    expect((await serve(s)).kind).toBe("none");

    const stats = await admin.query("select sum(reserved)::int r, sum(impressions)::int i, sum(clicks)::int c from knews.ad_daily_stats where campaign_id = $1", [id]);
    expect(stats.rows[0]).toEqual({ r: 2, i: 2, c: 2 });
    expect((await click("token-inexistente")).url).toBeNull();
  });

  it("reservas abandonadas devolvem uma unidade por reserva, sem eventos duplicados", async () => {
    const s = await slot();
    const id = cid();
    await createCampaign(admin, { id, slots: [s], impressionsCap: 5 });
    const tokens = [];
    for (let i = 0; i < 3; i++) tokens.push((await serve(s)).token!);
    await impression(tokens[0]!);
    await admin.query("update knews.ad_reservations set expires_at = now() - interval '1 second' where campaign_id = $1 and status = 'reserved'", [id]);
    await svc.query("select knews.expire_stale_reservations()");
    await svc.query("select knews.expire_stale_reservations()");
    expect((await campaignRow(id)).impressions_served).toBe(1);
    const expired = await admin.query("select count(*)::int n from knews.ad_events where campaign_id = $1 and kind = 'expire'", [id]);
    expect(expired.rows[0].n).toBe(2);
    expect((await impression(tokens[1]!)).counted).toBe(false);
  });
});

describe("guarda de ativacao", () => {
  it("recusa campanha paga sem contrato, com contrato de outro portal ou sem criativo aprovado", async () => {
    const s = await slot();
    const id = cid();
    await admin.query(
      `insert into knews.ad_campaigns (id, advertiser_id, portal_id, name, status, ends_at) values ($1, $2, $3, 'Sem contrato', 'draft', now() + interval '5 days')`,
      [id, IDS.advertiser, IDS.portalGuaruja],
    );
    await admin.query("insert into knews.ad_campaign_placements (campaign_id, slot_code) values ($1, $2)", [id, s]);
    const activate = () => tryQueryAdmin("update knews.ad_campaigns set status = 'active' where id = $1", [id]);
    expect(await activate()).toMatch(/contrato assinado/);

    const other = await admin.query<{ id: string }>(
      `insert into knews.ad_contracts (advertiser_id, portal_id, reference, status, starts_on, ends_on, signed_at)
       values ($1, $2, 'CT-OUTRO', 'signed', current_date - 1, current_date + 30, now()) returning id`,
      [IDS.advertiser, IDS.portalSantos],
    );
    await admin.query("update knews.ad_campaigns set contract_id = $2 where id = $1", [id, other.rows[0]!.id]);
    expect(await activate()).toMatch(/outro anunciante ou portal/);

    const own = await admin.query<{ id: string }>(
      `insert into knews.ad_contracts (advertiser_id, portal_id, reference, status, starts_on, ends_on, signed_at)
       values ($1, $2, 'CT-PROPRIO', 'signed', current_date - 1, current_date + 30, now()) returning id`,
      [IDS.advertiser, IDS.portalGuaruja],
    );
    await admin.query("update knews.ad_campaigns set contract_id = $2 where id = $1", [id, own.rows[0]!.id]);
    expect(await activate()).toMatch(/criativo aprovado/);
    await admin.query("update knews.ad_campaigns set contract_id = null where id = $1", [id]);
    await admin.query("delete from knews.ad_contracts where id = any($1)", [[other.rows[0]!.id, own.rows[0]!.id]]);
  });

  it("campanha no ar nao pode estender a janela alem do contrato", async () => {
    const s = await slot();
    const id = cid();
    await createCampaign(admin, { id, slots: [s] });
    expect(await tryQueryAdmin("update knews.ad_campaigns set ends_at = now() + interval '200 days' where id = $1", [id])).toMatch(/vigencia do contrato/);
    expect(await tryQueryAdmin("update knews.ad_campaigns set ends_at = now() + interval '30 days' where id = $1", [id])).toBeNull();
  });

  it("trocar o destino de um criativo aprovado volta para revisao", async () => {
    const s = await slot();
    const id = cid();
    await createCampaign(admin, { id, slots: [s] });
    await admin.query("update knews.ad_creatives set click_url = 'https://outro.example/x' where campaign_id = $1", [id]);
    const cr = await admin.query("select status from knews.ad_creatives where campaign_id = $1", [id]);
    expect(cr.rows[0].status).toBe("pending");
    expect((await serve(s)).kind).toBe("none");
  });

  it("recusa destino sem https", async () => {
    const s = await slot();
    const id = cid();
    await createCampaign(admin, { id, slots: [s] });
    expect(await tryQueryAdmin("update knews.ad_creatives set click_url = 'javascript:alert(1)' where campaign_id = $1", [id])).toMatch(/click_url/);
  });
});

async function tryQueryAdmin(sql: string, params: unknown[]): Promise<string | null> {
  await admin.query("begin");
  const r = await tryQuery(admin, sql, params);
  await admin.query("rollback");
  return r.error;
}

describe("permissoes do Revenue Center", () => {
  it("anon e authenticated nao executam o motor; so service_role", async () => {
    for (const role of ["anon", "authenticated"]) {
      const res = await admin.query(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'knews' and p.proname in ('serve_ad', 'record_ad_impression', 'record_ad_click', 'record_link_click', 'reserve_ad', 'expire_stale_reservations', 'close_finished_campaigns')
           and has_function_privilege($1, p.oid, 'execute')`,
        [role],
      );
      expect(res.rows).toEqual([]);
    }
  });

  it("editor de redacao nao cria anunciante nem campanha; comercial cria so no seu portal", async () => {
    await asActor(admin, { role: "authenticated", userId: IDS.editorGuaruja }, async (c) => {
      expect((await tryQuery(c, "insert into knews.advertisers (name, portal_id) values ('X', $1)", [IDS.portalGuaruja])).error).toMatch(/row-level security/);
      expect((await tryQuery(c, "insert into knews.ad_campaigns (advertiser_id, portal_id, name) values ($1, $2, 'X')", [IDS.advertiser, IDS.portalGuaruja])).error).toMatch(
        /row-level security/,
      );
    });
    await asActor(admin, { role: "authenticated", userId: IDS.commercialGuaruja }, async (c) => {
      expect((await tryQuery(c, "insert into knews.advertisers (name, portal_id) values ('Loja do Perequê', $1)", [IDS.portalGuaruja])).error).toBeNull();
      expect((await tryQuery(c, "insert into knews.advertisers (name, portal_id) values ('Loja de Santos', $1)", [IDS.portalSantos])).error).toMatch(/row-level security/);
      expect((await tryQuery(c, "insert into knews.advertisers (name) values ('Rede')")).error).toMatch(/row-level security/);
      expect((await tryQuery(c, "insert into knews.ad_campaigns (advertiser_id, portal_id, name) values ($1, $2, 'Campanha X')", [IDS.advertiser, IDS.portalGuaruja])).error).toBeNull();
      // Contadores de entrega so mudam pelo motor.
      expect((await tryQuery(c, "update knews.ad_campaigns set impressions_served = 0, clicks = 999 where portal_id = $1", [IDS.portalGuaruja])).error).toMatch(/permission denied/);
      expect((await tryQuery(c, "update knews.ad_links set clicks = 999")).error).toMatch(/permission denied/);
      // Provedor programatico: so super_admin liga.
      expect(
        (await tryQuery(c, "insert into knews.portal_ad_providers (portal_id, provider, publisher_id) values ($1, 'mgid', 'pub-1234')", [IDS.portalGuaruja])).error,
      ).toMatch(/row-level security/);
    });
  });

  it("comercial de Guaruja nao le contratos, receitas nem estatisticas de Santos", async () => {
    const s = await slot();
    const id = cid();
    await createCampaign(admin, { id, slots: [s], portalId: IDS.portalSantos });
    await serve(s, {}, IDS.portalSantos);
    await admin.query(
      `insert into knews.ad_revenue_entries (portal_id, source, period_start, period_end, amount_cents, status) values ($1, 'adsense', current_date - 30, current_date, 12345, 'confirmed')`,
      [IDS.portalSantos],
    );
    await asActor(admin, { role: "authenticated", userId: IDS.commercialGuaruja }, async (c) => {
      for (const table of ["ad_contracts", "ad_revenue_entries", "ad_daily_stats", "ad_reservations"]) {
        const r = await c.query(`select count(*)::int n from knews.${table} where portal_id = $1`, [IDS.portalSantos]);
        expect(r.rows[0].n, table).toBe(0);
      }
      const f = await tryQuery(c, "select * from knews.ad_frequency");
      expect(f.error).toMatch(/permission denied/);
    });
    await asActor(admin, { role: "authenticated", userId: IDS.outsider }, async (c) => {
      const r = await c.query("select count(*)::int n from knews.ad_campaigns");
      expect(r.rows[0].n).toBe(0);
    });
    await admin.query("delete from knews.ad_revenue_entries where portal_id = $1", [IDS.portalSantos]);
  });
});

describe("links afiliados, produtos proprios e ads.txt", () => {
  it("redirecionamento resolve so no portal dono e conta o clique", async () => {
    await admin.query(
      `insert into knews.ad_links (portal_id, code, title, kind, destination_url) values ($1, 'kit-praia', 'Kit praia', 'affiliate', 'https://loja.example/kit?aff=knews')`,
      [IDS.portalGuaruja],
    );
    const ok = await svc.query("select knews.record_link_click($1, 'kit-praia', 'v1', '/noticia/x') as r", [IDS.portalGuaruja]);
    expect(ok.rows[0].r).toEqual({ url: "https://loja.example/kit?aff=knews", rel: "sponsored nofollow noopener" });
    const other = await svc.query("select knews.record_link_click($1, 'kit-praia') as r", [IDS.portalSantos]);
    expect(other.rows[0].r.url).toBeNull();
    const n = await admin.query("select clicks from knews.ad_links where portal_id = $1 and code = 'kit-praia'", [IDS.portalGuaruja]);
    expect(n.rows[0].clicks).toBe(1);
    expect(
      await tryQueryAdmin("insert into knews.ad_links (portal_id, code, title, kind, destination_url, rel) values ($1, 'sem-rel', 'Sem rel', 'affiliate', 'https://a.example', 'nofollow')", [
        IDS.portalGuaruja,
      ]),
    ).toMatch(/rel_check/);
  });

  it("ads.txt publica so provedores aprovados do dominio", async () => {
    await admin.query("insert into knews.portal_domains (portal_id, domain) values ($1, 'guaruja-teste.localhost') on conflict do nothing", [IDS.portalGuaruja]);
    await admin.query(
      `insert into knews.portal_ad_providers (portal_id, provider, publisher_id, enabled, approved_at, ads_txt_line)
       values ($1, 'mgid', 'pub-777', false, null, 'mgid.com, 777, DIRECT')
       on conflict (portal_id, provider) do update set ads_txt_line = excluded.ads_txt_line, enabled = false, approved_at = null`,
      [IDS.portalGuaruja],
    );
    const anon = await connect();
    await anon.query("set role anon");
    const before = await anon.query("select knews_public.ads_txt('guaruja-teste.localhost') as l");
    expect(before.rows).toEqual([]);
    await admin.query("update knews.portal_ad_providers set enabled = true, approved_at = now() where provider = 'mgid' and portal_id = $1", [IDS.portalGuaruja]);
    const after = await anon.query("select knews_public.ads_txt('guaruja-teste.localhost') as l");
    expect(after.rows.map((r) => r.l)).toEqual(["mgid.com, 777, DIRECT"]);
    await anon.end();
    await admin.query("delete from knews.portal_domains where domain = 'guaruja-teste.localhost'");
  });
});
