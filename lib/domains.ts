export const PRIMARY_DOMAIN = "portal24h.news";
export const WILDCARD_PATTERN = "*.portal24h.news";

const RESERVED_SUBDOMAINS = new Set(["www", "api", "admin", "app", "mail", "ftp", "portal24h"]);

export function normalizeHost(host: string | null | undefined): string | null {
  if (!host) return null;
  return host.toLowerCase().split(":")[0]?.trim() || null;
}

export function extractCitySlugFromHost(host: string | null | undefined): string | null {
  const h = normalizeHost(host);
  if (!h) return null;
  if (h === PRIMARY_DOMAIN || h === `www.${PRIMARY_DOMAIN}`) return null;
  if (!h.endsWith(`.${PRIMARY_DOMAIN}`)) return null;
  const sub = h.slice(0, h.length - PRIMARY_DOMAIN.length - 1);
  if (!sub || sub.includes(".")) return null;
  if (RESERVED_SUBDOMAINS.has(sub)) return null;
  if (!/^[a-z0-9-]{2,40}$/.test(sub)) return null;
  return sub;
}

export function buildPortalHost(citySlug: string): string {
  return `${citySlug.toLowerCase()}.${PRIMARY_DOMAIN}`;
}

export function isPortal24hHost(host: string | null | undefined): boolean {
  const h = normalizeHost(host);
  if (!h) return false;
  return h === PRIMARY_DOMAIN || h === `www.${PRIMARY_DOMAIN}` || h.endsWith(`.${PRIMARY_DOMAIN}`);
}

export const VERCEL_WILDCARD_NOTE = `Vercel: adicione dominio ${WILDCARD_PATTERN} em Project > Settings > Domains (requer DNS wildcard *.${PRIMARY_DOMAIN} apontando para cname.vercel-dns.com). Nao publique sem autorizacao.`;
