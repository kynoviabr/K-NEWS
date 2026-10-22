export type AdCampaignStatus = "draft" | "active" | "paused" | "ended" | "blocked";

export type AdPlacement = {
  campaignId: string;
  slotCode: string;
  priority: number; // 0-1000
};

export type AdCampaign = {
  id: string;
  status: AdCampaignStatus;
  startsAt?: string | null;
  endsAt?: string | null;
  portalId?: string | null;
  placements: AdPlacement[];
  geoTargets?: string[]; // city slugs or portal slugs
  impressionsCap?: number | null;
  impressionsServed?: number;
  budgetCents?: number | null;
  budgetSpentCents?: number;
  frequencyCapPerUser?: number | null;
};

export type DeliveryContext = {
  now: Date;
  portalId: string | null;
  portalSlug: string | null;
  citySlug: string | null;
  slotCode: string;
  userViewCounts?: Map<string, number>; // campaignId -> views by user
  rotationIndex?: number;
};

export type EligibilityResult = {
  eligible: boolean;
  reason?: string;
};

export function isWithinContractWindow(campaign: AdCampaign, now: Date): boolean {
  if (campaign.startsAt && new Date(campaign.startsAt) > now) return false;
  if (campaign.endsAt && new Date(campaign.endsAt) <= now) return false;
  return true;
}

export function isWithinBudget(campaign: AdCampaign): boolean {
  if (campaign.budgetCents == null) return true;
  const spent = campaign.budgetSpentCents ?? 0;
  return spent < campaign.budgetCents;
}

export function isWithinImpressionCap(campaign: AdCampaign): boolean {
  if (campaign.impressionsCap == null) return true;
  const served = campaign.impressionsServed ?? 0;
  return served < campaign.impressionsCap;
}

export function matchesGeo(campaign: AdCampaign, ctx: DeliveryContext): boolean {
  if (!campaign.geoTargets || campaign.geoTargets.length === 0) return true;
  const candidates = [ctx.portalSlug, ctx.citySlug].filter(Boolean) as string[];
  return campaign.geoTargets.some((t) => candidates.includes(t));
}

export function matchesPlacement(campaign: AdCampaign, slotCode: string): boolean {
  if (campaign.placements.length === 0) return false;
  return campaign.placements.some((p) => p.slotCode === slotCode);
}

export function isFrequencyCapped(campaign: AdCampaign, ctx: DeliveryContext): boolean {
  if (campaign.frequencyCapPerUser == null) return false;
  if (!ctx.userViewCounts) return false;
  const views = ctx.userViewCounts.get(campaign.id) ?? 0;
  return views >= campaign.frequencyCapPerUser;
}

export function checkCampaignEligibility(campaign: AdCampaign, ctx: DeliveryContext): EligibilityResult {
  if (campaign.status !== "active") return { eligible: false, reason: `status=${campaign.status}` };
  if (!isWithinContractWindow(campaign, ctx.now)) return { eligible: false, reason: "fora da janela contratada" };
  if (!matchesPlacement(campaign, ctx.slotCode)) return { eligible: false, reason: `slot ${ctx.slotCode} nao contratado` };
  if (!matchesGeo(campaign, ctx)) return { eligible: false, reason: "geografia nao corresponde" };
  if (!isWithinImpressionCap(campaign)) return { eligible: false, reason: "cap de impressoes atingido" };
  if (!isWithinBudget(campaign)) return { eligible: false, reason: "orcamento esgotado" };
  if (isFrequencyCapped(campaign, ctx)) return { eligible: false, reason: "frequency cap atingido para usuario" };
  return { eligible: true };
}

export function shouldAutoEnd(campaign: AdCampaign, now: Date): boolean {
  if (campaign.status !== "active") return false;
  if (campaign.endsAt && new Date(campaign.endsAt) <= now) return true;
  if (campaign.impressionsCap != null && (campaign.impressionsServed ?? 0) >= campaign.impressionsCap) return true;
  if (campaign.budgetCents != null && (campaign.budgetSpentCents ?? 0) >= campaign.budgetCents) return true;
  return false;
}

export function selectByRotation(candidates: AdCampaign[], rotationIndex: number): AdCampaign | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const pa = a.placements.find((p) => p.priority)?.priority ?? 0;
    const pb = b.placements.find((p) => p.priority)?.priority ?? 0;
    if (pb !== pa) return pb - pa;
    return a.id.localeCompare(b.id);
  });
  // Stable rotation: priority desc, then round-robin within same priority tier
  const topPriority = sorted[0]?.placements.find((p) => p.priority)?.priority ?? 0;
  const topTier = sorted.filter((c) => (c.placements.find((p) => p.priority)?.priority ?? 0) === topPriority);
  const tier = topTier.length > 1 ? topTier : sorted;
  return tier[rotationIndex % tier.length] ?? null;
}

export function eligibleCampaigns(campaigns: AdCampaign[], ctx: DeliveryContext): AdCampaign[] {
  return campaigns.filter((c) => checkCampaignEligibility(c, ctx).eligible);
}

// Legacy wrappers
export function isCampaignActive(campaign: { id: string; status: string; startsAt?: string | null; endsAt?: string | null }, now: Date = new Date()): boolean {
  return checkCampaignEligibility(
    { id: campaign.id, status: campaign.status as AdCampaignStatus, startsAt: campaign.startsAt, endsAt: campaign.endsAt, placements: [{ campaignId: campaign.id, slotCode: "__any__", priority: 0 }] },
    { now, portalId: null, portalSlug: null, citySlug: null, slotCode: "__any__" }
  ).eligible;
}

export function validateCampaignDates(startsAt?: string | null, endsAt?: string | null): string | null {
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    return "Data de termino deve ser posterior ao inicio.";
  }
  return null;
}
