import { describe, it, expect } from "vitest";
import { runNewsIntelligencePipeline, persistentDedupKeys } from "@/lib/news-pipeline";
import type { FetchResult } from "@/services/rss";

const raw = (overrides: Partial<FetchResult> = {}): FetchResult => ({
  url: "https://example.com/a",
  title: "Titulo valido com tamanho suficiente",
  canonical: "https://example.com/a",
  publishedAt: null,
  summary: "Resumo suficiente para avaliacao.",
  ...overrides,
});

describe("news intelligence pipeline", () => {
  it("bloqueia quando evidencias sao so URLs sem conteudo", () => {
    const items: FetchResult[] = [raw({ url: "https://a.com/1" })];
    const results = runNewsIntelligencePipeline({
      portalId: "portal-1",
      rawItems: items,
      evidencesByUrl: new Map([["https://a.com/1", [{ sourceUrl: "https://a.com/1" }]]]),
      bodyByUrl: new Map([["https://a.com/1", "Corpo com tamanho suficiente e alegacao de fraude na camara envolvendo vereador"]]),
      titleByUrl: new Map([["https://a.com/1", "Titulo com alegacao sensivel sobre fraude"]]),
    });
    expect(results[0]?.blocked).toBe(true);
    expect(results[0]?.assessment.level).toBe("blocked");
  });

  it("requer 2 fontes independentes para autopublicar", () => {
    const items: FetchResult[] = [raw({ url: "https://a.com/1" })];
    const oneHost = runNewsIntelligencePipeline({
      portalId: "portal-1",
      rawItems: items,
      evidencesByUrl: new Map([
        ["https://a.com/1", [
          { sourceUrl: "https://guaruja.sp.gov.br/a", sourceType: "official", isPrimary: true, contentSnippet: "Prefeitura inaugurou unidade" },
          { sourceUrl: "https://guaruja.sp.gov.br/b", sourceType: "official", contentSnippet: "Prefeitura inaugurou unidade" },
        ]],
      ]),
      bodyByUrl: new Map([["https://a.com/1", "Prefeitura inaugurou unidade com atendimento ampliado. ".repeat(10)]]),
      titleByUrl: new Map([["https://a.com/1", "Guaruja inaugura unidade"]]),
    });
    expect(oneHost[0]?.assessment.isAutoPublishable).toBe(false);
  });

  it("bloqueia por sensitive category mesmo com evidencias", () => {
    const items: FetchResult[] = [raw({ url: "https://a.com/1", title: "Tragedia em desenvolvimento em Guaruja" })];
    const results = runNewsIntelligencePipeline({
      portalId: "portal-1",
      rawItems: items,
      evidencesByUrl: new Map([["https://a.com/1", [{ sourceUrl: "https://a.com/ev", sourceType: "official" }]]]),
      bodyByUrl: new Map([["https://a.com/1", "Desastre em desenvolvimento com vitimas"]]),
      titleByUrl: new Map([["https://a.com/1", "Tragedia em desenvolvimento em Guaruja"]]),
    });
    expect(results[0]?.assessment.level).toBe("blocked");
  });

  it("persistent dedup bloqueia reprocessamento", () => {
    const items = [
      { url: "https://a.com/1", title: "T", canonical: "https://a.com/c", publishedAt: null, summary: null, dedupKey: "https://a.com/c", normalizedCanonical: "https://a.com/c" } as any,
      { url: "https://a.com/2", title: "T", canonical: "https://a.com/d", publishedAt: null, summary: null, dedupKey: "https://a.com/d", normalizedCanonical: "https://a.com/d" } as any,
    ];
    const existing = new Set<string>(["https://a.com/c"]);
    const { newItems, duplicates } = persistentDedupKeys(items, existing);
    expect(newItems).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
  });
});
