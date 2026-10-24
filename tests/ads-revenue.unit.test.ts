import { describe, expect, it } from "vitest";
import { computeCommissions, detectDevice, hasAdsConsent, hashVisitor, isSafeRedirectUrl, parseMoneyToCents, summarizeRevenue } from "@/lib/ads/visitor";
import { campaignSchema, contractSchema, linkSchema, revenueSchema, saoPauloLocalToIso, validateCreativeFile } from "@/lib/validations/ads.schema";

const UUID = "10000000-0000-4000-8000-000000000021";

describe("contexto do visitante", () => {
  it("classifica dispositivos pelo user-agent", () => {
    expect(detectDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148")).toBe("mobile");
    expect(detectDevice("Mozilla/5.0 (Linux; Android 14; SM-S918B) Mobile Safari/537.36")).toBe("mobile");
    expect(detectDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    expect(detectDevice("Mozilla/5.0 (Linux; Android 13; SM-X700) Safari/537.36")).toBe("tablet");
    expect(detectDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("desktop");
    expect(detectDevice(null)).toBe("desktop");
  });

  it("so identifica o visitante com consentimento e nunca guarda o id bruto", () => {
    expect(hasAdsConsent("ads=granted")).toBe(true);
    expect(hasAdsConsent("ads=denied")).toBe(false);
    expect(hasAdsConsent(undefined)).toBe(false);
    const id = "3f0c2a8e-6b1d-4f7a-9c55-1a2b3c4d5e6f";
    const h = hashVisitor(id, "sal");
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).not.toContain(id);
    expect(hashVisitor(id, "outro-sal")).not.toBe(h);
    expect(hashVisitor("<script>", "sal")).toBeNull();
  });

  it("aceita so destinos https sem credenciais", () => {
    expect(isSafeRedirectUrl("https://loja.example/oferta?utm=1")).toBe(true);
    expect(isSafeRedirectUrl("http://loja.example")).toBe(false);
    expect(isSafeRedirectUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeRedirectUrl("https://user:pass@loja.example")).toBe(false);
    expect(isSafeRedirectUrl("//loja.example")).toBe(false);
    expect(isSafeRedirectUrl(null)).toBe(false);
  });
});

describe("dinheiro e receitas", () => {
  it("converte valores em reais para centavos", () => {
    expect(parseMoneyToCents("1.500,00")).toBe(150000);
    expect(parseMoneyToCents("R$ 12,5")).toBe(1250);
    expect(parseMoneyToCents("0,99")).toBe(99);
    expect(parseMoneyToCents("1500")).toBe(150000);
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNaN();
    expect(parseMoneyToCents("-5")).toBeNaN();
  });

  it("comissao so sobre receita confirmada ou paga de contrato com parceiro", () => {
    const contracts = [
      { id: "c1", reference: "GRJ-1", partner_id: "p1", commission_pct: 10 },
      { id: "c2", reference: "GRJ-2", partner_id: null, commission_pct: 15 },
    ];
    const revenue = [
      { source: "direct", status: "confirmed", amount_cents: 100000, contract_id: "c1" },
      { source: "direct", status: "paid", amount_cents: 50000, contract_id: "c1" },
      { source: "direct", status: "estimated", amount_cents: 999999, contract_id: "c1" },
      { source: "direct", status: "cancelled", amount_cents: 70000, contract_id: "c1" },
      { source: "direct", status: "confirmed", amount_cents: 80000, contract_id: "c2" },
      { source: "adsense", status: "confirmed", amount_cents: 3000, contract_id: null },
    ];
    expect(computeCommissions(revenue, contracts)).toEqual([{ contractId: "c1", reference: "GRJ-1", partnerId: "p1", baseCents: 150000, pct: 10, commissionCents: 15000 }]);
    expect(summarizeRevenue(revenue.filter((r) => r.status !== "cancelled"))).toEqual({ confirmedCents: 233000, estimatedCents: 999999 });
  });
});

describe("validacao dos formularios comerciais", () => {
  const base = { advertiser_id: UUID, kind: "direct", name: "Verão", ends_at: "2026-12-31T23:59", contract_id: UUID };

  it("campanha paga exige contrato; casa nao", () => {
    expect(campaignSchema.safeParse({ ...base, contract_id: "" }).success).toBe(false);
    expect(campaignSchema.safeParse({ ...base, kind: "house", contract_id: "" }).success).toBe(true);
  });

  it("converte horario de Brasilia, valida janela, CPM/CPC e editorias", () => {
    const ok = campaignSchema.parse({ ...base, starts_at: "2026-11-01T08:00", category_targets: "Saude, cidade", rate_cents: "", device_targets: ["mobile"] });
    expect(ok.starts_at).toBe("2026-11-01T11:00:00.000Z");
    expect(ok.category_targets).toEqual(["saude", "cidade"]);
    expect(ok.rate_cents).toBe(0);
    expect(campaignSchema.safeParse({ ...base, starts_at: "2027-01-01T00:00" }).success).toBe(false);
    expect(campaignSchema.safeParse({ ...base, pricing_model: "cpc", rate_cents: "" }).success).toBe(false);
    expect(campaignSchema.safeParse({ ...base, category_targets: "saúde pública" }).success).toBe(false);
    expect(campaignSchema.safeParse({ ...base, device_targets: ["desktop", "mobile", "tablet"] }).success).toBe(false);
    expect(saoPauloLocalToIso("2026-11-01")).toBeNull();
  });

  it("contrato, link e receita", () => {
    expect(contractSchema.safeParse({ advertiser_id: UUID, reference: "GRJ-1", starts_on: "2026-11-01", ends_on: "2026-10-01", total_value_cents: "100", status: "signed" }).success).toBe(false);
    expect(contractSchema.parse({ advertiser_id: UUID, reference: "GRJ-1", starts_on: "2026-11-01", ends_on: "2026-12-01", total_value_cents: "1.200,00", status: "signed" }).total_value_cents).toBe(120000);
    expect(linkSchema.safeParse({ code: "Kit Praia", title: "Kit", kind: "affiliate", destination_url: "https://a.example", disclosure: "Link patrocinado." }).success).toBe(false);
    expect(linkSchema.safeParse({ code: "kit-praia", title: "Kit", kind: "affiliate", destination_url: "http://a.example", disclosure: "Link patrocinado." }).success).toBe(false);
    expect(revenueSchema.safeParse({ source: "direct", period_start: "2026-10-01", period_end: "2026-10-31", amount_cents: "10", status: "confirmed" }).success).toBe(false);
    expect(revenueSchema.safeParse({ source: "adsense", period_start: "2026-10-01", period_end: "2026-10-31", amount_cents: "10", status: "estimated" }).success).toBe(true);
  });

  it("criativo: tipo e tamanho de arquivo", () => {
    expect(validateCreativeFile(new File([new Uint8Array(10)], "a.png", { type: "image/png" }))).toBeNull();
    expect(validateCreativeFile(new File([new Uint8Array(10)], "a.svg", { type: "image/svg+xml" }))).toMatch(/Formato/);
    expect(validateCreativeFile(new File([new Uint8Array(3 * 1024 * 1024)], "a.png", { type: "image/png" }))).toMatch(/2 MB/);
    expect(validateCreativeFile(null)).toMatch(/Escolha/);
  });
});
