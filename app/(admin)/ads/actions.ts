"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canSell, getAdminContext, type AdminContext } from "@/lib/admin-context";
import { getKnewsSessionClient } from "@/lib/supabase/knews";
import {
  advertiserSchema,
  campaignSchema,
  contractSchema,
  imageCreativeSchema,
  issuesMessage,
  linkSchema,
  revenueSchema,
  textCreativeSchema,
  validateCreativeFile,
} from "@/lib/validations/ads.schema";

export type ActionState = { ok: boolean; message: string } | null;

// Todas as escritas usam a sessao do usuario: a RLS (can_sell_portal) e a guarda de
// ativacao no banco sao a autorizacao real; as checagens aqui so melhoram a mensagem.

async function salesContext(): Promise<{ ctx: AdminContext; portalId: string } | { error: string }> {
  const ctx = await getAdminContext();
  if (!ctx) return { error: "Entre novamente." };
  if (!ctx.active || !canSell(ctx.active)) return { error: "Sua função neste portal não inclui a área comercial." };
  return { ctx, portalId: ctx.active.portalId };
}

function dbMessage(message: string): string {
  if (/row-level security|permission denied/.test(message)) return "Sem permissão para esta operação neste portal.";
  if (/duplicate key/.test(message)) return "Já existe um registro com esse código ou referência.";
  if (/violates foreign key/.test(message)) return "Registro em uso por outro cadastro.";
  return message;
}

function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  return typeof v === "string" ? v : undefined;
}

// --- Anunciantes e contratos -------------------------------------------------

export async function createAdvertiser(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const sc = await salesContext();
  if ("error" in sc) return { ok: false, message: sc.error };
  const parsed = advertiserSchema.safeParse(Object.fromEntries(["name", "document", "contact_name", "contact_email", "contact_phone", "notes"].map((k) => [k, str(fd, k)])));
  if (!parsed.success) return { ok: false, message: issuesMessage(parsed.error) };
  const { knews } = await getKnewsSessionClient();
  const { error } = await knews.from("advertisers").insert({ ...parsed.data, portal_id: sc.portalId, created_by: sc.ctx.userId });
  if (error) return { ok: false, message: dbMessage(error.message) };
  revalidatePath("/anunciantes");
  return { ok: true, message: "Anunciante cadastrado." };
}

export async function createContract(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const sc = await salesContext();
  if ("error" in sc) return { ok: false, message: sc.error };
  const parsed = contractSchema.safeParse(
    Object.fromEntries(["advertiser_id", "reference", "starts_on", "ends_on", "total_value_cents", "commission_pct", "status", "notes"].map((k) => [k, str(fd, k)])),
  );
  if (!parsed.success) return { ok: false, message: issuesMessage(parsed.error) };
  const { knews } = await getKnewsSessionClient();
  const { error } = await knews.from("ad_contracts").insert({
    ...parsed.data,
    portal_id: sc.portalId,
    signed_at: parsed.data.status === "signed" ? new Date().toISOString() : null,
    created_by: sc.ctx.userId,
  });
  if (error) return { ok: false, message: dbMessage(error.message) };
  revalidatePath("/anunciantes");
  return { ok: true, message: "Contrato registrado." };
}

export async function setContractStatus(fd: FormData): Promise<void> {
  const status = str(fd, "status");
  if (!status || !["signed", "cancelled", "ended"].includes(status)) return;
  const { knews } = await getKnewsSessionClient();
  await knews
    .from("ad_contracts")
    .update({ status, ...(status === "signed" ? { signed_at: new Date().toISOString() } : {}) })
    .eq("id", str(fd, "id") ?? "");
  revalidatePath("/anunciantes");
}

// --- Campanhas -----------------------------------------------------------------

function campaignInput(fd: FormData) {
  return {
    ...Object.fromEntries(
      [
        "advertiser_id",
        "contract_id",
        "kind",
        "name",
        "starts_at",
        "ends_at",
        "impressions_cap",
        "daily_impressions_cap",
        "frequency_cap_per_user",
        "priority",
        "pacing",
        "pricing_model",
        "rate_cents",
        "budget_cents",
        "disclosure_label",
        "category_targets",
      ].map((k) => [k, str(fd, k)]),
    ),
    device_targets: fd.getAll("device_targets").map(String),
  };
}

export async function createCampaign(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const sc = await salesContext();
  if ("error" in sc) return { ok: false, message: sc.error };
  const parsed = campaignSchema.safeParse(campaignInput(fd));
  if (!parsed.success) return { ok: false, message: issuesMessage(parsed.error) };
  const { knews } = await getKnewsSessionClient();
  const { data, error } = await knews
    .from("ad_campaigns")
    .insert({ ...parsed.data, contract_id: parsed.data.kind === "house" ? null : parsed.data.contract_id, portal_id: sc.portalId, status: "draft", created_by: sc.ctx.userId })
    .select("id")
    .single();
  if (error) return { ok: false, message: dbMessage(error.message) };
  revalidatePath("/ads");
  redirect(`/ads/campanhas/${(data as { id: string }).id}`);
}

export async function updateCampaign(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const sc = await salesContext();
  if ("error" in sc) return { ok: false, message: sc.error };
  const id = str(fd, "id") ?? "";
  const parsed = campaignSchema.safeParse(campaignInput(fd));
  if (!parsed.success) return { ok: false, message: issuesMessage(parsed.error) };
  const { knews } = await getKnewsSessionClient();
  const { error, count } = await knews
    .from("ad_campaigns")
    .update({ ...parsed.data, contract_id: parsed.data.kind === "house" ? null : parsed.data.contract_id }, { count: "exact" })
    .eq("id", id);
  if (error) return { ok: false, message: dbMessage(error.message) };
  if (!count) return { ok: false, message: "Campanha não encontrada ou sem permissão." };
  revalidatePath(`/ads/campanhas/${id}`);
  return { ok: true, message: "Campanha atualizada." };
}

export async function setCampaignStatus(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const sc = await salesContext();
  if ("error" in sc) return { ok: false, message: sc.error };
  const id = str(fd, "id") ?? "";
  const status = str(fd, "status");
  if (!status || !["active", "paused", "ended", "draft"].includes(status)) return { ok: false, message: "Situação inválida." };
  const reason = (str(fd, "reason") ?? "").trim().slice(0, 300) || null;
  if ((status === "paused" || status === "ended") && !reason) return { ok: false, message: "Informe o motivo da pausa ou do encerramento." };
  const { knews } = await getKnewsSessionClient();
  const { error, count } = await knews.from("ad_campaigns").update({ status, status_reason: reason }, { count: "exact" }).eq("id", id);
  if (error) return { ok: false, message: dbMessage(error.message) };
  if (!count) return { ok: false, message: "Campanha não encontrada ou sem permissão." };
  revalidatePath(`/ads/campanhas/${id}`);
  revalidatePath("/ads");
  return { ok: true, message: { active: "Campanha ativada: entra no rodízio na próxima página servida.", paused: "Campanha pausada: sai do ar imediatamente.", ended: "Campanha encerrada.", draft: "Campanha voltou para rascunho." }[status]! };
}

export async function setPlacements(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const sc = await salesContext();
  if ("error" in sc) return { ok: false, message: sc.error };
  const id = str(fd, "id") ?? "";
  const wanted = new Set(fd.getAll("slots").map(String));
  const { knews } = await getKnewsSessionClient();
  const { data: current, error: readError } = await knews.from("ad_campaign_placements").select("slot_code").eq("campaign_id", id);
  if (readError) return { ok: false, message: dbMessage(readError.message) };
  const have = new Set((current ?? []).map((p: { slot_code: string }) => p.slot_code));
  const remove = [...have].filter((s) => !wanted.has(s));
  const add = [...wanted].filter((s) => !have.has(s));
  if (remove.length) {
    const { error } = await knews.from("ad_campaign_placements").delete().eq("campaign_id", id).in("slot_code", remove);
    if (error) return { ok: false, message: dbMessage(error.message) };
  }
  if (add.length) {
    const { error } = await knews.from("ad_campaign_placements").insert(add.map((slot_code) => ({ campaign_id: id, slot_code })));
    if (error) return { ok: false, message: dbMessage(error.message) };
  }
  revalidatePath(`/ads/campanhas/${id}`);
  return { ok: true, message: wanted.size ? "Posições salvas." : "Nenhuma posição: a campanha não será exibida." };
}

export async function setGeoTargets(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const sc = await salesContext();
  if ("error" in sc) return { ok: false, message: sc.error };
  const id = str(fd, "id") ?? "";
  const citySlug = str(fd, "city_slug") ?? "";
  const neighborhoods = fd.getAll("neighborhoods").map(String).filter((s) => /^[a-z0-9-]{2,60}$/.test(s));
  const { knews } = await getKnewsSessionClient();
  const { error: delError } = await knews.from("ad_campaign_geo_targets").delete().eq("campaign_id", id);
  if (delError) return { ok: false, message: dbMessage(delError.message) };
  if (neighborhoods.length) {
    const { error } = await knews
      .from("ad_campaign_geo_targets")
      .insert(neighborhoods.map((n) => ({ campaign_id: id, city_slug: citySlug || null, neighborhood_slug: n })));
    if (error) return { ok: false, message: dbMessage(error.message) };
  }
  revalidatePath(`/ads/campanhas/${id}`);
  return { ok: true, message: neighborhoods.length ? `Segmentada para ${neighborhoods.length} bairro(s).` : "Exibida em todo o portal." };
}

// --- Criativos -------------------------------------------------------------------

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export async function uploadImageCreative(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const sc = await salesContext();
  if ("error" in sc) return { ok: false, message: sc.error };
  const campaignId = str(fd, "campaign_id") ?? "";
  const file = fd.get("file");
  const fileError = validateCreativeFile(file instanceof File ? file : null);
  if (fileError) return { ok: false, message: fileError };
  const parsed = imageCreativeSchema.safeParse({ alt_text: str(fd, "alt_text"), click_url: str(fd, "click_url"), weight: str(fd, "weight") ?? "1" });
  if (!parsed.success) return { ok: false, message: issuesMessage(parsed.error) };
  const image = file as File;
  const width = Number(str(fd, "width")) || null;
  const height = Number(str(fd, "height")) || null;

  const { client, knews } = await getKnewsSessionClient();
  // Caminho <campaign_id>/<uuid>.<ext>: a politica do Storage confere can_edit_campaign.
  const path = `${campaignId}/${crypto.randomUUID()}.${EXT[image.type]}`;
  const up = await client.storage.from("knews-creative").upload(path, image, { contentType: image.type, upsert: false });
  if (up.error) return { ok: false, message: dbMessage(up.error.message) };
  const { error } = await knews.from("ad_creatives").insert({
    campaign_id: campaignId,
    format: "image",
    storage_path: path,
    file_name: image.name.slice(0, 255),
    content_type: image.type,
    size_bytes: image.size,
    width,
    height,
    ...parsed.data,
  });
  if (error) {
    await client.storage.from("knews-creative").remove([path]);
    return { ok: false, message: dbMessage(error.message) };
  }
  revalidatePath(`/ads/campanhas/${campaignId}`);
  return { ok: true, message: "Criativo enviado. Revise e aprove para entrar no ar." };
}

export async function createTextCreative(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const sc = await salesContext();
  if ("error" in sc) return { ok: false, message: sc.error };
  const campaignId = str(fd, "campaign_id") ?? "";
  const parsed = textCreativeSchema.safeParse({ headline: str(fd, "headline"), body_text: str(fd, "body_text"), click_url: str(fd, "click_url"), weight: str(fd, "weight") ?? "1" });
  if (!parsed.success) return { ok: false, message: issuesMessage(parsed.error) };
  const { knews } = await getKnewsSessionClient();
  const { error } = await knews.from("ad_creatives").insert({ campaign_id: campaignId, format: "text", ...parsed.data });
  if (error) return { ok: false, message: dbMessage(error.message) };
  revalidatePath(`/ads/campanhas/${campaignId}`);
  return { ok: true, message: "Criativo de texto criado. Revise e aprove para entrar no ar." };
}

export async function reviewCreative(fd: FormData): Promise<void> {
  const status = str(fd, "status");
  if (!status || !["approved", "rejected", "pending"].includes(status)) return;
  const { knews } = await getKnewsSessionClient();
  await knews.from("ad_creatives").update({ status }).eq("id", str(fd, "id") ?? "");
  revalidatePath(`/ads/campanhas/${str(fd, "campaign_id") ?? ""}`);
}

// --- Links afiliados e produtos proprios --------------------------------------

export async function createLink(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const sc = await salesContext();
  if ("error" in sc) return { ok: false, message: sc.error };
  const parsed = linkSchema.safeParse(Object.fromEntries(["code", "title", "kind", "destination_url", "disclosure"].map((k) => [k, str(fd, k)])));
  if (!parsed.success) return { ok: false, message: issuesMessage(parsed.error) };
  const { knews } = await getKnewsSessionClient();
  const { error } = await knews.from("ad_links").insert({ ...parsed.data, portal_id: sc.portalId, created_by: sc.ctx.userId });
  if (error) return { ok: false, message: dbMessage(error.message) };
  revalidatePath("/produtos");
  return { ok: true, message: `Link criado: /r/${parsed.data.code}` };
}

export async function updateLinkDestination(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const sc = await salesContext();
  if ("error" in sc) return { ok: false, message: sc.error };
  const parsed = linkSchema.pick({ destination_url: true }).safeParse({ destination_url: str(fd, "destination_url") });
  if (!parsed.success) return { ok: false, message: issuesMessage(parsed.error) };
  const { knews } = await getKnewsSessionClient();
  const { error, count } = await knews.from("ad_links").update(parsed.data, { count: "exact" }).eq("id", str(fd, "id") ?? "");
  if (error) return { ok: false, message: dbMessage(error.message) };
  if (!count) return { ok: false, message: "Link não encontrado ou sem permissão." };
  revalidatePath("/produtos");
  return { ok: true, message: "Destino atualizado em todas as matérias que usam o link." };
}

export async function toggleLink(fd: FormData): Promise<void> {
  const { knews } = await getKnewsSessionClient();
  await knews.from("ad_links").update({ active: str(fd, "active") === "true" }).eq("id", str(fd, "id") ?? "");
  revalidatePath("/produtos");
}

// --- Receitas --------------------------------------------------------------------

export async function createRevenue(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const sc = await salesContext();
  if ("error" in sc) return { ok: false, message: sc.error };
  const parsed = revenueSchema.safeParse(
    Object.fromEntries(["source", "contract_id", "period_start", "period_end", "amount_cents", "status", "reference", "notes"].map((k) => [k, str(fd, k)])),
  );
  if (!parsed.success) return { ok: false, message: issuesMessage(parsed.error) };
  const { knews } = await getKnewsSessionClient();
  const { error } = await knews.from("ad_revenue_entries").insert({ ...parsed.data, portal_id: sc.portalId, created_by: sc.ctx.userId });
  if (error) return { ok: false, message: dbMessage(error.message) };
  revalidatePath("/comercial");
  return { ok: true, message: "Receita lançada." };
}

export async function setRevenueStatus(fd: FormData): Promise<void> {
  const status = str(fd, "status");
  if (!status || !["confirmed", "paid", "cancelled"].includes(status)) return;
  const { knews } = await getKnewsSessionClient();
  await knews.from("ad_revenue_entries").update({ status }).eq("id", str(fd, "id") ?? "");
  revalidatePath("/comercial");
}
