import { describe, it, expect } from "vitest";
import {
  checkCampaignEligibility,
  shouldAutoEnd,
  selectByRotation,
  eligibleCampaigns,
  validateCampaignDates,
  type AdCampaign,
  type DeliveryContext,
} from "@/lib/ad-eligibility";

const baseCtx = (overrides: Partial<DeliveryContext> = {}): DeliveryContext => ({
  now: new Date("2026-06-15T12:00:00Z"),
  portalId: "portal-1",
  portalSlug: "guaruja",
  citySlug: "guaruja",
  slotCode: "topo-portal",
  ...overrides,
});

const active = (overrides: Partial<AdCampaign> = {}): AdCampaign => ({
  id: "camp-1",
  status: "active",
  startsAt: "2026-06-01T00:00:00Z",
  endsAt: "2026-06-30T00:00:00Z",
  placements: [{ campaignId: "camp-1", slotCode: "topo-portal", priority: 100 }],
  ...overrides,
});

describe("ad eligibility", () => {
  it("bloqueia fora da janela contratada", () => {
    expect(checkCampaignEligibility(active({ startsAt: "2026-06-16" }), baseCtx()).eligible).toBe(false);
    expect(checkCampaignEligibility(active({ endsAt: "2026-06-14" }), baseCtx()).eligible).toBe(false);
  });

  it("bloqueia sem placement no slot", () => {
    expect(checkCampaignEligibility(active({ placements: [{ campaignId: "camp-1", slotCode: "outro-slot", priority: 100 }] }), baseCtx()).eligible).toBe(false);
  });

  it("bloqueia por geografia", () => {
    expect(checkCampaignEligibility(active({ geoTargets: ["santos"] }), baseCtx()).eligible).toBe(false);
    expect(checkCampaignEligibility(active({ geoTargets: ["guaruja"] }), baseCtx()).eligible).toBe(true);
    expect(checkCampaignEligibility(active({ geoTargets: [] }), baseCtx()).eligible).toBe(true);
  });

  it("bloqueia por cap de impressoes e orcamento", () => {
    expect(checkCampaignEligibility(active({ impressionsCap: 1000, impressionsServed: 1000 }), baseCtx()).eligible).toBe(false);
    expect(checkCampaignEligibility(active({ budgetCents: 10000, budgetSpentCents: 10000 }), baseCtx()).eligible).toBe(false);
  });

  it("bloqueia por frequency cap", () => {
    const ctx = baseCtx({ userViewCounts: new Map([["camp-1", 3]]) });
    expect(checkCampaignEligibility(active({ frequencyCapPerUser: 3 }), ctx).eligible).toBe(false);
    expect(checkCampaignEligibility(active({ frequencyCapPerUser: 4 }), ctx).eligible).toBe(true);
  });

  it("shouldAutoEnd por data, impressoes ou orcamento", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    expect(shouldAutoEnd(active({ endsAt: "2026-06-14" }), now)).toBe(true);
    expect(shouldAutoEnd(active({ impressionsCap: 100, impressionsServed: 100 }), now)).toBe(true);
    expect(shouldAutoEnd(active({ budgetCents: 5000, budgetSpentCents: 5000 }), now)).toBe(true);
    expect(shouldAutoEnd(active(), now)).toBe(false);
  });

  it("rotacao respeita prioridade e round-robin", () => {
    const a: AdCampaign = active({ id: "a", placements: [{ campaignId: "a", slotCode: "topo-portal", priority: 10 }] });
    const b: AdCampaign = active({ id: "b", placements: [{ campaignId: "b", slotCode: "topo-portal", priority: 10 }] });
    const c: AdCampaign = active({ id: "c", placements: [{ campaignId: "c", slotCode: "topo-portal", priority: 5 }] });
    expect(selectByRotation([a, b, c], 0)?.id).toBe("a");
    expect(selectByRotation([a, b, c], 1)?.id).toBe("b");
    expect(selectByRotation([c], 0)?.id).toBe("c");
    expect(selectByRotation([], 0)).toBeNull();
  });

  it("eligibleCampaigns filtra corretamente", () => {
    const campaigns: AdCampaign[] = [
      active({ id: "ok" }),
      active({ id: "expired", endsAt: "2026-06-14" }),
      { ...active({ id: "paused" }), status: "paused" },
    ];
    expect(eligibleCampaigns(campaigns, baseCtx()).map((c) => c.id)).toEqual(["ok"]);
  });

  it("validateCampaignDates", () => {
    expect(validateCampaignDates("2026-06-16", "2026-06-15")).toBeTruthy();
    expect(validateCampaignDates("2026-06-15", "2026-06-16")).toBeNull();
  });
});
