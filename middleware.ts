import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { extractCitySlugFromHost } from "@/lib/domains";
import { PORTAL_SURFACE_HEADER, isIndexablePath, isPanelHost, isRootPath } from "@/lib/hosts";

const NOINDEX = "noindex, nofollow";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const host = request.headers.get("host") ?? "";
  if (!isPanelHost(host)) return portalHostResponse(request, host);

  // Painel: fora dos buscadores, exceto a previa do portal e os arquivos publicos.
  const indexable = isIndexablePath(pathname, false);
  const noindex = (r: NextResponse) => {
    if (!indexable) r.headers.set("X-Robots-Tag", NOINDEX);
    return r;
  };
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PORTAL_SURFACE_HEADER, "panel");
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const citySlug = extractCitySlugFromHost(host);

  // Expose cidade resolvida por header para Server Components
  if (citySlug) {
    response.headers.set("x-knews-city", citySlug);
    response.headers.set("x-knews-host", host);
  }

  const isAuthCallback = pathname === "/auth/callback";
  const isHealth = pathname === "/api/health";

  if (isAuthCallback || isHealth) return noindex(response);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return noindex(response);
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
        // Re-apply city headers after recreating response
        if (citySlug) {
          response.headers.set("x-knews-city", citySlug);
          response.headers.set("x-knews-host", host);
        }
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  await supabase.auth.getUser();

  return noindex(response);
}

// Host de cidade: o portal responde na raiz. /portal/... redireciona para a URL
// canonica; painel, login e Server Actions do painel nao existem neste host (as
// rotas caem em /portal/<caminho>, que responde 404). Sem sessao do Supabase aqui.
function portalHostResponse(request: NextRequest, host: string): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/portal" || pathname.startsWith("/portal/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice("/portal".length) || "/";
    return NextResponse.redirect(url, 308);
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PORTAL_SURFACE_HEADER, "portal");
  const citySlug = extractCitySlugFromHost(host);
  if (citySlug) requestHeaders.set("x-knews-city", citySlug);
  if (isRootPath(pathname)) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    if (!isIndexablePath(pathname, true)) response.headers.set("X-Robots-Tag", NOINDEX);
    return response;
  }
  const url = request.nextUrl.clone();
  url.pathname = pathname === "/" ? "/portal" : `/portal${pathname}`;
  url.search = search;
  return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
