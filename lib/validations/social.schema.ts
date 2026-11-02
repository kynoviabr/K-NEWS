import { z } from "zod";
import { saoPauloLocalToIso } from "@/lib/validations/ads.schema";

export const SOCIAL_PROVIDERS = ["facebook", "instagram"] as const;

export const socialAccountSchema = z.object({
  provider: z.enum(SOCIAL_PROVIDERS, { message: "Escolha Facebook ou Instagram." }),
  external_account_id: z.string().trim().regex(/^[0-9]{5,30}$/, "ID da página ou da conta do Instagram: só números."),
  display_name: z.string().trim().max(120).optional(),
  access_token: z.string().trim().min(20, "Token de acesso inválido.").max(1000).regex(/^\S+$/, "Token não pode ter espaços."),
  expires_on: z
    .string()
    .optional()
    .transform((v) => (v ? new Date(`${v}T23:59:00-03:00`).toISOString() : null)),
  daily_post_limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const socialPostSchema = z
  .object({
    article_id: z.uuid({ message: "Escolha a matéria." }),
    providers: z.array(z.enum(SOCIAL_PROVIDERS)).min(1, "Escolha ao menos uma rede."),
    message: z.string().trim().min(1, "Escreva o texto do post.").max(2000, "Texto acima de 2.000 caracteres."),
    image_url: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || null)
      .refine((v) => v === null || /^https:\/\/\S+$/.test(v), "A imagem precisa de um endereço https."),
    image_rights_confirmed: z.boolean(),
    scheduled_at: z
      .string()
      .optional()
      .transform((v) => (v ? saoPauloLocalToIso(v) : new Date().toISOString())),
  })
  .refine((v) => v.scheduled_at !== null, { message: "Data e hora inválidas.", path: ["scheduled_at"] })
  .refine((v) => !v.providers.includes("instagram") || (v.image_url && v.image_rights_confirmed), {
    message: "O Instagram exige imagem com direito de uso confirmado.",
    path: ["image_url"],
  })
  .refine((v) => !v.image_url || v.image_rights_confirmed, { message: "Confirme o direito de uso da imagem.", path: ["image_rights_confirmed"] });
