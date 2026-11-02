export type ExtractedClaim = {
  text: string;
  kind: "factual" | "quote" | "opinion";
};

const QUOTE_RE = /["“”«»'‘’]([^"“”«»'‘’]{20,400})["“”«»'‘’]/g;
const FACTUAL_HINTS = [/\b\d+\b/, /\b(custo|atende|inaugur|prefeit|unidade|hospital|escola|obra|licita)\b/i];

export function extractClaims(body: string, maxClaims = 20): ExtractedClaim[] {
  const normalized = (body ?? "").trim();
  if (!normalized) return [];
  const claims: ExtractedClaim[] = [];

  let m: RegExpExecArray | null;
  while ((m = QUOTE_RE.exec(normalized)) !== null && claims.length < maxClaims) {
    const t = m[1]?.trim();
    if (t && t.length >= 20 && t.length <= 400) {
      claims.push({ text: t, kind: "quote" });
    }
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 30 && s.length <= 400);

  for (const s of sentences) {
    if (claims.length >= maxClaims) break;
    if (claims.some((c) => c.text === s)) continue;
    const isFactual = FACTUAL_HINTS.some((re) => re.test(s));
    const hasNumbers = /\d/.test(s);
    if (isFactual || hasNumbers || s.toLowerCase().includes("segundo") || s.toLowerCase().includes("de acordo")) {
      claims.push({ text: s, kind: "factual" });
    }
  }

  if (claims.length === 0) {
    for (const s of sentences.slice(0, 3)) {
      if (claims.length >= maxClaims) break;
      claims.push({ text: s, kind: "opinion" });
    }
  }

  return claims.slice(0, maxClaims);
}

export function validateQuoteAttribution(claim: ExtractedClaim, evidences: Array<{ contentSnippet?: string | null; sourceLabel?: string | null }>): boolean {
  if (claim.kind !== "quote") return true;
  const evidenceText = evidences.map((e) => `${e.contentSnippet ?? ""} ${e.sourceLabel ?? ""}`).join(" ").toLowerCase();
  const claimTokens = claim.text.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
  if (claimTokens.length === 0) return false;
  const hitRatio = claimTokens.filter((t) => evidenceText.includes(t)).length / claimTokens.length;
  return hitRatio >= 0.5;
}
