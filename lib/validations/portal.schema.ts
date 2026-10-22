import { z } from "zod";

export const createPortalSchema = z.object({
  name: z.string().trim().min(2, "Nome deve ter pelo menos 2 caracteres.").max(120),
  slug: z.string().trim().max(120).optional().or(z.literal("")),
  city_id: z.string().uuid("Cidade inválida."),
  status: z.enum(["active", "inactive", "archived"]).default("active"),
});

export const createRegionSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().max(120).optional().or(z.literal("")),
});

export type CreatePortalInput = z.infer<typeof createPortalSchema>;
export type CreateRegionInput = z.infer<typeof createRegionSchema>;
