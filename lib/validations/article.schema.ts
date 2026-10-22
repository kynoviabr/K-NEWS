import { z } from "zod";

export const createArticleSchema = z.object({
  portal_id: z.string().uuid("Portal inválido."),
  title: z.string().trim().min(5, "Título muito curto.").max(300, "Título muito longo."),
  slug: z.string().trim().max(350).optional().or(z.literal("")),
  excerpt: z.string().trim().max(500).optional().nullable(),
  body: z.string().trim().min(10, "Conteúdo muito curto."),
  status: z.enum(["draft", "reviewing", "ready", "scheduled", "published", "blocked", "archived"]).default("draft"),
  risk_level: z.enum(["low", "medium", "high", "blocked"]).default("low"),
});

export const updateArticleSchema = createArticleSchema.partial().extend({
  id: z.string().uuid(),
});

export type CreateArticleInput = z.infer<typeof createArticleSchema>;
export type UpdateArticleInput = z.infer<typeof updateArticleSchema>;
