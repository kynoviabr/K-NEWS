import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import { asActor, connect, tryQuery } from "./db";
import { IDS, seed } from "./fixtures";
import { serviceClient } from "./supabase";
import { runWorker } from "@/lib/news-intelligence/worker";
import { encryptToken, tokenAad } from "@/lib/social/token-crypto";
import type { SocialConfig } from "@/lib/social/publisher";

// Distribuicao social contra uma Graph API falsa local (nenhuma chamada a Meta real):
// conta com token cifrado, agendamento so de materia publicada, envio no maximo uma vez,
// retry seguro do Instagram, token expirado, limite diario, cancelamento e metricas.

const KEY = randomBytes(32).toString("base64");
const TOKEN = "EAAtokenlocalteste1234567890";
const PAGE = "1111111111";
const IG = "2222222222";
const ART = "00000000-0000-4000-8000-0000000000a1";
const ART_DRAFT = "00000000-0000-4000-8000-0000000000a2";
const ART_SANTOS = "00000000-0000-4000-8000-0000000000a3";

type Call = { method: string; path: string; auth: string | undefined; body: string; url: string };
let calls: Call[] = [];
// Comportamento por rota: devolve [status, corpo] ou "drop" para derrubar a conexao.
let behavior: (c: Call) => [number, unknown] | "drop" | null = () => null;
let server: Server;
let pg: Client;
let service: SupabaseClient;
let cfg: SocialConfig;
let seq = 0;

function defaultGraph(c: Call): [number, unknown] {
  if (c.method === "POST" && c.path === `/${PAGE}/feed`) return [200, { id: `${PAGE}_${++seq}` }];
  if (c.method === "POST" && c.path === `/${IG}/media`) return [200, { id: `container${++seq}` }];
  if (c.method === "POST" && c.path === `/${IG}/media_publish`) return [200, { id: `media${++seq}` }];
  if (c.method === "GET" && c.path.startsWith("/container")) return [200, { status_code: "FINISHED" }];
  if (c.method === "GET" && c.path.endsWith("/insights")) return [200, { data: [{ name: "reach", values: [{ value: 40 }] }, { name: "shares", values: [{ value: 2 }] }] }];
  if (c.method === "GET" && c.path.startsWith("/media")) return [200, { permalink: "https://www.instagram.com/p/teste/", like_count: 7, comments_count: 1 }];
  if (c.method === "GET" && c.url.includes("permalink_url")) return [200, { permalink_url: "https://www.facebook.com/teste/posts/1" }];
  if (c.method === "GET") return [200, { reactions: { summary: { total_count: 5 } }, comments: { summary: { total_count: 3 } }, shares: { count: 1 } }];
  return [404, { error: { message: "rota desconhecida", code: 100 } }];
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const u = new URL(req.url ?? "/", "http://graph.local");
    const c: Call = { method: req.method ?? "GET", path: u.pathname.replace(/^\/v24\.0/, ""), auth: req.headers.authorization, body, url: req.url ?? "" };
    calls.push(c);
    const custom = behavior(c);
    if (custom === "drop") {
      req.socket.destroy();
      return;
    }
    const [status, payload] = custom ?? defaultGraph(c);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
}

async function cleanup(): Promise<void> {
  await pg.query("delete from knews.jobs where job_type in ('social_publish','social_metrics')");
  await pg.query("delete from knews.social_posts where portal_id = any($1)", [[IDS.portalGuaruja, IDS.portalSantos]]);
  await pg.query("delete from knews.portal_social_accounts where portal_id = any($1)", [[IDS.portalGuaruja, IDS.portalSantos]]);
  await pg.query("delete from knews.audit_logs where target_type in ('social_post','social_account')");
  await pg.query("delete from knews.articles where id = any($1)", [[ART, ART_DRAFT, ART_SANTOS]]);
}

async function addAccount(provider: "facebook" | "instagram", externalId: string, portal: string = IDS.portalGuaruja): Promise<string> {
  const r = await pg.query<{ id: string }>(
    `insert into knews.portal_social_accounts (portal_id, provider, external_account_id, display_name, access_token_encrypted)
     values ($1, $2, $3, $4, $5) returning id`,
    [portal, provider, externalId, `Conta ${provider}`, encryptToken(TOKEN, tokenAad(portal, provider), KEY)],
  );
  return r.rows[0]!.id;
}

// Agenda como a editora (passa pela RLS e pela guarda) e confirma.
async function schedule(provider: "facebook" | "instagram", extra: Record<string, unknown> = {}): Promise<string> {
  await pg.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: IDS.editorGuaruja, role: "authenticated" })]);
  try {
    const r = await pg.query<{ id: string }>(
      `insert into knews.social_posts (portal_id, article_id, provider, message, link_url, image_url, image_rights_confirmed)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [IDS.portalGuaruja, ART, provider, "UBS do Perequê amplia atendimento", "https://guaruja.portal24h.news/portal/noticia/ubs", extra.image_url ?? null, extra.image_rights_confirmed ?? false],
    );
    return r.rows[0]!.id;
  } finally {
    await pg.query("select set_config('request.jwt.claims', '', false)");
  }
}

async function post(id: string) {
  return (await pg.query("select * from knews.social_posts where id = $1", [id])).rows[0];
}

async function tick(): Promise<void> {
  for (const fn of ["enqueue_due_social_posts", "enqueue_due_social_metrics"]) {
    const { error } = await service.schema("knews").rpc(fn);
    if (error) throw new Error(`${fn}: ${error.message}`);
  }
  await runWorker({ db: service, workerId: "social-test", social: cfg }, 20);
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  cfg = { enabled: true, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v24.0`, tokenKey: KEY, timeoutMs: 3000 };
  pg = await connect();
  service = serviceClient();
  await seed(pg);
  await cleanup();
  await pg.query("set session_replication_role = replica");
  await pg.query(
    `insert into knews.articles (id, portal_id, slug, title, body, status, published_at) values
      ($1, $4, 'social-ubs', 'UBS do Perequê', 'texto', 'published', now()),
      ($2, $4, 'social-rascunho', 'Rascunho', 'texto', 'draft', null),
      ($3, $5, 'social-santos', 'Santos', 'texto', 'published', now())`,
    [ART, ART_DRAFT, ART_SANTOS, IDS.portalGuaruja, IDS.portalSantos],
  );
  await pg.query("set session_replication_role = origin");
});

beforeEach(async () => {
  calls = [];
  behavior = () => null;
  await pg.query("delete from knews.jobs where job_type in ('social_publish','social_metrics')");
  await pg.query("delete from knews.social_posts where portal_id = any($1)", [[IDS.portalGuaruja, IDS.portalSantos]]);
  await pg.query("delete from knews.portal_social_accounts where portal_id = any($1)", [[IDS.portalGuaruja, IDS.portalSantos]]);
});

afterAll(async () => {
  await cleanup();
  await pg.end();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("contas sociais", () => {
  it("token cifrado nunca e legivel pelo painel; so gestor conecta", async () => {
    await addAccount("facebook", PAGE);
    await asActor(pg, { role: "authenticated", userId: IDS.editorGuaruja }, async (c) => {
      expect((await tryQuery(c, "select access_token_encrypted from knews.portal_social_accounts")).error).toMatch(/permission denied/);
      expect((await c.query("select external_account_id, status from knews.portal_social_accounts")).rows).toEqual([{ external_account_id: PAGE, status: "active" }]);
      const cipher = encryptToken(TOKEN, tokenAad(IDS.portalGuaruja, "instagram"), KEY);
      expect((await tryQuery(c, "select knews.save_social_account($1, 'instagram', $2, 'IG', $3)", [IDS.portalGuaruja, IG, cipher])).error).toMatch(/somente gestor/);
    });
    await asActor(pg, { role: "authenticated", userId: IDS.editorSantos }, async (c) => {
      expect((await c.query("select id from knews.portal_social_accounts")).rows).toEqual([]);
    });
    await asActor(pg, { role: "authenticated", userId: IDS.managerGuaruja }, async (c) => {
      expect((await tryQuery(c, "select knews.save_social_account($1, 'instagram', $2, 'IG', $3)", [IDS.portalGuaruja, IG, TOKEN])).error).toMatch(/token_format/);
      const cipher = encryptToken(TOKEN, tokenAad(IDS.portalGuaruja, "instagram"), KEY);
      expect((await tryQuery(c, "select knews.save_social_account($1, 'instagram', $2, 'IG', $3)", [IDS.portalGuaruja, IG, cipher])).error).toBeNull();
      expect((await tryQuery(c, "select knews.save_social_account($1, 'instagram', $2, 'IG', $3)", [IDS.portalSantos, IG, cipher])).error).toMatch(/somente gestor/);
    });
    await asActor(pg, { role: "anon" }, async (c) => {
      expect((await tryQuery(c, "select knews.begin_social_publish($1, 1)", [ART])).error).toMatch(/permission denied/);
    });
  });
});

describe("agendamento", () => {
  it("so materia publicada do proprio portal, um post por rede e Instagram com imagem", async () => {
    await addAccount("facebook", PAGE);
    await addAccount("instagram", IG);
    await asActor(pg, { role: "authenticated", userId: IDS.editorGuaruja }, async (c) => {
      const ins = (article: string, provider: string, image: string | null = null, rights = false) =>
        tryQuery(c, "insert into knews.social_posts (portal_id, article_id, provider, message, image_url, image_rights_confirmed) values ($1, $2, $3, 'Texto', $4, $5)", [IDS.portalGuaruja, article, provider, image, rights]);
      expect((await ins(ART_DRAFT, "facebook")).error).toMatch(/so materia publicada/);
      expect((await ins(ART_SANTOS, "facebook")).error).toMatch(/nao pertence ao portal/);
      expect((await ins(ART, "instagram")).error).toMatch(/instagram exige imagem/);
      expect((await ins(ART, "instagram", "https://cdn.teste/foto.jpg", false)).error).toMatch(/instagram exige imagem/);
      expect((await ins(ART, "facebook")).error).toBeNull();
      expect((await ins(ART, "facebook")).error).toMatch(/duplicate key/);
      expect((await ins(ART, "instagram", "https://cdn.teste/foto.jpg", true)).error).toBeNull();
      const p = await c.query("select id, status, idempotency_key, created_by from knews.social_posts where provider = 'facebook'");
      expect(p.rows[0]).toMatchObject({ status: "scheduled", idempotency_key: `article:${ART}:facebook`, created_by: IDS.editorGuaruja });
      const id = p.rows[0].id;
      expect((await tryQuery(c, "update knews.social_posts set status = 'published' where id = $1", [id])).error).toMatch(/transicao de post nao permitida/);
      expect((await tryQuery(c, "update knews.social_posts set external_post_id = 'x' where id = $1", [id])).error).toMatch(/permission denied/);
      expect((await tryQuery(c, "update knews.social_posts set status = 'cancelled' where id = $1", [id])).error).toBeNull();
      expect((await tryQuery(c, "update knews.social_posts set message = 'outro' where id = $1", [id])).error).toMatch(/so pode ser editado enquanto agendado/);
    });
    await asActor(pg, { role: "authenticated", userId: IDS.commercialGuaruja }, async (c) => {
      expect((await tryQuery(c, "insert into knews.social_posts (portal_id, article_id, provider, message) values ($1, $2, 'facebook', 'x')", [IDS.portalGuaruja, ART])).error).toMatch(/row-level security/);
    });
  });

  it("despublicar a materia cancela o que estava agendado", async () => {
    await addAccount("facebook", PAGE);
    const id = await schedule("facebook");
    await pg.query("update knews.articles set status = 'unpublished' where id = $1", [ART]);
    expect(await post(id)).toMatchObject({ status: "cancelled", last_error: "materia saiu do ar" });
    await pg.query("set session_replication_role = replica");
    await pg.query("update knews.articles set status = 'published' where id = $1", [ART]);
    await pg.query("set session_replication_role = origin");
  });
});

describe("envio pela fila", () => {
  it("Facebook: envia uma vez com token so no cabecalho e nao repete", async () => {
    await addAccount("facebook", PAGE);
    const id = await schedule("facebook");
    await tick();
    const p = await post(id);
    expect(p).toMatchObject({ status: "published", external_post_id: `${PAGE}_1`, permalink: "https://www.facebook.com/teste/posts/1", attempts: 1 });
    const feed = calls.filter((c) => c.path === `/${PAGE}/feed`);
    expect(feed).toHaveLength(1);
    expect(feed[0]!.auth).toBe(`Bearer ${TOKEN}`);
    expect(calls.every((c) => !c.url.includes(TOKEN) && !c.body.includes(TOKEN))).toBe(true);
    expect(new URLSearchParams(feed[0]!.body).get("link")).toBe("https://guaruja.portal24h.news/portal/noticia/ubs");
    await tick();
    await tick();
    expect(calls.filter((c) => c.path === `/${PAGE}/feed`)).toHaveLength(1);
  });

  it("Instagram: falha transitoria repete reaproveitando o container", async () => {
    await addAccount("instagram", IG);
    const id = await schedule("instagram", { image_url: "https://cdn.teste/foto.jpg", image_rights_confirmed: true });
    let failOnce = true;
    behavior = (c) => {
      if (c.path === `/${IG}/media_publish` && failOnce) {
        failOnce = false;
        return [500, { error: { message: "Service temporarily unavailable", code: 2, is_transient: true } }];
      }
      return null;
    };
    await tick();
    const mid = await post(id);
    expect(mid).toMatchObject({ status: "scheduled", last_error: "Service temporarily unavailable" });
    expect(mid.ig_container_id).toMatch(/^container/);
    const job = await pg.query("select status from knews.jobs where job_type = 'social_publish'");
    expect(job.rows[0].status).toBe("retrying");
    await pg.query("update knews.jobs set scheduled_at = now() where job_type = 'social_publish'");
    await tick();
    expect(await post(id)).toMatchObject({ status: "published", permalink: "https://www.instagram.com/p/teste/" });
    expect(calls.filter((c) => c.path === `/${IG}/media`)).toHaveLength(1);
    expect(calls.filter((c) => c.path === `/${IG}/media_publish`)).toHaveLength(2);
    expect(new URLSearchParams(calls.find((c) => c.path === `/${IG}/media`)!.body).get("caption")).toContain("https://guaruja.portal24h.news/portal/noticia/ubs");
  });

  it("sem resposta da Meta ou job interrompido: nao reenvia, pede conferencia", async () => {
    await addAccount("facebook", PAGE);
    const id = await schedule("facebook");
    behavior = (c) => (c.path === `/${PAGE}/feed` ? "drop" : null);
    await tick();
    expect(await post(id)).toMatchObject({ status: "needs_check" });
    expect((await pg.query("select status from knews.jobs where job_type = 'social_publish'")).rows[0].status).toBe("dead_letter");
    await tick();
    expect(calls.filter((c) => c.path === `/${PAGE}/feed`)).toHaveLength(1);

    // Queda do worker entre a chamada e a gravacao: o post fica "publishing".
    await pg.query("update knews.social_posts set status = 'publishing' where id = $1", [id]);
    const r = await service.schema("knews").rpc("begin_social_publish", { p_post_id: id, p_revision: (await post(id)).revision });
    expect(r.data).toEqual({ skip: "resultado incerto" });
    expect((await post(id)).status).toBe("needs_check");

    // A editora confere e reagenda: nova revisao, novo job.
    await asActor(pg, { role: "authenticated", userId: IDS.editorGuaruja }, async (c) => {
      const before = (await c.query("select revision from knews.social_posts where id = $1", [id])).rows[0].revision;
      await c.query("update knews.social_posts set status = 'scheduled', scheduled_at = now() where id = $1", [id]);
      const after = await c.query("select status, revision, last_error from knews.social_posts where id = $1", [id]);
      expect(after.rows[0]).toEqual({ status: "scheduled", revision: before + 1, last_error: null });
    });
  });

  it("token expirado marca a conta e para", async () => {
    const account = await addAccount("facebook", PAGE);
    const id = await schedule("facebook");
    behavior = () => [400, { error: { message: "Error validating access token: Session has expired", type: "OAuthException", code: 190 } }];
    await tick();
    expect(await post(id)).toMatchObject({ status: "failed" });
    expect((await pg.query("select status from knews.portal_social_accounts where id = $1", [account])).rows[0].status).toBe("expired");
  });

  it("limite diario da conta adia o envio", async () => {
    const account = await addAccount("facebook", PAGE);
    await pg.query("update knews.portal_social_accounts set daily_post_limit = 1 where id = $1", [account]);
    const id = await schedule("facebook");
    // Post ja enviado hoje pela mesma conta (gravado direto, sem a guarda).
    await pg.query("set session_replication_role = replica");
    await pg.query(
      `insert into knews.social_posts (portal_id, article_id, provider, message, status, account_id, idempotency_key, published_at)
       values ($1, $2, 'facebook', 'anterior', 'published', $3, 'anterior', now() - interval '2 hours')`,
      [IDS.portalGuaruja, ART_DRAFT, account],
    );
    await pg.query("set session_replication_role = origin");
    await tick();
    const p = await post(id);
    expect(p.status).toBe("scheduled");
    expect(p.last_error).toMatch(/limite diario/);
    expect(new Date(p.scheduled_at).getTime()).toBeGreaterThan(Date.now() + 50 * 60 * 1000);
    expect(calls.filter((c) => c.path === `/${PAGE}/feed`)).toHaveLength(0);
  });

  it("metricas sao coletadas e resumidas por rede", async () => {
    await addAccount("facebook", PAGE);
    await addAccount("instagram", IG);
    const fb = await schedule("facebook");
    const ig = await schedule("instagram", { image_url: "https://cdn.teste/foto.jpg", image_rights_confirmed: true });
    await tick();
    await tick();
    expect((await post(fb)).metrics).toEqual({ reactions: 5, comments: 3, shares: 1 });
    expect((await post(ig)).metrics).toEqual({ reactions: 7, comments: 1, shares: 2, reach: 40 });
    await asActor(pg, { role: "authenticated", userId: IDS.editorGuaruja }, async (c) => {
      const s = (await c.query("select knews.social_summary($1) as s", [IDS.portalGuaruja])).rows[0].s;
      expect(s).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ provider: "facebook", published: 1, reactions: 5, comments: 3, shares: 1 }),
          expect.objectContaining({ provider: "instagram", published: 1, reactions: 7, reach: 40 }),
        ]),
      );
    });
    await asActor(pg, { role: "authenticated", userId: IDS.editorSantos }, async (c) => {
      expect((await c.query("select knews.social_summary($1) as s", [IDS.portalGuaruja])).rows[0].s).toBeNull();
    });
  });

  it("com o envio desativado no ambiente nada sai", async () => {
    await addAccount("facebook", PAGE);
    const id = await schedule("facebook");
    await service.schema("knews").rpc("enqueue_due_social_posts");
    await runWorker({ db: service, workerId: "social-test", social: { ...cfg, enabled: false } }, 20);
    expect(calls).toHaveLength(0);
    expect((await post(id)).status).toBe("scheduled");
  });
});
