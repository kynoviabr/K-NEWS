export type RiskLevel = "low" | "medium" | "high" | "blocked";
export type EvidenceQuality = "none" | "weak" | "sufficient" | "strong";
export type Evidence = {
  sourceUrl: string;
  sourceLabel?: string | null;
  sourceType?: "official" | "licensed" | "rss" | "api" | "other";
  capturedAt?: string | null;
  isPrimary?: boolean;
  contentSnippet?: string | null;
};

export type EditorialContext = {
  title?: string | null;
  body?: string | null;
  category?: string | null;
  evidences: Evidence[];
  hasCorrectionHistory?: boolean;
  claims?: string[];
};

export type RiskAssessment = {
  level: RiskLevel;
  blockedReasons: string[];
  evidenceQuality: EvidenceQuality;
  requiresHumanReview: boolean;
  isAutoPublishable: boolean;
  unverifiedClaims: string[];
  independentSourceCount: number;
};

export type SensitiveCategory =
  | "accusation_without_evidence"
  | "crime_identifiable_person"
  | "developing_tragedy"
  | "sensitive_allegation"
  | "election_claim"
  | "health_misinformation_risk";

const SENSITIVE_PATTERNS: Array<{ category: SensitiveCategory; re: RegExp; reason: string }> = [
  { category: "accusation_without_evidence", re: /\b(acusad[oa]|acusacao|acusações|denuncia|denúncia)\b.*\b(sem prova|sem evidencia|sem evid[eê]ncia)\b/i, reason: "Acusacao sem prova explicita" },
  { category: "crime_identifiable_person", re: /\b(prisao|preso|presa|assassinato|homicidio|estupro|acusado|condenad[oa])\b/i, reason: "Possivel crime com pessoa identificavel — requer confirmacao oficial" },
  { category: "developing_tragedy", re: /\b(tragedia|desastre|desabamento|enchente|rompimento|explosao|vazamento|contaminacao)\b/i, reason: "Possivel tragedia/desastre — verificar estagio e fontes primarias" },
  { category: "sensitive_allegation", re: /\b(fraude|corrupcao|corrupção|desvio|propina|lava jato|superfaturamento)\b/i, reason: "Alegacao sensivel envolvendo agente publico ou recurso publico" },
  { category: "election_claim", re: /\b(eleicao|eleição|urna|candidato|voto|titulo eleitoral)\b.*\b(fraude|manipulacao|manipulação|compra de voto|irregularidade)\b/i, reason: "Alegacao eleitoral sensivel" },
  { category: "health_misinformation_risk", re: /\b(cura milagrosa|tratamento.*sem comprovacao|vacina.*causa|autismo|cloroquina.*cura)\b/i, reason: "Risco de desinformacao em saude" },
];

const CLICKBAIT_PATTERNS: RegExp[] = [/voce nao vai acreditar/i, /chocante/i, /\b(urgente|bomba|exclusivo)\b.*!/i];

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

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

export function assessEvidenceQuality(evidences: Evidence[]): EvidenceQuality {
  if (!evidences || evidences.length === 0) return "none";
  const valid = evidences.filter((e) => isValidUrl(e.sourceUrl));
  if (valid.length === 0) return "none";
  const hasPrimary = valid.some((e) => e.isPrimary || e.sourceType === "official" || e.sourceType === "licensed");
  const independentHosts = new Set(valid.map((e) => hostOf(e.sourceUrl)).filter(Boolean) as string[]);
  const hasMultipleIndependent = independentHosts.size >= 2;
  if (hasPrimary && hasMultipleIndependent) return "strong";
  if (hasPrimary || hasMultipleIndependent) return "sufficient";
  if (valid.length >= 2) return "sufficient";
  return "weak";
}

function independentSourceCount(evidences: Evidence[]): number {
  const valid = evidences.filter((e) => isValidUrl(e.sourceUrl));
  return new Set(valid.map((e) => hostOf(e.sourceUrl)).filter(Boolean) as string[]).size;
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

function extractClaims(body: string): string[] {
  return body
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 400)
    .slice(0, 20);
}

function verifyClaimsAgainstEvidences(claims: string[], evidences: Evidence[]): string[] {
  const unverified: string[] = [];
  const evidenceText = evidences.map((e) => (e.contentSnippet ?? e.sourceLabel ?? "")).join(" ").toLowerCase();
  const evidenceTokens = new Set(evidenceText.split(/\W+/).filter((t) => t.length > 4));
  for (const claim of claims) {
    const claimTokens = claim.toLowerCase().split(/\W+/).filter((t) => t.length > 4);
    if (claimTokens.length === 0) continue;
    const overlap = claimTokens.filter((t) => evidenceTokens.has(t)).length / claimTokens.length;
    if (overlap < 0.3) {
      unverified.push(claim);
    }
  }
  return unverified;
}

export function classifyRiskFromContext(ctx: EditorialContext): RiskAssessment {
  const title = normalizeText(ctx.title);
  const body = normalizeText(ctx.body);
  const combined = `${title}\n${body}`.trim();
  const blockedReasons: string[] = [];

  if (!combined || combined.length < 20) blockedReasons.push("Conteudo insuficiente para avaliacao editorial");
  if (!title || title.length < 10) blockedReasons.push("Titulo ausente ou muito curto");
  if (detectClickbait(title) || detectClickbait(body)) blockedReasons.push("Possivel clickbait detectado — requer revisao humana");

  const evidenceQuality = assessEvidenceQuality(ctx.evidences);
  if (evidenceQuality === "none") blockedReasons.push("Nenhuma evidencia rastreavel valida");
  if (evidenceQuality === "weak") blockedReasons.push("Evidencia fraca — necessario reforco de fontes primarias ou multiplas fontes independentes");
  const independentCount = independentSourceCount(ctx.evidences);
  if (independentCount < 2 && evidenceQuality !== "none") {
    blockedReasons.push("Exige pelo menos duas fontes independentes para autopublicacao");
  }

  const sensitive = detectSensitiveCategories(combined);
  for (const s of sensitive) blockedReasons.push(s.reason);

  const claims = ctx.claims && ctx.claims.length > 0 ? ctx.claims : extractClaims(body);
  const unverifiedClaims = verifyClaimsAgainstEvidences(claims, ctx.evidences);
  if (unverifiedClaims.length > 0) {
    blockedReasons.push(`${unverifiedClaims.length} afirmacao(oes) sem suporte nas evidencias`);
  }

  let level: RiskLevel = "low";
  if (blockedReasons.length > 0) {
    const hasHardBlock = sensitive.length > 0 || evidenceQuality === "none" || combined.length < 20 || unverifiedClaims.length > 0;
    level = hasHardBlock ? "blocked" : "high";
    if (evidenceQuality === "weak" && level !== "blocked") level = "high";
  } else {
    if (evidenceQuality === "sufficient") level = "medium";
    if (evidenceQuality === "strong") level = "low";
    if (combined.length < 300 && level === "low") level = "medium";
  }

  const requiresHumanReview = level === "blocked" || level === "high" || evidenceQuality !== "strong" || unverifiedClaims.length > 0;
  const isAutoPublishable = level === "low" && evidenceQuality === "strong" && sensitive.length === 0 && !detectClickbait(title) && unverifiedClaims.length === 0 && independentCount >= 2;

  return { level, blockedReasons, evidenceQuality, requiresHumanReview, isAutoPublishable, unverifiedClaims, independentSourceCount: independentCount };
}

export function classifyRisk(text: string): RiskLevel {
  return classifyRiskFromContext({ title: text, body: "", evidences: [] }).level;
}

export function isAutoPublishable(risk: RiskLevel, hasEvidence: boolean): boolean {
  if (risk === "blocked" || risk === "high") return false;
  if (!hasEvidence) return false;
  return true;
}
