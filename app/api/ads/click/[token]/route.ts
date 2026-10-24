import { NextResponse } from "next/server";
import { getKnewsServiceClient } from "@/lib/supabase/knews";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { RESERVATION_TOKEN, isSafeRedirectUrl } from "@/lib/ads/visitor";

export const dynamic = "force-dynamic";

const NO_INDEX = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" };

// Clique em anuncio: conta uma vez por exibicao e redireciona ao destino aprovado.
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const home = new URL("/portal", request.url);
  if (!RESERVATION_TOKEN.test(token)) return NextResponse.redirect(home, { status: 302, headers: NO_INDEX });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(`ads-click:${ip}`, 60, 60_000).allowed) return new NextResponse("Muitas requisições", { status: 429 });

  const { data, error } = await getKnewsServiceClient().schema("knews").rpc("record_ad_click", { p_token: token });
  const url = (data as { url: string | null } | null)?.url ?? null;
  if (error || !isSafeRedirectUrl(url)) return NextResponse.redirect(home, { status: 302, headers: NO_INDEX });
  return NextResponse.redirect(url!, { status: 302, headers: NO_INDEX });
}
