import { deduplicateByCanonical, normalizeUrl, type FetchResult } from "@/services/rss";
import { classifyRiskFromContext, type Evidence, type RiskAssessment } from "@/lib/editorial";

export type NormalizedItem = FetchResult & {
  dedupKey: string;
  normalizedCanonical: string;
};

export type PipelineInput = {
  portalId: string;
  rawItems: FetchResult[];
  evidencesByUrl: Map<string, Evidence[]>;
  bodyByUrl: Map<string, string>;
  titleByUrl: Map<string, string>;
};

export type PipelineItemResult = {
  url: string;
  normalized: NormalizedItem;
  assessment: RiskAssessment;
  blocked: boolean;
  shouldStore: boolean;
};

export function runNewsIntelligencePipeline(input: PipelineInput): PipelineItemResult[] {
  const deduped = deduplicateByCanonical(input.rawItems);

  return deduped.map((item) => {
    const dedupKey = normalizeUrl(item.canonical ?? item.url);
    const normalized: NormalizedItem = {
      ...item,
      dedupKey,
      normalizedCanonical: normalizeUrl(item.canonical ?? item.url),
    };

    const body = input.bodyByUrl.get(item.url) ?? item.summary ?? "";
    const title = input.titleByUrl.get(item.url) ?? item.title;
    const evidences = input.evidencesByUrl.get(item.url) ?? [];

    const assessment = classifyRiskFromContext({
      title,
      body,
      evidences,
    });

    const blocked = assessment.level === "blocked" || assessment.requiresHumanReview;
    const shouldStore = !blocked || assessment.level === "high";

    return { url: item.url, normalized, assessment, blocked, shouldStore };
  });
}

export function persistentDedupKeys(items: NormalizedItem[], existingKeys: Set<string>): { newItems: NormalizedItem[]; duplicates: NormalizedItem[] } {
  const newItems: NormalizedItem[] = [];
  const duplicates: NormalizedItem[] = [];
  for (const item of items) {
    if (existingKeys.has(item.dedupKey)) {
      duplicates.push(item);
    } else {
      newItems.push(item);
      existingKeys.add(item.dedupKey);
    }
  }
  return { newItems, duplicates };
}
