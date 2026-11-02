import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { asActor, connect, tryQuery } from "./db";
import { IDS, seed } from "./fixtures";

let db: Client;

beforeAll(async () => {
  db = await connect();
  await db.query("begin");
  await seed(db);
  await db.query("commit");
});

afterAll(async () => {
  await db?.end();
});

async function count(c: Client, sql: string, params: unknown[] = []): Promise<number> {
  const res = await c.query<{ n: string }>(`select count(*)::text as n from (${sql}) q`, params);
  return Number(res.rows[0]?.n ?? 0);
}

describe("schema knews: anon", () => {
  it("nao tem USAGE no schema", async () => {
    const res = await db.query<{ ok: boolean }>("select has_schema_privilege('anon', 'knews', 'usage') as ok");
    expect(res.rows[0]?.ok).toBe(false);
  });

  it("nao le artigos nem anunciantes", async () => {
    await asActor(db, { role: "anon" }, async (c) => {
      expect((await tryQuery(c, "select * from knews.articles")).error).toMatch(/permission denied/);
      expect((await tryQuery(c, "select * from knews.advertisers")).error).toMatch(/permission denied/);
    });
  });

  it("nao executa funcoes knews", async () => {
    const res = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'knews' and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(res.rows.map((r) => r.proname)).toEqual([]);
  });
});

describe("funcoes privilegiadas", () => {
  it("fila e ad server so executam com service_role", async () => {
    const res = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'knews'
         and p.proname in ('claim_jobs','complete_job','fail_job','heartbeat_job','expire_stale_reservations','get_job_health','reserve_ad')
         and (has_function_privilege('authenticated', p.oid, 'execute') or not has_function_privilege('service_role', p.oid, 'execute'))`,
    );
    expect(res.rows.map((r) => r.proname)).toEqual([]);
  });

  it("usuario autenticado nao reivindica jobs via RPC", async () => {
    await asActor(db, { role: "authenticated", userId: IDS.outsider }, async (c) => {
      expect((await tryQuery(c, "select * from knews.claim_jobs('intruso', 10, 60)")).error).toMatch(/permission denied/);
    });
  });
});

describe("isolamento entre portais (Guarujá x Santos)", () => {
  it("editor de Guarujá ve so artigos de Guarujá", async () => {
    await asActor(db, { role: "authenticated", userId: IDS.editorGuaruja }, async (c) => {
      const res = await c.query<{ id: string }>("select id from knews.articles where id = any($1)", [
        [IDS.articleGuaruja, IDS.articleSantos],
      ]);
      expect(res.rows.map((r) => r.id)).toEqual([IDS.articleGuaruja]);
    });
  });

  it("editor de Guarujá nao altera nem apaga artigo de Santos", async () => {
    await asActor(db, { role: "authenticated", userId: IDS.editorGuaruja }, async (c) => {
      expect((await tryQuery(c, "update knews.articles set title = 'x' where id = $1", [IDS.articleSantos])).rowCount).toBe(0);
      expect((await tryQuery(c, "delete from knews.articles where id = $1", [IDS.articleSantos])).rowCount).toBe(0);
    });
  });

  it("editor de Guarujá nao cria artigo no portal de Santos", async () => {
    await asActor(db, { role: "authenticated", userId: IDS.editorGuaruja }, async (c) => {
      const r = await tryQuery(c, "insert into knews.articles (portal_id, slug, title) values ($1, 'invasao', 'x')", [IDS.portalSantos]);
      expect(r.error).toMatch(/row-level security/);
    });
  });

  it("parceiro comercial nao edita conteudo editorial do proprio portal", async () => {
    await asActor(db, { role: "authenticated", userId: IDS.commercialGuaruja }, async (c) => {
      expect((await tryQuery(c, "update knews.articles set title = 'x' where id = $1", [IDS.articleGuaruja])).rowCount).toBe(0);
    });
  });

  it("membro ve apenas os proprios vinculos", async () => {
    await asActor(db, { role: "authenticated", userId: IDS.editorSantos }, async (c) => {
      const res = await c.query<{ portal_id: string }>("select portal_id from knews.portal_members");
      expect(res.rows.map((r) => r.portal_id)).toEqual([IDS.portalSantos]);
    });
  });
});

describe("usuario autenticado sem vinculo K-NEWS (Auth compartilhado com BLOGGER)", () => {
  const outsider = { role: "authenticated" as const, userId: IDS.outsider };

  it("nao ve nenhum dado de negocio do K-NEWS", async () => {
    await asActor(db, outsider, async (c) => {
      for (const table of ["regions", "cities", "neighborhoods", "portals", "portal_domains", "portal_members", "articles", "advertisers", "ad_campaigns", "sources", "jobs", "partners", "partner_territories", "processed_canonicals", "audit_logs", "source_items", "article_claims", "job_events", "fetch_logs", "ai_costs"]) {
        expect(await count(c, `select 1 from knews.${table}`), table).toBe(0);
      }
    });
  });

  it("nao cria nem altera anunciantes", async () => {
    await asActor(db, outsider, async (c) => {
      expect((await tryQuery(c, "insert into knews.advertisers (name) values ('fraude')")).error).toMatch(/row-level security/);
      expect((await tryQuery(c, "update knews.advertisers set name = 'x' where id = $1", [IDS.advertiser])).rowCount).toBe(0);
    });
  });
});

describe("anunciantes: escopo de rede", () => {
  it("editor regional nao administra anunciantes", async () => {
    await asActor(db, { role: "authenticated", userId: IDS.editorGuaruja }, async (c) => {
      expect(await count(c, "select 1 from knews.advertisers")).toBe(0);
    });
  });

  it("super_admin administra anunciantes", async () => {
    await asActor(db, { role: "authenticated", userId: IDS.superAdmin }, async (c) => {
      expect(await count(c, "select 1 from knews.advertisers where id = $1", [IDS.advertiser])).toBe(1);
      expect((await tryQuery(c, "update knews.advertisers set name = 'Renomeado' where id = $1", [IDS.advertiser])).rowCount).toBe(1);
    });
  });
});
