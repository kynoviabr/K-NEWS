import { describe, expect, it } from "vitest";
import { parseFeed } from "@/services/feed-parser";
import { fetchRssSafe, isPrivateIp } from "@/services/rss-fetch";
import { canonicalDedupKey, slugify, titleFingerprint } from "@/lib/news-intelligence/fingerprint";
import { checkDraft, longestCopiedRun } from "@/lib/news-intelligence/draft-guard";
import { classifyTerritory } from "@/lib/geo";
import { OpenAiCompatibleProvider, createAiProviderFromEnv } from "@/services/ai-provider";

describe("parseFeed", () => {
  it("le RSS 2.0 e remove HTML do resumo", () => {
    const items = parseFeed(`<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>Obra na orla</title><link>https://exemplo.com/a</link><description><![CDATA[<p>Texto <b>forte</b></p>]]></description><pubDate>Fri, 24 Oct 2026 09:00:00 GMT</pubDate></item>
      <item><title>Sem link</title></item>
      <item><title>Link perigoso</title><link>javascript:alert(1)</link></item>
    </channel></rss>`);
    expect(items).toEqual([{ url: "https://exemplo.com/a", title: "Obra na orla", canonical: null, publishedAt: "2026-10-24T09:00:00.000Z", summary: "Texto forte" }]);
  });

  it("le Atom", () => {
    const items = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Evento</title><link rel="alternate" href="https://exemplo.com/e"/><updated>2026-10-24T10:00:00Z</updated><summary>Resumo</summary></entry></feed>`);
    expect(items[0]).toMatchObject({ url: "https://exemplo.com/e", title: "Evento", summary: "Resumo" });
  });

  it("recusa DOCTYPE (XXE / billion laughs)", () => {
    expect(() => parseFeed(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><rss><channel></channel></rss>`)).toThrow(/DOCTYPE/);
  });
});

describe("SSRF", () => {
  it("classifica IPs privados v4 e v6", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "200.160.2.3", "2001:4860:4860::8888"]) expect(isPrivateIp(ip), ip).toBe(false);
  });

  it("bloqueia hostname publico que resolve para rede interna", async () => {
    await expect(fetchRssSafe("https://feed.exemplo.com/rss", { lookup: async () => ["10.0.0.5"] })).rejects.toThrow(/SSRF/);
  });

  it("bloqueia URL com credenciais", async () => {
    await expect(fetchRssSafe("https://user:pass@exemplo.com/rss", { lookup: async () => ["8.8.8.8"] })).rejects.toThrow(/credenciais/);
  });
});

describe("chaves de deduplicacao", () => {
  it("ignora parametros de rastreamento, www, barra final e fragmento", () => {
    expect(canonicalDedupKey("https://www.Exemplo.com/noticia/?utm_source=rss&id=2#topo")).toBe(canonicalDedupKey("https://exemplo.com/noticia?id=2"));
  });

  it("titulos da mesma noticia em veiculos diferentes geram o mesmo fingerprint", () => {
    expect(titleFingerprint("Prefeitura abre unidade de saúde no Perequê - Jornal X")).toBe(titleFingerprint("prefeitura ABRE unidade de saude no pereque"));
  });

  it("slug sem acentos e com sufixo", () => {
    expect(slugify("Guarujá abre unidade de saúde", "ab12cd34")).toBe("guaruja-abre-unidade-de-saude-ab12cd34");
  });
});

describe("guarda do rascunho", () => {
  const source = "A Prefeitura de Guaruja abre unidade no Pereque para atender 4.000 moradores por mes.";

  it("marca como sem respaldo numero ausente da fonte", () => {
    const r = checkDraft("Segundo a prefeitura, a unidade vai atender 9.000 moradores por mês no Perequê.", source);
    expect(r.claims.some((c) => c.status === "unsupported" && /9\.000/.test(c.note ?? ""))).toBe(true);
    expect(r.flags.join(" ")).toMatch(/sem respaldo/);
  });

  it("aceita numero presente na fonte e deixa para revisao humana", () => {
    const r = checkDraft("Segundo a prefeitura, a unidade vai atender 4.000 moradores por mês no Perequê.", source);
    expect(r.claims.every((c) => c.status === "needs_review")).toBe(true);
  });

  it("marca citacao literal que nao esta na fonte", () => {
    const r = checkDraft('O prefeito afirmou: "esta e a maior obra da historia da cidade inteira".', source);
    expect(r.claims.some((c) => c.kind === "quote" && c.status === "unsupported")).toBe(true);
  });

  it("detecta copia longa", () => {
    const long = "um dois tres quatro cinco seis sete oito nove dez onze doze treze quatorze quinze dezesseis";
    expect(longestCopiedRun(`Inicio ${long} fim`, `Outro ${long} texto`)).toBe(16);
    expect(checkDraft(`Inicio ${long} fim.`, long).flags.join(" ")).toMatch(/copia/);
  });
});

describe("classificacao territorial", () => {
  const catalog = {
    cities: [{ id: "c1", name: "Guarujá", slug: "guaruja" }],
    neighborhoods: [{ id: "n1", name: "Perequê", cityId: "c1" }, { id: "n2", name: "Enseada", cityId: "c1" }],
  };
  it("reconhece bairro sem acento e infere a cidade", () => {
    expect(classifyTerritory("Obra no pereque comeca amanha", catalog)).toMatchObject({ cityId: "c1", neighborhoodId: "n1" });
  });
  it("nao casa trecho de palavra", () => {
    expect(classifyTerritory("Enseadas do litoral norte", catalog).cityId).toBeNull();
  });
});

describe("provedor de IA", () => {
  it("sem chave usa o provedor sem IA", async () => {
    const r = await createAiProviderFromEnv({}).draftArticle({ title: "T", evidences: [], claims: ["x"], portalSlug: "g" });
    expect(r.provider).toBe("mock");
  });

  it("DeepSeek/OpenAI: envia JSON mode e calcula custo", async () => {
    let sent: Record<string, unknown> = {};
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: "Titulo", excerpt: "Resumo", body: "Corpo" }) } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new OpenAiCompatibleProvider({ provider: "deepseek", apiKey: "k", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", centsPerMTokIn: 100, centsPerMTokOut: 200 }, fakeFetch);
    const r = await p.draftArticle({ title: "T", evidences: [{ sourceUrl: "https://x", contentSnippet: "fonte" }], claims: [], portalSlug: "guaruja" });
    expect(sent).toMatchObject({ model: "deepseek-chat", response_format: { type: "json_object" } });
    expect(r).toMatchObject({ title: "Titulo", body: "Corpo", provider: "deepseek", costCents: 1 });
  });

  it("resposta invalida do provedor vira erro (job tenta de novo)", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "nao json" } }] }), { status: 200 })) as unknown as typeof fetch;
    const p = new OpenAiCompatibleProvider({ provider: "openai", apiKey: "k", baseUrl: "https://api.openai.com/v1", model: "m", centsPerMTokIn: 0, centsPerMTokOut: 0 }, fakeFetch);
    await expect(p.draftArticle({ title: "T", evidences: [], claims: [], portalSlug: "g" })).rejects.toThrow(/JSON/);
  });
});

describe("flag de feeds locais", async () => {
  const { allowPrivateFeeds } = await import("@/lib/news-intelligence/dev-flags");
  it("so libera com a flag e Supabase local", () => {
    expect(allowPrivateFeeds({ KNEWS_ALLOW_PRIVATE_FEEDS: "1", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toBe(true);
    expect(allowPrivateFeeds({ KNEWS_ALLOW_PRIVATE_FEEDS: "1", NEXT_PUBLIC_SUPABASE_URL: "https://pnhxvhjudtrzvwduuigj.supabase.co" })).toBe(false);
    expect(allowPrivateFeeds({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toBe(false);
  });
});
