import { extractClaims, type ExtractedClaim } from "@/lib/claim-extractor";
import { foldText } from "@/lib/news-intelligence/fingerprint";

// Checagens deterministicas do rascunho contra o material de origem. Nao provam
// que um fato e verdadeiro; apenas impedem que o rascunho traga numeros/citacoes
// ausentes da fonte ou copie trechos longos. A verificacao final e humana.

export type ClaimCheck = ExtractedClaim & { status: "needs_review" | "unsupported"; note: string | null };

export type DraftGuardResult = {
  claims: ClaimCheck[];
  copiedRun: number;
  flags: string[];
};

const NUMBER_RE = /\d+(?:[.,]\d+)*/g;

function words(s: string): string[] {
  return foldText(s).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

// Maior sequencia de palavras consecutivas copiada da fonte.
export function longestCopiedRun(draft: string, source: string): number {
  const a = words(draft);
  const b = words(source);
  if (a.length === 0 || b.length === 0) return 0;
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1]! + 1;
        if (cur[j]! > best) best = cur[j]!;
      }
    }
    prev = cur;
  }
  return best;
}

export function checkDraft(draftBody: string, sourceText: string, opts: { maxCopiedRun?: number } = {}): DraftGuardResult {
  const maxRun = opts.maxCopiedRun ?? 15;
  const sourceFolded = foldText(sourceText);
  const sourceNumbers = new Set((sourceText.match(NUMBER_RE) ?? []).map((n) => n.replace(/[.,]/g, "")));
  const flags: string[] = [];

  const claims: ClaimCheck[] = extractClaims(draftBody).map((c) => {
    const missingNumbers = (c.text.match(NUMBER_RE) ?? []).filter((n) => !sourceNumbers.has(n.replace(/[.,]/g, "")));
    if (missingNumbers.length > 0) {
      return { ...c, status: "unsupported", note: `Numero(s) ausente(s) da fonte: ${missingNumbers.join(", ")}` };
    }
    if (c.kind === "quote" && !sourceFolded.includes(foldText(c.text))) {
      return { ...c, status: "unsupported", note: "Citacao literal nao encontrada na fonte" };
    }
    return { ...c, status: "needs_review", note: null };
  });

  if (claims.some((c) => c.status === "unsupported")) flags.push("Rascunho contem afirmacoes sem respaldo na fonte");
  const copiedRun = longestCopiedRun(draftBody, sourceText);
  if (copiedRun >= maxRun) flags.push(`Possivel copia literal da fonte (${copiedRun} palavras seguidas)`);
  return { claims, copiedRun, flags };
}
