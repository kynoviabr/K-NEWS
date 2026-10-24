"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canEdit, getAdminContext } from "@/lib/admin-context";
import { getKnewsServiceClient, getKnewsSessionClient } from "@/lib/supabase/knews";
import { assertSafeUrl } from "@/services/rss-fetch";
import { allowPrivateFeeds } from "@/lib/news-intelligence/dev-flags";

export type ActionState = { ok: boolean; message: string } | null;

const sourceSchema = z.object({
  name: z.string().trim().min(3, "Nome muito curto").max(120),
  url: z
    .string()
    .trim()
    .url("URL invalida")
    .refine((u) => {
      try {
        if (!allowPrivateFeeds()) assertSafeUrl(u);
        return true;
      } catch {
        return false;
      }
    }, "URL nao permitida (use http/https publico)"),
  license: z.string().trim().max(500).optional(),
  fetch_interval_minutes: z.coerce.number().int().min(5).max(1440),
});

export async function createSource(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getAdminContext();
  if (!ctx?.active || !canEdit(ctx.active)) return { ok: false, message: "Sem permissao para cadastrar fontes neste portal." };
  const parsed = sourceSchema.safeParse({
    name: formData.get("name"),
    url: formData.get("url"),
    license: formData.get("license") || undefined,
    fetch_interval_minutes: formData.get("fetch_interval_minutes") ?? 60,
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };

  const { knews } = await getKnewsSessionClient();
  const { error } = await knews.from("sources").insert({ ...parsed.data, portal_id: ctx.active.portalId, kind: "rss", created_by: ctx.userId });
  if (error) return { ok: false, message: /uq_knews_sources_portal_url|duplicate/.test(error.message) ? "Esta fonte ja esta cadastrada." : error.message };
  revalidatePath("/fontes");
  return { ok: true, message: "Fonte cadastrada." };
}

export async function toggleSource(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const enabled = formData.get("enabled") === "true";
  const { knews } = await getKnewsSessionClient();
  // RLS garante que so editores do portal da fonte alteram.
  await knews.from("sources").update({ enabled }).eq("id", id);
  revalidatePath("/fontes");
}

// "Coletar agora": confere a permissao com a sessao do usuario e so entao enfileira com service_role.
export async function fetchSourceNow(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const ctx = await getAdminContext();
  if (!ctx) return;
  const { knews } = await getKnewsSessionClient();
  const { data: source } = await knews.from("sources").select("id, portal_id").eq("id", id).maybeSingle();
  const member = ctx.memberships.find((m) => m.portalId === source?.portal_id);
  if (!source || !canEdit(member ?? null)) return;
  await getKnewsServiceClient()
    .schema("knews")
    .rpc("enqueue_job", {
      p_portal_id: source.portal_id,
      p_job_type: "rss_fetch",
      p_payload: { source_id: source.id, requested_by: ctx.userId },
      p_idempotency_key: `manual:${source.id}:${Math.floor(Date.now() / 60_000)}`,
      p_priority: 200,
    });
  revalidatePath("/fontes");
}
