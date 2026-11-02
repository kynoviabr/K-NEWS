import type { MetadataRoute } from "next";
import { canonicalUrl } from "@/lib/portal";
import { listPublished, resolveRequestPortal } from "@/lib/portal-data";

export const dynamic = "force-dynamic";

// Sitemap por hostname: cada portal lista apenas as proprias materias publicadas.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const portal = await resolveRequestPortal().catch(() => null);
  if (!portal) return [{ url: canonicalUrl("/"), lastModified: new Date(), changeFrequency: "daily", priority: 0.5 }];
  const articles = await listPublished(portal.id, 50).catch(() => []);
  return [
    { url: canonicalUrl("/portal", portal.slug), lastModified: new Date(), changeFrequency: "hourly", priority: 1 },
    ...articles.map((a) => ({
      url: canonicalUrl(`/portal/noticia/${a.slug}`, portal.slug),
      lastModified: new Date(a.updated_at),
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
  ];
}
