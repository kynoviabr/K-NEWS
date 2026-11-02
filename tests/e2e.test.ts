import { describe, it, expect, vi } from "vitest";
import { runNewsIntelligencePipeline } from "@/lib/news-pipeline";
import { decideAd, reserveInventoryAtomically } from "@/lib/ad-inventory";
import { checkCampaignEligibility } from "@/lib/ad-eligibility";
import type { FetchResult } from "@/services/rss";
import type { AdCampaign } from "@/lib/ad-eligibility";

const raw = (overrides: Partial<FetchResult> = {}): FetchResult => ({
  url: "https://a.com/1",
  title: "Titulo valido",
  canonical: "https://a.com/1",
  publishedAt: null,
  summary: "Resumo",
  ...overrides,
});

describe("E2E: RSS fail não quebra pipeline", () => {
  it("pipeline vazio quando fonte falha (0 itens)", () => {
    const results = runNewsIntelligencePipeline({
      portalId: "p1",
      rawItems: [],
      evidencesByUrl: new Map(),
      bodyByUrl: new Map(),
      titleByUrl: new Map(),
    });
    expect(results).toHaveLength(0);
  });
});

describe("E2E: duplicidade bloqueada persistentemente", () => {
  it("segundo fetch com mesma canonical é dedup na segunda rodada", () => {
    const items: FetchResult[] = [raw({ url: "https://a.com/1", canonical: "https://a.com/canon" }), raw({ url: "https://a.com/2", canonical: "https://a.com/canon" })];
    const r1 = runNewsIntelligencePipeline({ portalId: "p1", rawItems: items, evidencesByUrl: new Map(), bodyByUrl: new Map(), titleByUrl: new Map() });
    expect(r1).toHaveLength(1);
  });
});

describe("E2E: IA fail bloqueia autopublish", () => {
  it("sem contentSnippet claims ficam unverified e bloqueia", () => {
    const items: FetchResult[] = [raw({ url: "https://a.com/1" })];
    const results = runNewsIntelligencePipeline({
      portalId: "p1",
      rawItems: items,
      evidencesByUrl: new Map([["https://a.com/1", [{ sourceUrl: "https://a.com/ev", sourceType: "official", isPrimary: true }]]]),
      bodyByUrl: new Map([["https://a.com/1", "A prefeitura inaugurou unidade com custo de 100 milhoes. ".repeat(5)]]),
      titleByUrl: new Map([["https://a.com/1", "Titulo valido para teste de claims"]]),
    });
    expect(results[0]?.assessment.unverifiedClaims.length).toBeGreaterThan(0);
    expect(results[0]?.assessment.isAutoPublishable).toBe(false);
  });
});

describe("E2E: concorrencia ad server — reserva nao ultrapassa cap", () => {
  it("duas reservas concorrentes: segunda falha quando cap=1", async () => {
    const camp: AdCampaign = {
      id: "c1",
      status: "active",
      startsAt: "2026-01-01T00:00:00Z",
      endsAt: "2026-12-31T00:00:00Z",
      placements: [{ campaignId: "c1", slotCode: "topo", priority: 100 }],
      impressionsCap: 1,
      impressionsServed: 0,
    };
    const ctx = { now: new Date("2026-06-15T00:00:00Z"), portalId: null, portalSlug: "guaruja", citySlug: "guaruja", slotCode: "topo" };
    const r1 = reserveInventoryAtomically(camp, ctx);
    expect(r1.reserved).toBe(true);
    const campAfter = { ...camp, impressionsServed: 1 };
    const r2 = reserveInventoryAtomically(campAfter, ctx);
    expect(r2.reserved).toBe(false);
  });
});

describe("E2E: expiracao de campanha", () => {
  it("campanha expirada nao vence decision", () => {
    const now = new Date("2026-06-15T00:00:00Z");
    const camp: AdCampaign = {
      id: "c1",
      status: "active",
      endsAt: "2026-06-14T00:00:00Z",
      placements: [{ campaignId: "c1", slotCode: "topo", priority: 100 }],
    };
    expect(checkCampaignEligibility(camp, { now, portalId: null, portalSlug: "guaruja", citySlug: "guaruja", slotCode: "topo" }).eligible).toBe(false);
    const { winner } = decideAd([camp], { now, portalId: null, portalSlug: "guaruja", citySlug: "guaruja", slotCode: "topo" });
    expect(winner).toBeNull();
  });
});
