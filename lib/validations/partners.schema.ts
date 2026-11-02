import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

export const partnerSchema = z.object({
  name: z.string().trim().min(2, "Nome do parceiro muito curto.").max(120),
  document: optionalText(30).refine((v) => v === null || /^[0-9./-]{11,18}$/.test(v), "CPF ou CNPJ inválido."),
  contact_name: optionalText(120),
  contact_email: optionalText(160).refine((v) => v === null || z.email().safeParse(v).success, "E-mail de contato inválido."),
  contact_phone: optionalText(30),
});

export const territorySchema = z.object({
  partner_id: z.uuid(),
  scope: z.string().regex(/^(city|region):[0-9a-f-]{36}$/, "Escolha a cidade ou a região."),
  commission_pct: z.coerce.number({ message: "Comissão inválida." }).min(0, "Comissão entre 0 e 100%.").max(100, "Comissão entre 0 e 100%."),
});

export const partnerUserSchema = z.object({
  partner_id: z.uuid(),
  email: z.email({ message: "E-mail inválido." }),
});

export const commissionPaymentSchema = z.object({
  id: z.uuid(),
  payment_reference: z.string().trim().min(3, "Informe o comprovante (PIX, TED, NF).").max(120),
});
