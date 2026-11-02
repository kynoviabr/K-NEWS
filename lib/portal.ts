import { buildPortalHost, extractCitySlugFromHost, PRIMARY_DOMAIN } from "./domains";

export type PortalContext = {
  portalId: string | null;
  portalSlug: string | null;
  citySlug: string | null;
};

export function resolvePortalFromHost(host: string | null, domains: Record<string, string>): PortalContext {
  if (!host) return { portalId: null, portalSlug: null, citySlug: null };
  const normalized = host.toLowerCase().split(":")[0] ?? "";
  const mapped = domains[normalized];
  if (mapped) return { portalId: mapped, portalSlug: normalized, citySlug: extractCitySlugFromHost(normalized) };
  // Fallback: subdominio *.portal24h.news direto
  const citySlug = extractCitySlugFromHost(normalized);
  if (citySlug) return { portalId: null, portalSlug: normalized, citySlug };
  return { portalId: null, portalSlug: null, citySlug: null };
}

export function canonicalUrl(path: string, citySlug?: string | null): string {
  const base = citySlug
    ? `https://${buildPortalHost(citySlug)}`
    : (process.env.NEXT_PUBLIC_APP_URL ?? `https://${PRIMARY_DOMAIN}`).replace(/\/$/, "");
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${base}${clean}`;
}
