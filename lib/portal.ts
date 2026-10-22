export type PortalContext = {
  portalId: string | null;
  portalSlug: string | null;
};

export function resolvePortalFromHost(host: string | null, domains: Record<string, string>): PortalContext {
  if (!host) return { portalId: null, portalSlug: null };
  const normalized = host.toLowerCase().split(":")[0] ?? "";
  const portalId = domains[normalized] ?? null;
  return { portalId, portalSlug: portalId ? normalized : null };
}

export function canonicalUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://knews.example.com").replace(/\/$/, "");
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${base}${clean}`;
}
