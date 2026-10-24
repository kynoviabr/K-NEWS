import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getKnewsServiceClient } from "@/lib/supabase/knews";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { CONSENT_COOKIE, RESERVATION_TOKEN, VISITOR_COOKIE, hasAdsConsent, hashVisitor } from "@/lib/ads/visitor";
import { visitorSalt } from "@/lib/ads/serve";

export const dynamic = "force-dynamic";

// Beacon de visibilidade. O token e a unica referencia: nao revela campanha nem destino.
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(`ads-impression:${ip}`, 120, 60_000).allowed) return new NextResponse(null, { status: 429 });
  let token: unknown;
  try {
    token = ((await request.json()) as { token?: unknown }).token;
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (typeof token !== "string" || !RESERVATION_TOKEN.test(token)) return new NextResponse(null, { status: 400 });

  const c = await cookies();
  const visitor = hasAdsConsent(c.get(CONSENT_COOKIE)?.value) ? hashVisitor(c.get(VISITOR_COOKIE)?.value, visitorSalt()) : null;
  const { error } = await getKnewsServiceClient().schema("knews").rpc("record_ad_impression", { p_token: token, p_visitor_hash: visitor });
  if (error) return new NextResponse(null, { status: 500 });
  return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
}
