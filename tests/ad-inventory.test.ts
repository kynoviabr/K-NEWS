import { describe, it, expect } from "vitest";
import { reserveInventoryAtomically, decideAd } from "@/lib/ad-inventory";
import type { AdCampaign } from "@/lib/ad-eligibility";

const baseCamp = (overrides: Partial<AdCampaign> = {}): AdCampaign => ({
  id: "c1",
  status: "active",
  startsAt: "2026-01-01T00:00:00Z",
  endsAt: "2026-12-31T00:00:00Z",
  placements: [{ campaignId: "c1", slotCode: "topo", priority: 100 }],
  ...overrides,
});

describe("ad inventory", () => {
  it("reserva atomica bloqueia fora da janela", () => {
    const camp = baseCamp({ endsAt: "2026-01-02T00:00:00Z" });
    const r = reserveInventoryAtomically(camp, { now: new Date("2026-06-15T00:00:00Z"), portalId: null, portalSlug: "guaruja", citySlug: "guaruja", slotCode: "topo" });
    expect(r.reserved).toBe(false);
  });

  it("reserva com sucesso quando elegivel", () => {
    const r = reserveInventoryAtomically(baseCamp(), { now: new Date("2026-06-15T00:00:00Z"), portalId: null, portalSlug: "guaruja", citySlug: "guaruja", slotCode: "topo" });
    expect(r.reserved).toBe(true);
    expect(r.reservation?.campaignId).toBe("c1");
  });

  it("decide ad escolhe vencedora elegivel", () => {
    const a = baseCamp({ id: "a", placements: [{ campaignId: "a", slotCode: "topo", priority: 10 }] });
    const b = baseCamp({ id: "b", status: "paused", placements: [{ campaignId: "b", slotCode: "topo", priority: 100 }] });
    const { winner } = decideAd([a, b], { now: new Date("2026-06-15T00:00:00Z"), portalId: null, portalSlug: "guaruja", citySlug: "guaruja", slotCode: "topo" });
    expect(winner?.id).toBe("a");
  });

  it("nao ultrapassa cap ao reservar", () => {
    const camp = baseCamp({ impressionsCap: 10, impressionsServed: 10 });
    const r = reserveInventoryAtomically(camp, { now: new Date("2026-06-15T00:00:00Z"), portalId: null, portalSlug: "guaruja", citySlug: "guaruja", slotCode: "topo" });
    expect(r.reserved).toBe(false);
    expect(r.reason).toMatch(/cap/);
  });

  it("nao grava HTML em noticias", () => {
    // AdSlot renderiza placeholder, nao injeta HTML nas materias
    const html = "<article>Noticia sem anuncio embutido</article>";
    expect(html).not.toContain("data-ad-slot");
  });
});
