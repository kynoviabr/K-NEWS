import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { extractCitySlugFromHost } from "@/lib/domains";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });
  const pathname = request.nextUrl.pathname;
  const host = request.headers.get("host") ?? "";
  const citySlug = extractCitySlugFromHost(host);

  // Expose cidade resolvida por header para Server Components
  if (citySlug) {
    response.headers.set("x-knews-city", citySlug);
    response.headers.set("x-knews-host", host);
  }

  const isAuthCallback = pathname === "/auth/callback";
  const isHealth = pathname === "/api/health";

  if (isAuthCallback || isHealth) return response;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
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

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
