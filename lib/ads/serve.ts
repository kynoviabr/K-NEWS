import "server-only";
import { cookies, headers } from "next/headers";
import { getKnewsServiceClient } from "@/lib/supabase/knews";
import { logger } from "@/lib/logger";
import { CONSENT_COOKIE, VISITOR_COOKIE, detectDevice, hasAdsConsent, hashVisitor } from "@/lib/ads/visitor";

export type AdDecision =
  | { kind: "none"; reason?: string }
  | {
      kind: "campaign";
      token: string;
      label: string;
      campaignKind: "direct" | "house";
      width: number | null;
      height: number | null;
      creative: { format: "image" | "text"; imageUrl: string | null; altText: string | null; headline: string | null; bodyText: string | null; hasClick: boolean };
    }
  | { kind: "provider"; provider: "adsense" | "mgid"; publisherId: string; providerSlotId: string | null; width: number | null; height: number | null; consent: boolean };

type RawDecision = {
  kind: string;
  reason?: string;
  token?: string;
  label?: string;
  campaign_kind?: "direct" | "house";
  width?: number | null;
  height?: number | null;
  creative?: { format: "image" | "text"; storage_path: string | null; alt_text: string | null; headline: string | null; body_text: string | null; has_click: boolean };
  provider?: "adsense" | "mgid";
  publisher_id?: string;
  provider_slot_id?: string | null;
};

export function visitorSalt(): string {
  return process.env.KNEWS_VISITOR_SALT || process.env.CRON_SECRET || "knews-local-salt";
}

// Contexto do visitante a partir da requisicao: dispositivo e, com consentimento, o hash do id.
export async function requestAdContext(): Promise<{ device: string; visitorHash: string | null; consent: boolean }> {
  const h = await headers();
  const c = await cookies();
  const consent = hasAdsConsent(c.get(CONSENT_COOKIE)?.value);
  return {
    device: detectDevice(h.get("user-agent")),
    visitorHash: consent ? hashVisitor(c.get(VISITOR_COOKIE)?.value, visitorSalt()) : null,
    consent,
  };
}

// Decide o anuncio de um slot no servidor (renderizacao da pagina). A campanha nunca
// e gravada no HTML do artigo: cada requisicao consulta o banco de novo.
export async function decideAd(portalId: string, slotCode: string, target: { category?: string | null; neighborhood?: string | null } = {}): Promise<AdDecision> {
  let db;
  try {
    db = getKnewsServiceClient();
  } catch {
    return { kind: "none", reason: "supabase nao configurado" };
  }
  const ctx = await requestAdContext();
  const { data, error } = await db.schema("knews").rpc("serve_ad", {
    p_portal_id: portalId,
    p_slot_code: slotCode,
    p_context: { device: ctx.device, category: target.category ?? null, neighborhood: target.neighborhood ?? null, visitor_hash: ctx.visitorHash },
  });
  if (error) {
    logger.error("knews-ads", "serve_ad falhou", { slotCode, error: error.message });
    return { kind: "none", reason: "erro" };
  }
  const d = data as RawDecision;
  if (d.kind === "provider" && d.provider && d.publisher_id) {
    return { kind: "provider", provider: d.provider, publisherId: d.publisher_id, providerSlotId: d.provider_slot_id ?? null, width: d.width ?? null, height: d.height ?? null, consent: ctx.consent };
  }
  if (d.kind !== "campaign" || !d.token || !d.creative) return { kind: "none", reason: d.reason };

  let imageUrl: string | null = null;
  if (d.creative.format === "image" && d.creative.storage_path) {
    const signed = await db.storage.from("knews-creative").createSignedUrl(d.creative.storage_path, 3600);
    if (signed.error) {
      logger.error("knews-ads", "url assinada do criativo falhou", { error: signed.error.message });
      return { kind: "none", reason: "criativo indisponivel" };
    }
    imageUrl = signed.data.signedUrl;
  }
  return {
    kind: "campaign",
    token: d.token,
    label: d.label ?? "Publicidade",
    campaignKind: d.campaign_kind ?? "direct",
    width: d.width ?? null,
    height: d.height ?? null,
    creative: {
      format: d.creative.format,
      imageUrl,
      altText: d.creative.alt_text,
      headline: d.creative.headline,
      bodyText: d.creative.body_text,
      hasClick: d.creative.has_click,
    },
  };
}
