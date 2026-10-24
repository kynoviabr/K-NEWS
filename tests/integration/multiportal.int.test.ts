import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { asActor, connect, tryQuery } from "./db";
import { IDS, seed } from "./fixtures";

// Portal multirregional: cadastro territorial, tema, dominios, taxonomia da materia
// e leitura publica filtrada, sempre isolada por portal.
let admin: Client;
let anon: Client;
const NB_GRJ = "00000000-0000-4000-8000-000000000081";
const NB_STS = "00000000-0000-4000-8000-000000000082";
const ART = ["00000000-0000-4000-8000-000000000091", "00000000-0000-4000-8000-000000000092", "00000000-0000-4000-8000-000000000093"];

async function cleanup(): Promise<void> {
  await admin.query("delete from knews.articles where id = any($1)", [ART]);
  await admin.query("delete from knews.categories where portal_id = any($1)", [[IDS.portalGuaruja, IDS.portalSantos]]);
  await admin.query("delete from knews.neighborhoods where id = any($1) or slug = 'vila-teste'", [[NB_GRJ, NB_STS]]);
  await admin.query("delete from knews.portals where slug = 'bertioga-teste'");
  await admin.query("delete from knews.portal_domains where domain like '%.teste.localhost'");
  await admin.query("update knews.portals set theme = '{}', status = 'active' where id = any($1)", [[IDS.portalGuaruja, IDS.portalSantos]]);
}

beforeAll(async () => {
  admin = await connect();
  await seed(admin);
  await cleanup();
  await admin.query(
    `insert into knews.neighborhoods (id, city_id, name, slug) values ($1, $2, 'Perequê', 'pereque'), ($3, $4, 'Gonzaga', 'gonzaga')`,
    [NB_GRJ, IDS.cityGuaruja, NB_STS, IDS.citySantos],
  );
  await admin.query(
    `insert into knews.categories (portal_id, name, slug) values ($1, 'Saúde', 'saude'), ($1, 'Esportes', 'esportes'), ($2, 'Saúde', 'saude')`,
    [IDS.portalGuaruja, IDS.portalSantos],
  );
  // Materias publicadas direto no banco (a guarda de publicacao exige revisao humana,
  // coberta em news-intelligence-e2e); aqui interessa so a leitura publica.
  await admin.query("set session_replication_role = replica");
  await admin.query(
    `insert into knews.articles (id, portal_id, slug, title, excerpt, body, status, category, neighborhood_id, published_at) values
      ($1, $4, 'ubs-pereque', 'UBS do Perequê amplia atendimento', 'Unidade de saúde', 'Texto sobre a unidade de saúde do Perequê.', 'published', 'saude', $6, now() - interval '1 hour'),
      ($2, $4, 'jogo-praia', 'Torneio de vôlei na praia', 'Esporte', 'Competição na orla.', 'published', 'esportes', null, now() - interval '2 hours'),
      ($3, $5, 'santos-pereque', 'Moradores de Santos visitam o Perequê', 'Turismo', 'Texto de Santos citando o Perequê.', 'published', 'saude', $7, now())`,
    [...ART, IDS.portalGuaruja, IDS.portalSantos, NB_GRJ, NB_STS],
  );
  await admin.query("set session_replication_role = origin");
  anon = await connect();
  await anon.query("set role anon");
});

afterAll(async () => {
  await cleanup();
  await Promise.all([admin.end(), anon.end()]);
});

type SearchResult = { total: number; items: Array<{ slug: string; neighborhood: string | null }> };

async function search(portal: string, q: string | null, category: string | null = null, neighborhood: string | null = null): Promise<SearchResult> {
  const r = await anon.query<{ r: SearchResult }>("select knews_public.search_articles($1, $2, $3, $4) as r", [portal, q, category, neighborhood]);
  return r.rows[0]!.r;
}

describe("leitura publica por portal", () => {
  it("busca sem acento encontra so materias do proprio portal", async () => {
    const r = await search(IDS.portalGuaruja, "pereque");
    expect(r.items.map((i) => i.slug)).toEqual(["ubs-pereque"]);
    expect((await search(IDS.portalSantos, "Perequê")).items.map((i) => i.slug)).toEqual(["santos-pereque"]);
    expect((await search(IDS.portalGuaruja, "saude unidade")).total).toBe(1);
  });

  it("filtra por editoria e bairro e pagina", async () => {
    expect((await search(IDS.portalGuaruja, null)).total).toBe(2);
    expect((await search(IDS.portalGuaruja, null, "esportes")).items.map((i) => i.slug)).toEqual(["jogo-praia"]);
    expect((await search(IDS.portalGuaruja, null, null, "pereque")).items).toEqual([expect.objectContaining({ slug: "ubs-pereque", neighborhood: "pereque" })]);
    // Bairro de Santos nao vaza para Guaruja.
    expect((await search(IDS.portalGuaruja, null, null, "gonzaga")).total).toBe(0);
  });

  it("secoes trazem contagem so do portal", async () => {
    const r = await anon.query("select knews_public.portal_sections($1) as s", [IDS.portalGuaruja]);
    const s = r.rows[0].s as { categories: Array<{ slug: string; count: number }>; neighborhoods: Array<{ slug: string; count: number }> };
    expect(s.categories).toEqual(expect.arrayContaining([expect.objectContaining({ slug: "saude", count: 1 }), expect.objectContaining({ slug: "esportes", count: 1 })]));
    expect(s.neighborhoods.map((n) => n.slug)).toContain("pereque");
    expect(s.neighborhoods.map((n) => n.slug)).not.toContain("gonzaga");
  });

  it("portal inativo some do publico", async () => {
    await admin.query("insert into knews.portal_domains (portal_id, domain, is_primary) values ($1, 'grj.teste.localhost', true)", [IDS.portalGuaruja]);
    const before = await anon.query("select knews_public.portal_by_host('grj.teste.localhost') as p");
    expect(before.rows[0].p).toMatchObject({ slug: "guaruja-teste", city_slug: "guaruja", primary_domain: "grj.teste.localhost" });
    await admin.query("update knews.portals set status = 'inactive' where id = $1", [IDS.portalGuaruja]);
    expect((await anon.query("select knews_public.portal_by_host('grj.teste.localhost') as p")).rows[0].p).toBeNull();
    expect((await anon.query("select knews_public.portal_sections($1) as s", [IDS.portalGuaruja])).rows[0].s).toBeNull();
    expect((await search(IDS.portalGuaruja, null)).total).toBe(0);
    await admin.query("update knews.portals set status = 'active' where id = $1", [IDS.portalGuaruja]);
  });
});

describe("taxonomia da materia", () => {
  it("editoria e bairro precisam ser do portal", async () => {
    await admin.query("begin");
    expect((await tryQuery(admin, "update knews.articles set category = 'politica' where id = $1", [ART[0]])).error).toMatch(/editoria politica/);
    expect((await tryQuery(admin, "update knews.articles set neighborhood_id = $2 where id = $1", [ART[0], NB_STS])).error).toMatch(/bairro nao pertence/);
    expect((await tryQuery(admin, "update knews.articles set category = 'esportes' where id = $1", [ART[0]])).error).toBeNull();
    await admin.query("rollback");
  });
});

describe("cadastro multirregional", () => {
  it("so super_admin cria portal; nasce inativo, com vinculo e editorias", async () => {
    await asActor(admin, { role: "authenticated", userId: IDS.managerGuaruja }, async (c) => {
      expect((await tryQuery(c, "select knews.create_portal($1, 'Bertioga', 'bertioga-teste', 'bertioga.teste.localhost')", [IDS.cityGuaruja])).error).toMatch(/somente super_admin/);
    });
    await asActor(admin, { role: "authenticated", userId: IDS.superAdmin }, async (c) => {
      const r = await c.query<{ id: string }>("select knews.create_portal($1, 'Bertioga', 'bertioga-teste', 'bertioga.teste.localhost') as id", [IDS.cityGuaruja]);
      const id = r.rows[0]!.id;
      const p = await c.query("select status from knews.portals where id = $1", [id]);
      expect(p.rows[0].status).toBe("inactive");
      const cats = await c.query("select count(*)::int n from knews.categories where portal_id = $1", [id]);
      expect(cats.rows[0].n).toBe(8);
      const m = await c.query("select role from knews.portal_members where portal_id = $1 and user_id = $2", [id, IDS.superAdmin]);
      expect(m.rows[0].role).toBe("super_admin");
      expect((await tryQuery(c, "insert into knews.portal_domains (portal_id, domain, is_primary) values ($1, 'outro.teste.localhost', true)", [id])).error).toMatch(/uq_knews_portal_domains_primary/);
      expect((await tryQuery(c, "insert into knews.portal_domains (portal_id, domain) values ($1, 'Invalido_Dominio')", [id])).error).toMatch(/knews_portal_domains_format/);
    });
  });

  it("gerente edita tema e SEO do proprio portal, sem status, slug ou outro portal", async () => {
    await asActor(admin, { role: "authenticated", userId: IDS.managerGuaruja }, async (c) => {
      const ok = await tryQuery(c, `update knews.portals set theme = '{"primary": "#0e7490", "tagline": "Guarujá"}' where id = $1`, [IDS.portalGuaruja]);
      expect(ok).toEqual({ error: null, rowCount: 1 });
      expect((await tryQuery(c, `update knews.portals set theme = '{"primary": "red"}' where id = $1`, [IDS.portalGuaruja])).error).toMatch(/theme_valid/);
      expect((await tryQuery(c, `update knews.portals set theme = '{"css": "body{}"}' where id = $1`, [IDS.portalGuaruja])).error).toMatch(/theme_valid/);
      expect((await tryQuery(c, "update knews.portals set status = 'inactive' where id = $1", [IDS.portalGuaruja])).error).toMatch(/somente super_admin/);
      expect((await tryQuery(c, "update knews.portals set slug = 'outro' where id = $1", [IDS.portalGuaruja])).error).toMatch(/permission denied/);
      expect((await tryQuery(c, "update knews.portals set name = 'X' where id = $1", [IDS.portalSantos])).rowCount).toBe(0);
      expect((await tryQuery(c, "insert into knews.portal_domains (portal_id, domain) values ($1, 'x.teste.localhost')", [IDS.portalGuaruja])).error).toMatch(/row-level security/);
      expect((await tryQuery(c, "insert into knews.neighborhoods (city_id, name, slug) values ($1, 'Vila Teste', 'vila-teste')", [IDS.cityGuaruja])).error).toBeNull();
      expect((await tryQuery(c, "insert into knews.neighborhoods (city_id, name, slug) values ($1, 'Vila Teste', 'vila-teste')", [IDS.citySantos])).error).toMatch(/row-level security/);
    });
    await asActor(admin, { role: "authenticated", userId: IDS.editorGuaruja }, async (c) => {
      expect((await tryQuery(c, `update knews.portals set theme = '{}' where id = $1`, [IDS.portalGuaruja])).rowCount).toBe(0);
    });
  });
});
