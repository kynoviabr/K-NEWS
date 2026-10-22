export type CampaignStatus = "draft" | "active" | "paused" | "ended" | "blocked";

export type Campaign = {
  id: string;
  status: CampaignStatus;
  startsAt?: string | null;
  endsAt?: string | null;
  portalId?: string | null;
};

export function isCampaignActive(campaign: Campaign, now: Date = new Date()): boolean {
  if (campaign.status !== "active") return false;
  if (campaign.startsAt && new Date(campaign.startsAt) > now) return false;
  if (campaign.endsAt && new Date(campaign.endsAt) <= now) return false;
  return true;
}

export function validateCampaignDates(startsAt?: string | null, endsAt?: string | null): string | null {
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    return "Data de termino deve ser posterior ao inicio.";
  }
  return null;
}
