import type { AdCampaign, DeliveryContext } from "./ad-eligibility";
import { checkCampaignEligibility, selectByRotation, shouldAutoEnd } from "./ad-eligibility";

export type InventoryReservation = {
  campaignId: string;
  slotCode: string;
  reservedAt: string;
  expiresAt: string;
};

const RESERVATION_TTL_MS = 5 * 60 * 1000;

export function reserveInventoryAtomically(campaign: AdCampaign, ctx: DeliveryContext): { reserved: boolean; reason?: string; reservation?: InventoryReservation } {
  const eligibility = checkCampaignEligibility(campaign, ctx);
  if (!eligibility.eligible) return { reserved: false, reason: eligibility.reason };
  if (shouldAutoEnd(campaign, ctx.now)) return { reserved: false, reason: "campanha encerrada" };

  const now = ctx.now;
  return {
    reserved: true,
    reservation: {
      campaignId: campaign.id,
      slotCode: ctx.slotCode,
      reservedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS).toISOString(),
    },
  };
}

export function decideAd(campaigns: AdCampaign[], ctx: DeliveryContext): { winner: AdCampaign | null; reason: string } {
  const eligible = campaigns.filter((c) => checkCampaignEligibility(c, ctx).eligible && !shouldAutoEnd(c, ctx.now));
  if (eligible.length === 0) return { winner: null, reason: "nenhuma campanha elegivel" };
  const winner = selectByRotation(eligible, ctx.rotationIndex ?? 0);
  return { winner, reason: winner ? "ok" : "sem vencedor na rotacao" };
}
