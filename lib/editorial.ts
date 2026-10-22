export type RiskLevel = "low" | "medium" | "high" | "blocked";

const BLOCKED_PATTERNS: RegExp[] = [
  /acusacao sem prova/i,
  /crime.*identific/i,
  /tragedia em desenvolvimento/i,
];

export function classifyRisk(text: string): RiskLevel {
  if (!text || text.trim().length < 20) return "blocked";
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(text)) return "blocked";
  }
  if (text.length < 100) return "high";
  if (text.length < 300) return "medium";
  return "low";
}

export function isAutoPublishable(risk: RiskLevel, hasEvidence: boolean): boolean {
  if (risk === "blocked" || risk === "high") return false;
  if (!hasEvidence) return false;
  return true;
}
