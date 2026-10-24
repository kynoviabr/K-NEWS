import { z } from "zod";

export const createAdvertiserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  document: z.string().trim().max(30).nullable().optional(),
});

export const createCampaignSchema = z.object({
  advertiser_id: z.string().uuid(),
  portal_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(3).max(120),
  status: z.enum(["draft", "active", "paused", "ended", "blocked"]).default("draft"),
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  impressions_cap: z.number().int().positive().nullable().optional(),
  budget_cents: z.number().int().positive().nullable().optional(),
  frequency_cap_per_user: z.number().int().positive().nullable().optional(),
  priority: z.number().int().min(0).max(1000).default(100),
  placements: z.array(z.object({ slot_code: z.string().min(1), priority: z.number().int().min(0).max(1000).default(100) })).default([]),
  geo_targets: z.array(z.object({ city_slug: z.string().nullable().optional(), portal_slug: z.string().nullable().optional() })).default([]),
}).refine((d) => !d.starts_at || !d.ends_at || new Date(d.ends_at) > new Date(d.starts_at), {
  message: "Data de termino deve ser posterior ao inicio.",
  path: ["ends_at"],
});

export const createCreativeSchema = z.object({
  campaign_id: z.string().uuid(),
  file_name: z.string().min(1).max(255),
  content_type: z.string().min(1).max(100),
  size_bytes: z.number().int().positive().max(10 * 1024 * 1024),
});

export const createSlotSchema = z.object({
  portal_id: z.string().uuid().nullable().optional(),
  code: z.string().trim().min(2).max(80),
  name: z.string().trim().min(2).max(120),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
});
