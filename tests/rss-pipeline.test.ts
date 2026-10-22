import { describe, it, expect } from "vitest";
import { normalizeUrl, deduplicateByCanonical, validateLicense } from "@/services/rss";

describe("rss pipeline", () => {
  it("normalizes URL", () => {
    expect(normalizeUrl("https://example.com/page?a=1&b=2#frag")).toBe("https://example.com/page?a=1&b=2");
  });

  it("deduplicates by canonical", () => {
    const items = [
      { url: "https://a.com/1", title: "T1", canonical: "https://a.com/canon", publishedAt: null, summary: null },
      { url: "https://a.com/2", title: "T2", canonical: "https://a.com/canon", publishedAt: null, summary: null },
      { url: "https://a.com/3", title: "T3", canonical: null, publishedAt: null, summary: null },
    ];
    expect(deduplicateByCanonical(items)).toHaveLength(2);
  });

  it("validates license for licensed sources", () => {
    expect(validateLicense({ kind: "licensed_api", license: null })).toBe(false);
    expect(validateLicense({ kind: "rss" })).toBe(true);
  });
});
