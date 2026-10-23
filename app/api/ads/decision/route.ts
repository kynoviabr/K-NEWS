import { NextResponse } from "next/server";
import { decideAd } from "@/lib/ad-inventory";
import type { AdCampaign } from "@/lib/ad-eligibility";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const campaigns: AdCampaign[] = body.campaigns ?? [];
    const ctx = {
      now: body.now ? new Date(body.now) : new Date(),
      portalId: body.portalId ?? null,
      portalSlug: body.portalSlug ?? null,
      citySlug: body.citySlug ?? null,
      slotCode: body.slotCode ?? "",
      rotationIndex: body.rotationIndex ?? 0,
    };
    if (!ctx.slotCode) {
      return NextResponse.json({ error: "slotCode obrigatorio" }, { status: 400 });
    }
    const { winner, reason } = decideAd(campaigns, ctx);
    return NextResponse.json({ winner, reason, slotCode: ctx.slotCode });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
