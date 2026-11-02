import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { decideAd } from "@/lib/ad-inventory";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const slotCode: string = body.slotCode ?? "";
    if (!slotCode) return NextResponse.json({ error: "slotCode obrigatorio" }, { status: 400 });

    const supabase = await getSupabaseServerClient();
    const citySlug: string | null = body.citySlug ?? null;
    const portalSlug: string | null = body.portalSlug ?? null;

    let portalId: string | null = body.portalId ?? null;
    if (!portalId && citySlug) {
      const { data: city } = await (supabase.from("cities" as never) as any).select("id").eq("slug", citySlug).maybeSingle();
      if (city) {
        const { data: portal } = await (supabase.from("portals" as never) as any).select("id").eq("city_id", city.id).maybeSingle();
        if (portal) portalId = portal.id;
      }
    }

    const { data: campaigns, error } = await (supabase.from("ad_campaigns" as never) as any)
      .select("*, ad_campaign_placements(slot_code,priority), ad_campaign_geo_targets(city_slug,portal_slug)")
      .eq("status", "active");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const mapped = (campaigns ?? []).map((c: any) => ({
      id: c.id,
      status: c.status,
      startsAt: c.starts_at,
      endsAt: c.ends_at,
      portalId: c.portal_id,
      impressionsCap: c.impressions_cap,
      impressionsServed: c.impressions_served,
      budgetCents: c.budget_cents,
      budgetSpentCents: c.budget_spent_cents,
      frequencyCapPerUser: c.frequency_cap_per_user,
      placements: (c.ad_campaign_placements ?? []).map((p: any) => ({ campaignId: c.id, slotCode: p.slot_code, priority: p.priority })),
      geoTargets: (c.ad_campaign_geo_targets ?? []).map((g: any) => g.city_slug ?? g.portal_slug).filter(Boolean),
    }));

    const ctx = { now: new Date(), portalId, portalSlug, citySlug, slotCode, rotationIndex: body.rotationIndex ?? 0 };
    const { winner, reason } = decideAd(mapped, ctx);
    const headers: Record<string, string> = {};
    if (citySlug) headers["Vary"] = "X-Knews-City, Host";
    if (citySlug) headers["Cache-Control"] = "private, max-age=30";
    return NextResponse.json({ winner: winner ? { id: winner.id } : null, reason, slotCode, citySlug }, { headers });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
