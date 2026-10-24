import { z } from "zod";
import { isSafeRedirectUrl, parseMoneyToCents } from "@/lib/ads/visitor";

// Validacao dos formularios do Revenue Center. O banco repete as regras criticas
// (constraints, RLS e guarda de ativacao); aqui elas viram mensagens legiveis.

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const money = (label: string, required = false) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      const cents = parseMoneyToCents(v);
      if (cents === null) {
        if (required) ctx.addIssue({ code: "custom", message: `${label}: obrigatorio` });
        return null;
      }
      if (Number.isNaN(cents)) {
        ctx.addIssue({ code: "custom", message: `${label}: valor invalido` });
        return null;
      }
      return cents;
    });

const optionalInt = (label: string, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v || v.trim() === "") return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `${label}: inteiro entre ${min} e ${max}` });
        return null;
      }
      return n;
    });

const httpsUrl = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => isSafeRedirectUrl(v), `${label}: use uma URL https valida, sem usuario/senha`);

const optionalHttpsUrl = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || isSafeRedirectUrl(v), `${label}: use uma URL https valida, sem usuario/senha`);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data invalida");

// <input type="datetime-local"> nao tem fuso: o painel opera no horario de Brasilia.
export function saoPauloLocalToIso(v: string | null | undefined): string | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  return new Date(`${v}:00-03:00`).toISOString();
}

export function isoToSaoPauloLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000);
  return d.toISOString().slice(0, 16);
}

export const advertiserSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto").max(120),
  document: optionalText(30),
  contact_name: optionalText(120),
  contact_email: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.email().safeParse(v).success, "E-mail invalido"),
  contact_phone: optionalText(30),
  notes: optionalText(1000),
});

export const contractSchema = z
  .object({
    advertiser_id: z.uuid("Escolha o anunciante"),
    reference: z.string().trim().min(2, "Referencia muito curta").max(60),
    starts_on: isoDate,
    ends_on: isoDate,
    total_value_cents: money("Valor total", true),
    commission_pct: z.coerce.number().min(0).max(100).default(0),
    status: z.enum(["draft", "signed"]),
    notes: optionalText(1000),
  })
  .refine((d) => d.ends_on >= d.starts_on, { message: "Fim do contrato antes do inicio", path: ["ends_on"] });

const DEVICES = ["desktop", "mobile", "tablet"] as const;

export const campaignSchema = z
  .object({
    advertiser_id: z.uuid("Escolha o anunciante"),
    contract_id: z
      .string()
      .optional()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || z.uuid().safeParse(v).success, "Contrato invalido"),
    kind: z.enum(["direct", "house"]),
    name: z.string().trim().min(3, "Nome muito curto").max(120),
    starts_at: z.string().optional().transform((v) => saoPauloLocalToIso(v)),
    ends_at: z
      .string()
      .min(1, "Informe o termino")
      .transform((v) => saoPauloLocalToIso(v))
      .refine((v) => v !== null, "Termino invalido"),
    impressions_cap: optionalInt("Cap de impressoes", 1, 1_000_000_000),
    daily_impressions_cap: optionalInt("Cap diario", 1, 100_000_000),
    frequency_cap_per_user: optionalInt("Frequencia por visitante", 1, 1000),
    priority: z.coerce.number().int().min(0).max(1000).default(100),
    pacing: z.enum(["asap", "even"]).default("asap"),
    pricing_model: z.enum(["flat", "cpm", "cpc"]).default("flat"),
    rate_cents: money("Valor unitario").transform((v) => v ?? 0),
    budget_cents: money("Orcamento"),
    disclosure_label: z.string().trim().min(3).max(40).default("Publicidade"),
    device_targets: z.array(z.enum(DEVICES)).default([]),
    category_targets: z
      .string()
      .optional()
      .transform((v) =>
        (v ?? "")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      )
      .refine((arr) => arr.every((s) => /^[a-z0-9-]{2,40}$/.test(s)), "Editorias: use slugs separados por virgula (ex.: saude, esportes)"),
  })
  .refine((d) => d.kind === "house" || d.contract_id !== null, { message: "Campanha paga precisa de contrato", path: ["contract_id"] })
  .refine((d) => !d.starts_at || !d.ends_at || new Date(d.ends_at) > new Date(d.starts_at), { message: "Termino deve ser depois do inicio", path: ["ends_at"] })
  .refine((d) => d.pricing_model === "flat" || d.rate_cents > 0, { message: "CPM/CPC exige valor unitario", path: ["rate_cents"] })
  .refine((d) => d.device_targets.length < DEVICES.length, { message: "Marcar todos os dispositivos equivale a nao segmentar", path: ["device_targets"] });

export const CREATIVE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const CREATIVE_MAX_BYTES = 2 * 1024 * 1024;

export const imageCreativeSchema = z.object({
  alt_text: z.string().trim().min(3, "Descreva a imagem (texto alternativo)").max(200),
  click_url: optionalHttpsUrl("Destino"),
  weight: z.coerce.number().int().min(1).max(100).default(1),
});

export const textCreativeSchema = z.object({
  headline: z.string().trim().min(3, "Titulo muito curto").max(90),
  body_text: optionalText(200),
  click_url: optionalHttpsUrl("Destino"),
  weight: z.coerce.number().int().min(1).max(100).default(1),
});

export function validateCreativeFile(file: File | null): string | null {
  if (!file || file.size === 0) return "Escolha um arquivo de imagem";
  if (!(CREATIVE_TYPES as readonly string[]).includes(file.type)) return "Formato aceito: PNG, JPEG, WebP ou GIF";
  if (file.size > CREATIVE_MAX_BYTES) return "Arquivo acima de 2 MB";
  return null;
}

export const linkSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{2,59}$/, "Codigo: 3 a 60 letras minusculas, numeros ou hifens"),
  title: z.string().trim().min(3).max(120),
  kind: z.enum(["affiliate", "own_product", "partner"]),
  destination_url: httpsUrl("Destino"),
  disclosure: z.string().trim().min(10, "Texto de divulgacao muito curto").max(200),
});

export const revenueSchema = z
  .object({
    source: z.enum(["direct", "adsense", "mgid", "affiliate", "own_product", "other"]),
    contract_id: z
      .string()
      .optional()
      .transform((v) => (v ? v : null)),
    period_start: isoDate,
    period_end: isoDate,
    amount_cents: money("Valor", true),
    status: z.enum(["estimated", "confirmed", "paid"]),
    reference: optionalText(120),
    notes: optionalText(1000),
  })
  .refine((d) => d.period_end >= d.period_start, { message: "Fim do periodo antes do inicio", path: ["period_end"] })
  .refine((d) => d.source !== "direct" || d.contract_id !== null, { message: "Receita direta precisa de contrato", path: ["contract_id"] });

export function issuesMessage(error: z.ZodError): string {
  return error.issues.map((i) => i.message).join("; ");
}
