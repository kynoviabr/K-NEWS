import type { MetadataRoute } from "next";
import { canonicalUrl, portalUrl } from "@/lib/portal";
import { getSections, listPublished, resolveRequestPortal } from "@/lib/portal-data";

export const dynamic = "force-dynamic";

// Sitemap por hostname: cada portal lista apenas as proprias materias publicadas.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const portal = await resolveRequestPortal().catch(() => null);
  if (!portal) return [{ url: canonicalUrl("/"), lastModified: new Date(), changeFrequency: "daily", priority: 0.5 }];
  const [articles, sections] = await Promise.all([
    listPublished(portal.id, 50).catch(() => []),
    getSections(portal.id).catch(() => ({ categories: [], neighborhoods: [] })),
  ]);
  return [
    { url: portalUrl(portal, "/portal"), lastModified: new Date(), changeFrequency: "hourly", priority: 1 },
    ...sections.categories.filter((c) => c.count > 0).map((c) => ({ url: portalUrl(portal, `/portal/editoria/${c.slug}`), changeFrequency: "daily" as const, priority: 0.6 })),
    ...sections.neighborhoods.filter((n) => n.count > 0).map((n) => ({ url: portalUrl(portal, `/portal/bairro/${n.slug}`), changeFrequency: "daily" as const, priority: 0.5 })),
    ...articles.map((a) => ({
      url: portalUrl(portal, `/portal/noticia/${a.slug}`),
      lastModified: new Date(a.updated_at),
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
  ];
}
