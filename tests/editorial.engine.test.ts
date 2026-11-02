import { describe, it, expect } from "vitest";
import { classifyRiskFromContext, assessEvidenceQuality, detectSensitiveCategories, detectClickbait } from "@/lib/editorial";

describe("editorial engine", () => {
  it("bloqueia sem evidencia", () => {
    const r = classifyRiskFromContext({ title: "Titulo valido com tamanho suficiente", body: "Corpo com tamanho suficiente para avaliacao editorial completa.", evidences: [] });
    expect(r.level).toBe("blocked");
    expect(r.isAutoPublishable).toBe(false);
    expect(r.requiresHumanReview).toBe(true);
  });

  it("bloqueia acusacao sem prova", () => {
    const r = classifyRiskFromContext({
      title: "Denuncia de corrupcao sem prova contra prefeito",
      body: "Texto longo o suficiente com acusacao sem evidencia e sem prova envolvendo prefeito. ".repeat(5),
      evidences: [{ sourceUrl: "https://example.com/nota", sourceType: "official", isPrimary: true }],
    });
    expect(["blocked", "high"]).toContain(r.level);
    expect(r.isAutoPublishable).toBe(false);
  });

  it("permite autopublicacao apenas com evidencia forte, fontes independentes e claims verificados", () => {
    const body = "A prefeitura inaugurou nova unidade com atendimento ampliado na regiao.";
    const r = classifyRiskFromContext({
      title: "Guaruja inaugura unidade de saude no Pereque",
      body: `${body} `.repeat(10),
      evidences: [
        { sourceUrl: "https://guaruja.sp.gov.br/nota", sourceType: "official", isPrimary: true, contentSnippet: body },
        { sourceUrl: "https://diariooficial.guaruja.sp.gov.br/edicao", sourceType: "official", contentSnippet: body },
      ],
      claims: [body],
    });
    expect(r.level).toBe("low");
    expect(r.evidenceQuality).toBe("strong");
    expect(r.isAutoPublishable).toBe(true);
  });

  it("bloqueia quando claims nao tem suporte nas evidencias", () => {
    const r = classifyRiskFromContext({
      title: "Guaruja inaugura unidade de saude no Pereque",
      body: "A prefeitura inaugurou nova unidade com atendimento ampliado na regiao. ".repeat(10),
      evidences: [
        { sourceUrl: "https://guaruja.sp.gov.br/nota", sourceType: "official", isPrimary: true, contentSnippet: "Comunicado curto sem detalhes" },
        { sourceUrl: "https://diariooficial.guaruja.sp.gov.br/edicao", sourceType: "official", contentSnippet: "Outro comunicado curto" },
      ],
      claims: ["A nova unidade custou 50 milhoes e atende 10 mil pessoas por dia com tecnologia importada"],
    });
    expect(r.level).toBe("blocked");
    expect(r.unverifiedClaims.length).toBeGreaterThan(0);
    expect(r.isAutoPublishable).toBe(false);
  });

  it("detecta clickbait", () => {
    expect(detectClickbait("Voce nao vai acreditar no que aconteceu em Guaruja!")).toBe(true);
    expect(detectClickbait("Inauguracao de unidade de saude")).toBe(false);
  });

  it("assessEvidenceQuality exige URLs validas, fontes independentes e primarias", () => {
    expect(assessEvidenceQuality([])).toBe("none");
    expect(assessEvidenceQuality([{ sourceUrl: "not-a-url" }])).toBe("none");
    expect(assessEvidenceQuality([{ sourceUrl: "https://example.com/a" }])).toBe("weak");
    expect(assessEvidenceQuality([{ sourceUrl: "https://a.com", sourceType: "official", isPrimary: true }])).toBe("sufficient");
    expect(assessEvidenceQuality([{ sourceUrl: "https://example.com/a" }, { sourceUrl: "https://example.com/b" }])).toBe("sufficient");
    expect(assessEvidenceQuality([
      { sourceUrl: "https://a.com", sourceType: "official", isPrimary: true },
      { sourceUrl: "https://b.com", sourceType: "official" },
    ])).toBe("strong");
    expect(assessEvidenceQuality([
      { sourceUrl: "https://guaruja.sp.gov.br/a" },
      { sourceUrl: "https://guaruja.sp.gov.br/b" },
    ])).not.toBe("strong");
  });

  it("detectSensitiveCategories encontra alegacao sensivel", () => {
    const s = detectSensitiveCategories("Fraude na camara com vereador envolvido");
    expect(s.length).toBeGreaterThan(0);
  });
});
