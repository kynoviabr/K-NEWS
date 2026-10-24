import "server-only";
import { headers } from "next/headers";
import { getPortalPublicClient } from "@/lib/supabase/knews";
import { normalizeHost } from "@/lib/domains";

export type PublicPortal = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  city_slug: string | null;
  primary_domain: string | null;
  theme: Record<string, unknown>;
  seo: Record<string, unknown>;
};
export type PortalSection = { slug: string; name: string; count: number };
export type PortalSections = { categories: PortalSection[]; neighborhoods: PortalSection[] };
export type SearchItem = PublicArticleSummary & { neighborhood: string | null };
export type PublicArticleSummary = { slug: string; title: string; excerpt: string | null; category: string | null; published_at: string; updated_at: string };
export type PublicArticle = PublicArticleSummary & {
  body: string;
  neighborhood: string | null;
  version: number;
  evidences: Array<{ url: string; label: string | null; type: string; captured_at: string }>;
  corrections: Array<{ note: string; at: string }>;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

// Host da requisicao -> portal (portal_domains ou <slug>.portal24h.news). Em
// desenvolvimento local, KNEWS_DEV_PORTAL_HOST escolhe o portal (ex.: guaruja.portal24h.news).
export async function resolveRequestPortal(): Promise<PublicPortal | null> {
  const db = getPortalPublicClient();
  if (!db) return null;
  const host = normalizeHost((await headers()).get("host"));
  const lookup = host && LOCAL_HOSTS.has(host) && process.env.KNEWS_DEV_PORTAL_HOST ? process.env.KNEWS_DEV_PORTAL_HOST : host;
  if (!lookup) return null;
  const { data, error } = await db.rpc("portal_by_host", { p_host: lookup });
  if (error) throw new Error(`portal_by_host: ${error.message}`);
  return (data as PublicPortal | null) ?? null;
}

export async function listPublished(portalId: string, limit = 20): Promise<PublicArticleSummary[]> {
  const db = getPortalPublicClient();
  if (!db) return [];
  const { data, error } = await db.rpc("published_articles", { p_portal_id: portalId, p_limit: limit });
  if (error) throw new Error(`published_articles: ${error.message}`);
  return (data as PublicArticleSummary[]) ?? [];
}

export async function getPublished(portalId: string, slug: string): Promise<PublicArticle | null> {
  const db = getPortalPublicClient();
  if (!db) return null;
  const { data, error } = await db.rpc("published_article", { p_portal_id: portalId, p_slug: slug });
  if (error) throw new Error(`published_article: ${error.message}`);
  return (data as PublicArticle | null) ?? null;
}

export async function getSections(portalId: string): Promise<PortalSections> {
  const db = getPortalPublicClient();
  if (!db) return { categories: [], neighborhoods: [] };
  const { data, error } = await db.rpc("portal_sections", { p_portal_id: portalId });
  if (error) throw new Error(`portal_sections: ${error.message}`);
  return (data as PortalSections | null) ?? { categories: [], neighborhoods: [] };
}

export const PAGE_SIZE = 12;

// Lista filtrada (editoria, bairro) e busca textual; sempre restrita ao portal.
export async function searchArticles(
  portalId: string,
  filters: { query?: string | null; category?: string | null; neighborhood?: string | null; page?: number },
): Promise<{ total: number; items: SearchItem[] }> {
  const db = getPortalPublicClient();
  if (!db) return { total: 0, items: [] };
  const page = Math.max(1, Math.min(filters.page ?? 1, 100));
  const { data, error } = await db.rpc("search_articles", {
    p_portal_id: portalId,
    p_query: filters.query?.slice(0, 100) || null,
    p_category: filters.category || null,
    p_neighborhood: filters.neighborhood || null,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  if (error) throw new Error(`search_articles: ${error.message}`);
  return (data as { total: number; items: SearchItem[] } | null) ?? { total: 0, items: [] };
}
