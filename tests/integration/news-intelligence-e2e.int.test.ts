import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import { connect } from "./db";
import { anonClient, serviceClient, signedInClient } from "./supabase";
import { runWorker } from "@/lib/news-intelligence/worker";
import type { AiProviderClient } from "@/services/ai-provider";

// Fluxo completo no Supabase local: fonte RSS cadastrada pelo editor -> coleta real por
// HTTP -> deduplicacao persistente -> rascunho -> evidencias/claims -> revisao humana
// -> publicacao -> leitura publica no portal Guaruja -> despublicacao.

const RUN = Date.now().toString(36);
const GUARUJA_SLUG = `guaruja-${RUN}`;
const SANTOS_SLUG = `santos-${RUN}`;

function rss(items: Array<{ title: string; link: string; description: string }>): string {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Fonte teste</title>${items
    .map((i) => `<item><title>${i.title}</title><link>${i.link}</link><description><![CDATA[${i.description}]]></description><pubDate>Fri, 24 Oct 2026 09:00:00 GMT</pubDate></item>`)
    .join("")}</channel></rss>`;
}

let feedXml = "";
let server: Server;
let feedUrl = "";
let pg: Client;
let service: SupabaseClient;
let editor: { client: SupabaseClient; userId: string };
let santosEditor: { client: SupabaseClient; userId: string };
let portalId = "";
let santosPortalId = "";
let sourceId = "";

// Provedor de IA deterministico para o teste (sem rede). O texto usa apenas fatos da fonte.
const fakeAi: AiProviderClient = {
  async draftArticle(input) {
    const src = input.evidences[0]?.contentSnippet ?? "";
    const isHealth = /saude/i.test(src);
    return {
      title: isHealth ? "Guarujá abre nova unidade de saúde no Perequê" : input.title,
      excerpt: "Prefeitura informa ampliação do atendimento básico.",
      body: isHealth
        ? "A Prefeitura de Guarujá informou a abertura de uma unidade de saúde no bairro Perequê. Segundo o comunicado, o equipamento vai atender 4.000 moradores por mês na atenção básica, com consultas e vacinação. O atendimento começa nesta segunda-feira."
        : src,
      tokensIn: 10,
      tokensOut: 20,
      costCents: 0,
      provider: "mock",
      model: "teste-deterministico",
    };
  },
};

const fetchOptions = { allowPrivateNetwork: true, timeoutMs: 5000 };
const workerDeps = () => ({ db: service, workerId: `e2e-${RUN}`, ai: fakeAi, fetchOptions });

async function drainQueue(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const r = await runWorker(workerDeps(), 20);
    if (r.claimed === 0) return;
  }
}

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
    res.end(feedXml);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  feedUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/feed.xml`;

  pg = await connect();
  service = serviceClient();
  editor = await signedInClient(`editor-guaruja-${RUN}@knews.test`);
  santosEditor = await signedInClient(`editor-santos-${RUN}@knews.test`);

  const region = await pg.query<{ id: string }>("insert into knews.regions (name, slug) values ('Baixada', $1) returning id", [`baixada-${RUN}`]);
  const cities = await pg.query<{ id: string; slug: string }>(
    "insert into knews.cities (region_id, name, slug) values ($1, 'Guarujá', 'guaruja'), ($1, 'Santos', 'santos') returning id, slug",
    [region.rows[0]!.id],
  );
  const gCity = cities.rows.find((c) => c.slug === "guaruja")!.id;
  const sCity = cities.rows.find((c) => c.slug === "santos")!.id;
  await pg.query("insert into knews.neighborhoods (city_id, name, slug) values ($1, 'Perequê', 'pereque'), ($1, 'Enseada', 'enseada')", [gCity]);
  const portals = await pg.query<{ id: string; slug: string }>(
    "insert into knews.portals (city_id, name, slug) values ($1, 'Portal 24h Guarujá', $3), ($2, 'Portal 24h Santos', $4) returning id, slug",
    [gCity, sCity, GUARUJA_SLUG, SANTOS_SLUG],
  );
  portalId = portals.rows.find((p) => p.slug === GUARUJA_SLUG)!.id;
  santosPortalId = portals.rows.find((p) => p.slug === SANTOS_SLUG)!.id;
  await pg.query("insert into knews.portal_domains (portal_id, domain, is_primary) values ($1, $2, true)", [portalId, `${GUARUJA_SLUG}.localhost`]);
  await pg.query("insert into knews.portal_members (portal_id, user_id, role) values ($1, $2, 'regional_editor'), ($3, $4, 'regional_editor')", [
    portalId,
    editor.userId,
    santosPortalId,
    santosEditor.userId,
  ]);
});

afterAll(async () => {
  server?.close();
  if (pg) {
    await pg.query("delete from knews.portals where slug in ($1, $2)", [GUARUJA_SLUG, SANTOS_SLUG]);
    await pg.query("delete from knews.jobs where portal_id is null and payload->>'run' = $1", [RUN]);
    await pg.end();
  }
});

describe("News Intelligence ponta a ponta (Guarujá)", () => {
  it("editor cadastra a fonte RSS do proprio portal; o de Santos nao consegue", async () => {
    const { data, error } = await editor.client
      .schema("knews")
      .from("sources")
      .insert({ portal_id: portalId, name: "Prefeitura (teste)", url: feedUrl, kind: "rss", created_by: editor.userId })
      .select("id")
      .single();
    expect(error).toBeNull();
    sourceId = data!.id;

    const intrusion = await santosEditor.client.schema("knews").from("sources").insert({ portal_id: portalId, url: `${feedUrl}?x=1`, kind: "rss" });
    expect(intrusion.error?.message).toMatch(/row-level security/);
  });

  it("coleta, deduplica e gera rascunhos em revisao (nunca publica sozinho)", async () => {
    feedXml = rss([
      { title: "Prefeitura abre unidade de saude no Pereque", link: "https://www.guaruja.sp.gov.br/noticias/ubs-pereque?utm_source=rss", description: "A Prefeitura de Guaruja abre unidade de saude no bairro Pereque para atender 4.000 moradores por mes na atencao basica, com consultas e vacinacao, a partir desta segunda-feira." },
      { title: "Prefeitura abre unidade de saude no Pereque - Jornal X", link: "https://jornalx.example/ubs-pereque", description: "Republicacao da mesma noticia sobre a unidade de saude do Pereque em Guaruja." },
      { title: "Santos recebe festival na orla", link: "https://santos.example/festival", description: "Evento acontece no Gonzaga, em Santos, neste fim de semana." },
      { title: "Homem preso apos assalto na Enseada identificado como Joao Silva", link: "https://policia.example/enseada", description: "Policia informa prisao na Enseada, em Guaruja, de Joao Silva, acusado de assalto." },
    ]);

    const jobId = await service.schema("knews").rpc("enqueue_job", {
      p_portal_id: portalId,
      p_job_type: "rss_fetch",
      p_payload: { source_id: sourceId },
      p_idempotency_key: `e2e-fetch-1-${RUN}`,
    });
    expect(jobId.error).toBeNull();
    await drainQueue();

    const items = await pg.query<{ title: string; status: string; discard_reason: string | null }>(
      "select title, status, discard_reason from knews.source_items where source_id = $1 order by title",
      [sourceId],
    );
    const byTitle = Object.fromEntries(items.rows.map((r) => [r.title, r]));
    expect(byTitle["Prefeitura abre unidade de saude no Pereque"]?.status).toBe("drafted");
    expect(byTitle["Prefeitura abre unidade de saude no Pereque - Jornal X"]?.status).toBe("duplicate");
    expect(byTitle["Santos recebe festival na orla"]).toMatchObject({ status: "discarded", discard_reason: "Fora do territorio do portal" });
    expect(byTitle["Homem preso apos assalto na Enseada identificado como Joao Silva"]?.status).toBe("drafted");

    const articles = await pg.query<{ title: string; status: string; risk_level: string; neighborhood: string | null; evidences: string; claims: string }>(
      `select a.title, a.status, a.risk_level, n.name as neighborhood,
              (select count(*)::text from knews.article_evidences e where e.article_id = a.id) evidences,
              (select count(*)::text from knews.article_claims c where c.article_id = a.id) claims
       from knews.articles a left join knews.neighborhoods n on n.id = a.neighborhood_id
       where a.portal_id = $1 order by a.title`,
      [portalId],
    );
    expect(articles.rows).toHaveLength(2);
    const health = articles.rows.find((a) => a.title.startsWith("Guarujá abre"))!;
    expect(health).toMatchObject({ status: "reviewing", risk_level: "high", neighborhood: "Perequê", evidences: "1" });
    expect(Number(health.claims)).toBeGreaterThan(0);
    const crime = articles.rows.find((a) => a.title.startsWith("Homem preso"))!;
    expect(crime).toMatchObject({ status: "blocked", risk_level: "blocked" });
  });

  it("nova coleta da mesma fonte nao duplica nada (dedup persistente)", async () => {
    await service.schema("knews").rpc("enqueue_job", {
      p_portal_id: portalId,
      p_job_type: "rss_fetch",
      p_payload: { source_id: sourceId },
      p_idempotency_key: `e2e-fetch-2-${RUN}`,
    });
    const report = await runWorker(workerDeps(), 5);
    const fetch = report.results.find((r) => r.jobType === "rss_fetch");
    expect(fetch?.detail).toMatchObject({ inserted: 0, duplicates: 4 });
    const count = await pg.query<{ n: string }>("select count(*)::text n from knews.articles where portal_id = $1", [portalId]);
    expect(count.rows[0]?.n).toBe("2");
  });

  it("portal publico nao mostra rascunhos", async () => {
    const { data } = await anonClient().schema("knews_public").rpc("published_articles", { p_portal_id: portalId });
    expect(data).toEqual([]);
  });

  it("guardas deterministicas: bloqueado nao publica; service_role nao publica; Santos nao revisa", async () => {
    const ids = await pg.query<{ id: string; status: string }>("select id, status from knews.articles where portal_id = $1", [portalId]);
    const blocked = ids.rows.find((r) => r.status === "blocked")!;
    const health = ids.rows.find((r) => r.status === "reviewing")!;

    const r1 = await editor.client.schema("knews").rpc("review_article", { p_article_id: blocked.id, p_decision: "approve", p_note: "Tentativa de aprovar bloqueado" });
    expect(r1.error?.message).toMatch(/risco bloqueado/);

    const r2 = await editor.client.schema("knews").from("articles").update({ risk_level: "low" }).eq("id", blocked.id);
    expect(r2.error?.message).toMatch(/gestor regional/);

    const r3 = await service.schema("knews").from("articles").update({ status: "published" }).eq("id", health.id);
    expect(r3.error?.message).toMatch(/revisao humana/);

    // Rascunho sem IA (copia marcada da fonte) nunca publica sem reescrita.
    const original = (await pg.query<{ body: string }>("select body from knews.articles where id = $1", [health.id])).rows[0]!.body;
    await pg.query("update knews.articles set body = $2 where id = $1", [health.id, `[Rascunho sem IA — reescrever antes de publicar] ${original}`]);
    const r5 = await editor.client.schema("knews").rpc("review_article", { p_article_id: health.id, p_decision: "approve", p_note: "Tentativa sem reescrever" });
    expect(r5.error?.message).toMatch(/reescrito/);
    await pg.query("update knews.articles set body = $2 where id = $1", [health.id, original]);

    const r4 = await santosEditor.client.schema("knews").rpc("review_article", { p_article_id: health.id, p_decision: "approve", p_note: "Invasao de outro portal" });
    expect(r4.error?.message).toMatch(/nao encontrado/);
  });

  it("editor aprova e a noticia aparece no portal Guarujá com evidencias", async () => {
    const health = (await pg.query<{ id: string; slug: string }>("select id, slug from knews.articles where portal_id = $1 and status = 'reviewing'", [portalId])).rows[0]!;

    await pg.query("update knews.portals set publishing_enabled = false where id = $1", [portalId]);
    const killed = await editor.client.schema("knews").rpc("review_article", { p_article_id: health.id, p_decision: "approve", p_note: "Conferido com o comunicado oficial" });
    expect(killed.error?.message).toMatch(/kill switch/);
    await pg.query("update knews.portals set publishing_enabled = true where id = $1", [portalId]);

    const ok = await editor.client.schema("knews").rpc("review_article", { p_article_id: health.id, p_decision: "approve", p_note: "Conferido com o comunicado oficial" });
    expect(ok.error).toBeNull();
    expect(ok.data).toMatchObject({ status: "published", reviewed_by: editor.userId });

    const pub = anonClient().schema("knews_public");
    const portal = await pub.rpc("portal_by_host", { p_host: `${GUARUJA_SLUG}.localhost:3000` });
    expect(portal.data).toMatchObject({ id: portalId, city: "Guarujá" });
    const list = await pub.rpc("published_articles", { p_portal_id: portalId });
    expect(list.data).toHaveLength(1);
    const article = await pub.rpc("published_article", { p_portal_id: portalId, p_slug: health.slug });
    expect(article.data).toMatchObject({ title: "Guarujá abre nova unidade de saúde no Perequê" });
    expect(article.data.evidences[0]).toMatchObject({ url: "https://www.guaruja.sp.gov.br/noticias/ubs-pereque?utm_source=rss", type: "rss" });

    // Isolamento: o mesmo slug nao existe no portal de Santos
    const other = await pub.rpc("published_article", { p_portal_id: santosPortalId, p_slug: health.slug });
    expect(other.data).toBeNull();

    const trail = await pg.query<{ action: string }>("select action from knews.audit_logs where target_id = $1", [health.id]);
    expect(trail.rows.map((r) => r.action)).toContain("article.approve");
  });

  it("despublicacao retira do portal e registra correcao", async () => {
    const health = (await pg.query<{ id: string; slug: string }>("select id, slug from knews.articles where portal_id = $1 and status = 'published'", [portalId])).rows[0]!;
    const r = await editor.client.schema("knews").rpc("unpublish_article", { p_article_id: health.id, p_reason: "Dados do comunicado foram corrigidos" });
    expect(r.error).toBeNull();
    const list = await anonClient().schema("knews_public").rpc("published_articles", { p_portal_id: portalId });
    expect(list.data).toEqual([]);
    const corr = await pg.query<{ note: string }>("select note from knews.article_corrections where article_id = $1", [health.id]);
    expect(corr.rows[0]?.note).toMatch(/Retirado do ar/);
  });

  it("anon continua sem acesso direto ao schema knews", async () => {
    const r = await anonClient().schema("knews").from("articles").select("id").limit(1);
    expect(r.error).not.toBeNull();
  });
});
