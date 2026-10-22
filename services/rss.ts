import { z } from "zod";

export const fetchResultSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  canonical: z.string().url().nullable(),
  publishedAt: z.string().nullable(),
  summary: z.string().nullable(),
});

export type FetchResult = z.infer<typeof fetchResultSchema>;

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.searchParams.sort();
    return u.toString();
  } catch {
    return url.trim();
  }
}

export function deduplicateByCanonical(items: FetchResult[]): FetchResult[] {
  const seen = new Set<string>();
  const out: FetchResult[] = [];
  for (const item of items) {
    const key = normalizeUrl(item.canonical ?? item.url);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export function validateLicense(source: { license?: string | null; kind: string }): boolean {
  if (source.kind === "licensed_api" || source.kind === "official_api") {
    return !!source.license && source.license.length > 5;
  }
  return true;
}
