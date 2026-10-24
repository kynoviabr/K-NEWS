import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { PRIMARY_DOMAIN } from "@/lib/domains";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host");
  const base = host ? `https://${host.split(":")[0]}` : `https://${PRIMARY_DOMAIN}`;
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${base}/sitemap.xml`,
  };
}
