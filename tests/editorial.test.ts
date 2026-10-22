import { describe, it, expect } from "vitest";
import { classifyRisk, isAutoPublishable } from "@/lib/editorial";
import { isCampaignActive, validateCampaignDates } from "@/lib/ads";

describe("editorial", () => {
  it("bloqueia texto curto ou vazio", () => {
    expect(classifyRisk("")).toBe("blocked");
    expect(classifyRisk("curto")).toBe("blocked");
  });

  it("bloqueia sem evidencia", () => {
    expect(isAutoPublishable("low", false)).toBe(false);
    expect(isAutoPublishable("blocked", true)).toBe(false);
    expect(isAutoPublishable("high", true)).toBe(false);
    expect(isAutoPublishable("low", true)).toBe(true);
  });
});

describe("ads", () => {
  it("valida datas de campanha", () => {
    expect(validateCampaignDates("2026-01-02", "2026-01-01")).toBeTruthy();
    expect(validateCampaignDates("2026-01-01", "2026-01-02")).toBeNull();
  });

  it("ativa somente dentro da janela", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    expect(isCampaignActive({ id: "1", status: "active", startsAt: "2026-06-14", endsAt: "2026-06-16" }, now)).toBe(true);
    expect(isCampaignActive({ id: "1", status: "draft" }, now)).toBe(false);
    expect(isCampaignActive({ id: "1", status: "active", startsAt: "2026-06-16" }, now)).toBe(false);
  });
});
