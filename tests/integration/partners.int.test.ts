import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { asActor, connect, tryQuery } from "./db";
import { IDS, seed } from "./fixtures";

// Parceiros regionais: territorio exclusivo, acesso comercial delegado pelo territorio,
// comissao definida pela rede, receita confirmada pela gestao, livro de comissoes e
// indicadores isolados por parceiro.

const P1 = "00000000-0000-4000-8000-0000000000b1";
const P2 = "00000000-0000-4000-8000-0000000000b2";
const U1 = "00000000-0000-4000-8000-0000000000c1";
const U2 = "00000000-0000-4000-8000-0000000000c2";
const ART_PUB = "00000000-0000-4000-8000-0000000000d1";
let pg: Client;

// tryQuery usa savepoint: fora do asActor, abre uma transacao curta e confirma.
async function attempt(sql: string, params: unknown[] = []): Promise<{ error: string | null; rowCount: number }> {
  await pg.query("begin");
  try {
    return await tryQuery(pg, sql, params);
  } finally {
    await pg.query("commit");
  }
}

async function members(userId: string): Promise<string[]> {
  const r = await pg.query<{ portal_id: string }>("select portal_id from knews.portal_members where user_id = $1 and partner_id is not null order by portal_id", [userId]);
  return r.rows.map((x) => x.portal_id);
}

async function cleanup(): Promise<void> {
  await pg.query("delete from knews.partner_commissions where partner_id = any($1)", [[P1, P2]]);
  await pg.query("delete from knews.ad_revenue_entries where contract_id in (select id from knews.ad_contracts where reference like 'PARC-%')");
  await pg.query("delete from knews.ad_contracts where reference like 'PARC-%'");
  await pg.query("delete from knews.advertisers where name like 'Parc %'");
  await pg.query("delete from knews.portals where slug = 'vicente-parc'");
  await pg.query("delete from knews.partners where id = any($1)", [[P1, P2]]);
  await pg.query("delete from knews.articles where id = $1", [ART_PUB]);
  await pg.query("delete from knews.audit_logs where target_type in ('partner','partner_commission')");
}

beforeAll(async () => {
  pg = await connect();
  await seed(pg);
  for (const [id, email] of [[U1, "parceiro1@knews.test"], [U2, "parceiro2@knews.test"]]) {
    await pg.query(
      `insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(), now()) on conflict (id) do nothing`,
      [id, email],
    );
  }
  await cleanup();
  await pg.query("insert into knews.partners (id, name) values ($1, 'Parceiro Litoral'), ($2, 'Parceiro Santos')", [P1, P2]);
  await pg.query("insert into knews.partner_users (partner_id, user_id) values ($1, $2), ($3, $4)", [P1, U1, P2, U2]);
  await pg.query("set session_replication_role = replica");
  await pg.query(
    "insert into knews.articles (id, portal_id, slug, title, body, status, published_at) values ($1, $2, 'parc-publicada', 'Publicada', 'texto', 'published', now())",
    [ART_PUB, IDS.portalGuaruja],
  );
  await pg.query("set session_replication_role = origin");
});

afterAll(async () => {
  await cleanup();
  await pg.end();
});

describe("territorios", () => {
  it("sao exclusivos entre cidade e regiao", async () => {
    await pg.query("insert into knews.partner_territories (partner_id, city_id, commission_pct) values ($1, $2, 10)", [P1, IDS.cityGuaruja]);
    expect((await attempt("insert into knews.partner_territories (partner_id, region_id) values ($1, $2)", [P2, IDS.region])).error).toMatch(/ja atribuido ao parceiro Parceiro Litoral/);
    expect((await attempt("insert into knews.partner_territories (partner_id, city_id) values ($1, $2)", [P2, IDS.cityGuaruja])).error).toMatch(/ja atribuido/);
    expect((await attempt("insert into knews.partner_territories (partner_id, city_id, region_id) values ($1, $2, $3)", [P2, IDS.citySantos, IDS.region])).error).toMatch(/territories_scope/);
    await pg.query("insert into knews.partner_territories (partner_id, city_id, commission_pct) values ($1, $2, 15)", [P2, IDS.citySantos]);
  });

  it("dao acesso comercial so aos portais do territorio e o tiram ao encerrar", async () => {
    expect(await members(U1)).toEqual([IDS.portalGuaruja]);
    expect(await members(U2)).toEqual([IDS.portalSantos]);
    const role = await pg.query("select role from knews.portal_members where user_id = $1", [U1]);
    expect(role.rows).toEqual([{ role: "commercial_partner" }]);

    await pg.query("update knews.partners set status = 'suspended' where id = $1", [P1]);
    expect(await members(U1)).toEqual([]);
    await pg.query("update knews.partners set status = 'active' where id = $1", [P1]);
    expect(await members(U1)).toEqual([IDS.portalGuaruja]);

    // Portal novo numa cidade do territorio entra sozinho na carteira do parceiro.
    await asActor(pg, { role: "authenticated", userId: IDS.superAdmin }, async (c) => {
      const r = await c.query<{ id: string }>("select knews.create_portal($1, 'Vicente', 'vicente-parc', 'vicente.parc.localhost') as id", [IDS.cityGuaruja]);
      await c.query("reset role"); // super_admin nao le vinculos alheios pela RLS
      const m = await c.query("select role, partner_id from knews.portal_members where portal_id = $1 and user_id = $2", [r.rows[0]!.id, U1]);
      expect(m.rows).toEqual([{ role: "commercial_partner", partner_id: P1 }]);
    });

    await pg.query("begin");
    await pg.query("update knews.partner_territories set status = 'ended' where partner_id = $1", [P1]);
    expect(await members(U1)).toEqual([]);
    expect((await tryQuery(pg, "update knews.partner_territories set status = 'active' where partner_id = $1", [P1])).error).toMatch(/nao reabre/);
    await pg.query("rollback");
    expect(await members(U1)).toEqual([IDS.portalGuaruja]);
  });

  it("parceiro vende no territorio, nao fora, e nao le pauta da redacao", async () => {
    await asActor(pg, { role: "authenticated", userId: U1 }, async (c) => {
      expect((await tryQuery(c, "insert into knews.advertisers (name, portal_id) values ('Parc Loja', $1)", [IDS.portalGuaruja])).error).toBeNull();
      expect((await tryQuery(c, "insert into knews.advertisers (name, portal_id) values ('Parc Fora', $1)", [IDS.portalSantos])).error).toMatch(/row-level security/);
      const arts = await c.query("select id from knews.articles");
      expect(arts.rows.map((r) => r.id)).toEqual([ART_PUB]);
      expect((await c.query("select id from knews.partners")).rows.map((r) => r.id)).toEqual([P1]);
      expect((await c.query("select partner_id from knews.partner_territories")).rows.map((r) => r.partner_id)).toEqual([P1]);
      expect((await tryQuery(c, "update knews.partner_territories set commission_pct = 90 where partner_id = $1", [P1])).rowCount).toBe(0);
      expect((await tryQuery(c, "delete from knews.partner_territories where partner_id = $1", [P1])).rowCount).toBe(0);
    });
    await asActor(pg, { role: "authenticated", userId: IDS.editorGuaruja }, async (c) => {
      expect((await c.query("select id from knews.articles where id = $1", [IDS.articleGuaruja])).rowCount).toBe(1);
    });
  });

  it("so super_admin vincula pessoas, e nunca quem ja tem funcao interna", async () => {
    await asActor(pg, { role: "authenticated", userId: IDS.managerGuaruja }, async (c) => {
      expect((await tryQuery(c, "select knews.add_partner_user($1, 'parceiro2@knews.test')", [P1])).error).toMatch(/somente super_admin/);
    });
    await asActor(pg, { role: "authenticated", userId: IDS.superAdmin }, async (c) => {
      expect((await tryQuery(c, "select knews.add_partner_user($1, $2)", [P1, `${IDS.editorGuaruja.slice(-4)}@knews.test`])).error).toMatch(/funcao interna/);
      expect((await tryQuery(c, "select knews.add_partner_user($1, 'ninguem@knews.test')", [P1])).error).toMatch(/nao encontrado/);
      expect((await tryQuery(c, "select knews.add_partner_user($1, 'parceiro2@knews.test')", [P1])).error).toMatch(/duplicate key/);
    });
  });
});

describe("contratos, receitas e comissoes", () => {
  let contractId = "";
  let revenueId = "";

  it("contrato do parceiro herda a comissao do territorio", async () => {
    const adv = await pg.query<{ id: string }>("insert into knews.advertisers (name, portal_id) values ('Parc Anunciante', $1) returning id", [IDS.portalGuaruja]);
    await asActor(pg, { role: "authenticated", userId: U1 }, async (c) => {
      const r = await c.query<{ id: string; partner_id: string; commission_pct: string }>(
        `insert into knews.ad_contracts (advertiser_id, portal_id, reference, status, starts_on, ends_on, total_value_cents, partner_id, commission_pct)
         values ($1, $2, 'PARC-1', 'signed', current_date - 10, current_date + 20, 500000, $3, 50) returning id, partner_id, commission_pct`,
        [adv.rows[0]!.id, IDS.portalGuaruja, P2],
      );
      expect(r.rows[0]).toMatchObject({ partner_id: P1, commission_pct: "10.00" });
      expect((await tryQuery(c, "update knews.ad_contracts set commission_pct = 30 where id = $1", [r.rows[0]!.id])).error).toMatch(/somente super_admin/);
    });
    // Persistente para os proximos passos (o asActor desfaz tudo).
    await pg.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: U1, role: "authenticated" })]);
    const r = await pg.query<{ id: string }>(
      `insert into knews.ad_contracts (advertiser_id, portal_id, reference, status, starts_on, ends_on, total_value_cents, signed_at)
       values ($1, $2, 'PARC-1', 'signed', current_date - 10, current_date + 20, 500000, now()) returning id`,
      [adv.rows[0]!.id, IDS.portalGuaruja],
    );
    await pg.query("select set_config('request.jwt.claims', '', false)");
    contractId = r.rows[0]!.id;
  });

  it("parceiro nao confirma receita; a gestao confirma e a comissao entra no livro", async () => {
    await asActor(pg, { role: "authenticated", userId: U1 }, async (c) => {
      expect((await tryQuery(c, "insert into knews.ad_revenue_entries (portal_id, source, contract_id, period_start, period_end, amount_cents, status) values ($1, 'direct', $2, current_date - 10, current_date, 200000, 'confirmed')", [IDS.portalGuaruja, contractId])).error).toMatch(/somente a gestao/);
      expect((await tryQuery(c, "insert into knews.ad_revenue_entries (portal_id, source, contract_id, period_start, period_end, amount_cents, status) values ($1, 'direct', $2, current_date - 10, current_date, 200000, 'estimated')", [IDS.portalGuaruja, contractId])).error).toBeNull();
    });
    const rev = await pg.query<{ id: string }>(
      "insert into knews.ad_revenue_entries (portal_id, source, contract_id, period_start, period_end, amount_cents, status) values ($1, 'direct', $2, current_date - 10, current_date, 200000, 'estimated') returning id",
      [IDS.portalGuaruja, contractId],
    );
    revenueId = rev.rows[0]!.id;
    expect((await pg.query("select count(*)::int n from knews.partner_commissions where revenue_entry_id = $1", [revenueId])).rows[0].n).toBe(0);
    await asActor(pg, { role: "authenticated", userId: U1 }, async (c) => {
      expect((await tryQuery(c, "update knews.ad_revenue_entries set status = 'confirmed' where id = $1", [revenueId])).error).toMatch(/somente a gestao/);
    });
    await pg.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: IDS.managerGuaruja, role: "authenticated" })]);
    await pg.query("update knews.ad_revenue_entries set status = 'confirmed' where id = $1", [revenueId]);
    await pg.query("update knews.ad_revenue_entries set amount_cents = 250000 where id = $1", [revenueId]);
    await pg.query("select set_config('request.jwt.claims', '', false)");
    const c = await pg.query("select partner_id, base_cents, pct, amount_cents, status from knews.partner_commissions where revenue_entry_id = $1", [revenueId]);
    expect(c.rows[0]).toEqual({ partner_id: P1, base_cents: "250000", pct: "10.00", amount_cents: "25000", status: "pending" });
  });

  it("so super_admin aprova e paga, com comprovante; mudanca depois do pagamento pede revisao", async () => {
    const id = (await pg.query("select id from knews.partner_commissions where revenue_entry_id = $1", [revenueId])).rows[0].id;
    await asActor(pg, { role: "authenticated", userId: U1 }, async (c) => {
      expect((await tryQuery(c, "select knews.set_commission_status($1, 'approved')", [id])).error).toMatch(/somente super_admin/);
      expect((await tryQuery(c, "update knews.partner_commissions set amount_cents = 1 where id = $1", [id])).error).toMatch(/permission denied/);
    });
    await pg.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: IDS.superAdmin, role: "authenticated" })]);
    try {
      expect((await attempt("select knews.set_commission_status($1, 'paid', 'PIX-1')", [id])).error).toMatch(/nao permitida/);
      await pg.query("select knews.set_commission_status($1, 'approved')", [id]);
      expect((await attempt("select knews.set_commission_status($1, 'paid', '  ')", [id])).error).toMatch(/comprovante/);
      await pg.query("select knews.set_commission_status($1, 'paid', 'PIX-1')", [id]);
      await pg.query("update knews.ad_revenue_entries set status = 'cancelled' where id = $1", [revenueId]);
    } finally {
      await pg.query("select set_config('request.jwt.claims', '', false)");
    }
    const c = await pg.query("select status, payment_reference, needs_review from knews.partner_commissions where id = $1", [id]);
    expect(c.rows[0]).toEqual({ status: "paid", payment_reference: "PIX-1", needs_review: true });
    expect((await pg.query("select count(*)::int n from knews.audit_logs where target_id = $1", [id])).rows[0].n).toBe(2);
  });

  it("comissoes e indicadores ficam isolados por parceiro", async () => {
    await asActor(pg, { role: "authenticated", userId: U1 }, async (c) => {
      expect((await c.query("select count(*)::int n from knews.partner_commissions")).rows[0].n).toBe(1);
      const ind = (await c.query("select knews.partner_indicators($1, current_date - 30, current_date) as i", [P1])).rows[0].i;
      expect(ind.portals).toEqual([expect.objectContaining({ portal_id: IDS.portalGuaruja, contracts_signed: 1, contracted_cents: 500000, revenue_confirmed_cents: 0, revenue_estimated_cents: 0 })]);
      expect(ind.commissions).toMatchObject({ paid_cents: 25000, needs_review: 1 });
      expect((await c.query("select knews.partner_indicators($1, current_date - 30, current_date) as i", [P2])).rows[0].i).toBeNull();
    });
    await asActor(pg, { role: "authenticated", userId: U2 }, async (c) => {
      expect((await c.query("select count(*)::int n from knews.partner_commissions")).rows[0].n).toBe(0);
      expect((await c.query("select count(*)::int n from knews.ad_contracts")).rows[0].n).toBe(0);
    });
    await asActor(pg, { role: "authenticated", userId: IDS.managerGuaruja }, async (c) => {
      expect((await c.query("select count(*)::int n from knews.partner_commissions")).rows[0].n).toBe(1);
      expect((await c.query("select knews.partner_indicators($1, current_date - 30, current_date) as i", [P1])).rows[0].i).toBeNull();
    });
    await asActor(pg, { role: "authenticated", userId: IDS.editorGuaruja }, async (c) => {
      expect((await c.query("select count(*)::int n from knews.partner_commissions")).rows[0].n).toBe(0);
    });
  });
});
