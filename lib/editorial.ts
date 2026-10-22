export type RiskLevel = "low" | "medium" | "high" | "blocked";
export type EvidenceQuality = "none" | "weak" | "sufficient" | "strong";
export type Evidence = {
  sourceUrl: string;
  sourceLabel?: string | null;
  sourceType?: "official" | "licensed" | "rss" | "api" | "other";
  capturedAt?: string | null;
  isPrimary?: boolean;
};

export type EditorialContext = {
  title?: string | null;
  body?: string | null;
  category?: string | null;
  evidences: Evidence[];
  hasCorrectionHistory?: boolean;
};

export type RiskAssessment = {
  level: RiskLevel;
  blockedReasons: string[];
  evidenceQuality: EvidenceQuality;
  requiresHumanReview: boolean;
  isAutoPublishable: boolean;
};

export type SensitiveCategory =
  | "accusation_without_evidence"
  | "crime_identifiable_person"
  | "developing_tragedy"
  | "sensitive_allegation"
  | "election_claim"
  | "health_misinformation_risk";

const SENSITIVE_PATTERNS: Array<{ category: SensitiveCategory; re: RegExp; reason: string }> = [
  {
    category: "accusation_without_evidence",
    re: /\b(acusad[oa]|acusacao|acusações|denuncia|denúncia)\b.*\b(sem prova|sem evidencia|sem evid[eê]ncia)\b/i,
    reason: "Acusacao sem prova explicita",
  },
  {
    category: "crime_identifiable_person",
    re: /\b(prisao|preso|presa|assassinato|homicidio|estupro|acusado)\b.*\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/i,
    reason: "Possivel crime com pessoa identificavel",
  },
  {
    category: "developing_tragedy",
    re: /\b(tragedia|desastre|desabamento|enchente|rompimento|explosao)\b.*\b(em desenvolvimento|em andamento|urgente|ultima hora)\b/i,
    reason: "Tragedia em desenvolvimento",
  },
  {
    category: "sensitive_allegation",
    re: /\b(fraude|corrupcao|corrupção|desvio|propina|lava jato)\b.*\b(prefeit[oa]|vereador|camara|câmara|secretari[oa])\b/i,
    reason: "Alegacao sensivel envolvendo agente publico",
  },
  {
    category: "election_claim",
    re: /\b(eleicao|eleição|urna|candidato|voto)\b.*\b(fraude|manipulacao|manipulação|compra de voto)\b/i,
    reason: "Alegacao eleitoral sensivel",
  },
];

const CLICKBAIT_PATTERNS: RegExp[] = [
  /voce nao vai acreditar/i,
  /chocante/i,
  /\b(urgente|bomba|exclusivo)\b.*!/i,
];

function normalizeText(s: string | null | undefined): string {
  return (s ?? "").trim();
}

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function assessEvidenceQuality(evidences: Evidence[]): EvidenceQuality {
  if (!evidences || evidences.length === 0) return "none";
  const valid = evidences.filter((e) => isValidUrl(e.sourceUrl));
  if (valid.length === 0) return "none";
  const hasPrimary = valid.some((e) => e.isPrimary || e.sourceType === "official" || e.sourceType === "licensed");
  const hasMultipleSources = valid.length >= 2;
  if (hasPrimary && hasMultipleSources) return "strong";
  if (hasPrimary || hasMultipleSources) return "sufficient";
  return "weak";
}

export function detectSensitiveCategories(text: string): Array<{ category: SensitiveCategory; reason: string }> {
  const found: Array<{ category: SensitiveCategory; reason: string }> = [];
  for (const p of SENSITIVE_PATTERNS) {
    if (p.re.test(text)) found.push({ category: p.category, reason: p.reason });
  }
  return found;
}

export function detectClickbait(text: string): boolean {
  return CLICKBAIT_PATTERNS.some((re) => re.test(text));
}

export function classifyRiskFromContext(ctx: EditorialContext): RiskAssessment {
  const title = normalizeText(ctx.title);
  const body = normalizeText(ctx.body);
  const combined = `${title}\n${body}`.trim();
  const blockedReasons: string[] = [];

  if (!combined || combined.length < 20) {
    blockedReasons.push("Conteudo insuficiente para avaliacao editorial");
  }

  if (!title || title.length < 10) {
    blockedReasons.push("Titulo ausente ou muito curto");
  }

  if (detectClickbait(title) || detectClickbait(body)) {
    blockedReasons.push("Possivel clickbait detectado — requer revisao humana");
  }

  const evidenceQuality = assessEvidenceQuality(ctx.evidences);
  if (evidenceQuality === "none") {
    blockedReasons.push("Nenhuma evidencia rastreavel valida");
  }
  if (evidenceQuality === "weak") {
    blockedReasons.push("Evidencia fraca — necessario reforco de fontes primarias ou multiplas fontes");
  }

  const sensitive = detectSensitiveCategories(combined);
  for (const s of sensitive) {
    blockedReasons.push(s.reason);
  }

  let level: RiskLevel = "low";
  if (blockedReasons.length > 0) {
    const hasHardBlock = sensitive.length > 0 || evidenceQuality === "none" || combined.length < 20;
    level = hasHardBlock ? "blocked" : "high";
    if (evidenceQuality === "weak" && level !== "blocked") level = "high";
  } else {
    if (evidenceQuality === "sufficient") level = "medium";
    if (evidenceQuality === "strong") level = "low";
    if (combined.length < 300 && level === "low") level = "medium";
  }

  const requiresHumanReview = level === "blocked" || level === "high" || evidenceQuality !== "strong";
  const isAutoPublishable = level === "low" && evidenceQuality === "strong" && sensitive.length === 0 && !detectClickbait(title);

  return {
    level,
    blockedReasons,
    evidenceQuality,
    requiresHumanReview,
    isAutoPublishable,
  };
}

// Legacy shim — preserved for backward compatibility, delegates to contextual assessment
export function classifyRisk(text: string): RiskLevel {
  return classifyRiskFromContext({ title: text, body: "", evidences: [] }).level;
}

export function isAutoPublishable(risk: RiskLevel, hasEvidence: boolean): boolean {
  if (risk === "blocked" || risk === "high") return false;
  if (!hasEvidence) return false;
  return true;
}
