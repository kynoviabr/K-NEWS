import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { extractCitySlugFromHost, PRIMARY_DOMAIN } from "@/lib/domains";
import { canonicalUrl } from "@/lib/portal";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get("host");
  const citySlug = extractCitySlugFromHost(host);
  const now = new Date();
  const base = citySlug ? `https://${citySlug}.${PRIMARY_DOMAIN}` : (process.env.NEXT_PUBLIC_APP_URL ?? `https://${PRIMARY_DOMAIN}`);
  // Em producao: consultar knews.articles published por portal/cidade; por ora rotas base por portal
  return [
    { url: canonicalUrl("/", citySlug) || `${base}/`, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: canonicalUrl("/portal", citySlug) || `${base}/portal`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/sitemap.xml`, lastModified: now, changeFrequency: "daily", priority: 0.5 },
  ];
}
