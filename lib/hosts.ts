import { normalizeHost } from "./domains";

// Painel x portal pelo hostname. Hosts do painel vem de KNEWS_PANEL_HOSTS (lista
// separada por virgula, ex.: painel.portal24h.news); localhost e previews da Vercel
// sao sempre painel. Qualquer outro host e portal de cidade, servido na raiz.
const ALWAYS_PANEL = new Set(["localhost", "127.0.0.1"]);

export function panelHosts(): Set<string> {
  const extra = (process.env.KNEWS_PANEL_HOSTS ?? "")
    .split(",")
    .map((h) => normalizeHost(h))
    .filter((h): h is string => Boolean(h));
  return new Set([...ALWAYS_PANEL, ...extra]);
}

export function isPanelHost(host: string | null | undefined): boolean {
  const h = normalizeHost(host);
  if (!h) return true;
  return panelHosts().has(h) || h.endsWith(".vercel.app");
}

// No host do portal as rotas publicas ficam na raiz; no painel, sob /portal (previa local).
export const PORTAL_SURFACE_HEADER = "x-knews-surface";

export function portalBasePath(host: string | null | undefined): "" | "/portal" {
  return isPanelHost(host) ? "/portal" : "";
}

// Caminhos que existem na raiz de qualquer host e nao vao para /portal.
const ROOT_PATHS = [/^\/api\//, /^\/r\//, /^\/_next\//, /^\/(sitemap\.xml|robots\.txt|ads\.txt|favicon\.ico|opengraph-image)(\/|$)/];

export function isRootPath(pathname: string): boolean {
  return ROOT_PATHS.some((re) => re.test(pathname));
}

// Indexavel em qualquer host: portal e arquivos publicos. APIs, redirecionamentos e painel nao.
const INDEXABLE_FILES = /^\/(sitemap\.xml|robots\.txt|ads\.txt|opengraph-image)(\/|$)/;

export function isIndexablePath(pathname: string, portalHost: boolean): boolean {
  if (INDEXABLE_FILES.test(pathname)) return true;
  if (/^\/(api|r)\//.test(pathname)) return false;
  return portalHost || pathname === "/portal" || pathname.startsWith("/portal/");
}
