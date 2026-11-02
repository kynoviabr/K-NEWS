"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext, isSuperAdmin } from "@/lib/admin-context";
import { getKnewsSessionClient } from "@/lib/supabase/knews";
import { issuesMessage } from "@/lib/validations/ads.schema";
import { commissionPaymentSchema, partnerSchema, partnerUserSchema, territorySchema } from "@/lib/validations/partners.schema";
import type { ActionState } from "../ads/actions";

// Gestao de parceiros e da rede (super_admin). RLS, gatilhos de territorio e as funcoes
// add_partner_user/set_commission_status sao a autorizacao real.

function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  return typeof v === "string" ? v : undefined;
}

function dbMessage(message: string): string {
  if (/row-level security|permission denied|42501/.test(message)) return "Sem permissão: só a rede gerencia parceiros.";
  if (/duplicate key.*partner_users/.test(message)) return "Essa pessoa já representa um parceiro.";
  return message;
}

async function requireNetworkAdmin(): Promise<string | null> {
  const ctx = await getAdminContext();
  if (!ctx) return "Entre novamente.";
  return isSuperAdmin(ctx) ? null : "Só a administração da rede gerencia parceiros.";
}

export async function createPartner(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const denied = await requireNetworkAdmin();
  if (denied) return { ok: false, message: denied };
  const parsed = partnerSchema.safeParse(Object.fromEntries(["name", "document", "contact_name", "contact_email", "contact_phone"].map((k) => [k, str(fd, k)])));
  if (!parsed.success) return { ok: false, message: issuesMessage(parsed.error) };
  const { client, knews } = await getKnewsSessionClient();
  const { data: auth } = await client.auth.getUser();
  const { error } = await knews.from("partners").insert({ ...parsed.data, created_by: auth.user?.id });
  if (error) return { ok: false, message: dbMessage(error.message) };
  revalidatePath("/parceiros");
  return { ok: true, message: "Parceiro cadastrado. Agora defina o território." };
}

export async function setPartnerStatus(fd: FormData): Promise<void> {
  const id = str(fd, "partner_id");
  const status = str(fd, "status");
  if (!id || !status || !["active", "suspended", "ended"].includes(status)) return;
  const { knews } = await getKnewsSessionClient();
  await knews.from("partners").update({ status }).eq("id", id);
  revalidatePath("/parceiros");
}

export async function addTerritory(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const denied = await requireNetworkAdmin();
  if (denied) return { ok: false, message: denied };
  const parsed = territorySchema.safeParse({ partner_id: str(fd, "partner_id"), scope: str(fd, "scope"), commission_pct: str(fd, "commission_pct") });
  if (!parsed.success) return { ok: false, message: issuesMessage(parsed.error) };
  const [kind, id] = parsed.data.scope.split(":");
  const { knews } = await getKnewsSessionClient();
  const { error } = await knews.from("partner_territories").insert({
    partner_id: parsed.data.partner_id,
    city_id: kind === "city" ? id : null,
    region_id: kind === "region" ? id : null,
    commission_pct: parsed.data.commission_pct,
  });
  if (error) return { ok: false, message: dbMessage(error.message) };
  revalidatePath("/parceiros");
  return { ok: true, message: "Território atribuído. As pessoas do parceiro já acessam os portais dele." };
}

export async function endTerritory(fd: FormData): Promise<void> {
  const id = str(fd, "territory_id");
  if (!id) return;
  const { knews } = await getKnewsSessionClient();
  await knews.from("partner_territories").update({ status: "ended" }).eq("id", id);
  revalidatePath("/parceiros");
}

export async function addPartnerUser(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const denied = await requireNetworkAdmin();
  if (denied) return { ok: false, message: denied };
  const parsed = partnerUserSchema.safeParse({ partner_id: str(fd, "partner_id"), email: str(fd, "email")?.trim() });
  if (!parsed.success) return { ok: false, message: issuesMessage(parsed.error) };
  const { knews } = await getKnewsSessionClient();
  const { error } = await knews.rpc("add_partner_user", { p_partner_id: parsed.data.partner_id, p_email: parsed.data.email });
  if (error) return { ok: false, message: dbMessage(error.message) };
  revalidatePath("/parceiros");
  return { ok: true, message: "Pessoa vinculada ao parceiro." };
}

export async function removePartnerUser(fd: FormData): Promise<void> {
  const partnerId = str(fd, "partner_id");
  const userId = str(fd, "user_id");
  if (!partnerId || !userId) return;
  const { knews } = await getKnewsSessionClient();
  await knews.from("partner_users").delete().eq("partner_id", partnerId).eq("user_id", userId);
  revalidatePath("/parceiros");
}

export async function setCommissionStatus(fd: FormData): Promise<void> {
  const id = str(fd, "id");
  const status = str(fd, "status");
  if (!id || (status !== "approved" && status !== "cancelled")) return;
  const { knews } = await getKnewsSessionClient();
  await knews.rpc("set_commission_status", { p_commission_id: id, p_status: status });
  revalidatePath("/parceiros");
}

export async function payCommission(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const denied = await requireNetworkAdmin();
  if (denied) return { ok: false, message: denied };
  const parsed = commissionPaymentSchema.safeParse({ id: str(fd, "id"), payment_reference: str(fd, "payment_reference") });
  if (!parsed.success) return { ok: false, message: issuesMessage(parsed.error) };
  const { knews } = await getKnewsSessionClient();
  const { error } = await knews.rpc("set_commission_status", { p_commission_id: parsed.data.id, p_status: "paid", p_payment_reference: parsed.data.payment_reference });
  if (error) return { ok: false, message: dbMessage(error.message) };
  revalidatePath("/parceiros");
  return { ok: true, message: "Pagamento registrado." };
}
