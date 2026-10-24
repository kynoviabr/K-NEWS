import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getKnewsServiceClient } from "@/lib/supabase/knews";
import { resolveRequestPortal } from "@/lib/portal-data";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { CONSENT_COOKIE, VISITOR_COOKIE, hasAdsConsent, hashVisitor, isSafeRedirectUrl } from "@/lib/ads/visitor";
import { visitorSalt } from "@/lib/ads/serve";

export const dynamic = "force-dynamic";

const NO_INDEX = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" };

// Links afiliados e de produtos proprios: destino editavel no painel, clique contado.
// Clique nao e venda: a receita entra separadamente, pelo relatorio do parceiro.
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const home = new URL("/portal", request.url);
  if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(code)) return NextResponse.redirect(home, { status: 302, headers: NO_INDEX });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(`ads-link:${ip}`, 60, 60_000).allowed) return new NextResponse("Muitas requisições", { status: 429 });

  const portal = await resolveRequestPortal();
  if (!portal) return NextResponse.redirect(home, { status: 302, headers: NO_INDEX });
  const c = await cookies();
  const visitor = hasAdsConsent(c.get(CONSENT_COOKIE)?.value) ? hashVisitor(c.get(VISITOR_COOKIE)?.value, visitorSalt()) : null;
  let referrerPath: string | null = null;
  try {
    const ref = request.headers.get("referer");
    if (ref) referrerPath = new URL(ref).pathname;
  } catch {
    referrerPath = null;
  }
  const { data, error } = await getKnewsServiceClient()
    .schema("knews")
    .rpc("record_link_click", { p_portal_id: portal.id, p_code: code, p_visitor_hash: visitor, p_referrer_path: referrerPath });
  const url = (data as { url: string | null } | null)?.url ?? null;
  if (error || !isSafeRedirectUrl(url)) return NextResponse.redirect(home, { status: 302, headers: NO_INDEX });
  return NextResponse.redirect(url!, { status: 302, headers: NO_INDEX });
}
