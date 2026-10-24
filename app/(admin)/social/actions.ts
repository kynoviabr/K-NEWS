"use server";

import { revalidatePath } from "next/cache";
import { canEdit, canManage, getAdminContext } from "@/lib/admin-context";
import { getKnewsSessionClient } from "@/lib/supabase/knews";
import { portalUrl } from "@/lib/portal";
import { encryptToken, tokenAad } from "@/lib/social/token-crypto";
import { issuesMessage } from "@/lib/validations/ads.schema";
import { socialAccountSchema, socialPostSchema } from "@/lib/validations/social.schema";
import type { ActionState } from "../ads/actions";

// Escritas pela sessao do usuario: RLS, privilegio por coluna e a guarda
// knews.guard_social_post decidem; as checagens aqui so melhoram a mensagem.

function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  return typeof v === "string" ? v : undefined;
}

function dbMessage(message: string): string {
  if (/duplicate key/.test(message)) return "Essa matéria já tem post nessa rede. Use o histórico para reagendar.";
  if (/row-level security|permission denied|42501/.test(message)) return "Sem permissão para esta operação neste portal.";
  if (/token_format/.test(message)) return "Token não foi cifrado; nada foi gravado.";
  return message;
}

export async function connectSocialAccount(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getAdminContext();
  if (!ctx?.active || !canManage(ctx.active)) return { ok: false, message: "Só a gestão do portal conecta contas." };
  const parsed = socialAccountSchema.safeParse(Object.fromEntries(["provider", "external_account_id", "display_name", "access_token", "expires_on", "daily_post_limit"].map((k) => [k, str(fd, k)])));
  if (!parsed.success) return { ok: false, message: issuesMessage(parsed.error) };
  const d = parsed.data;
  let cipher: string;
  try {
    cipher = encryptToken(d.access_token, tokenAad(ctx.active.portalId, d.provider));
  } catch {
    return { ok: false, message: "Servidor sem KNEWS_SOCIAL_TOKEN_KEY: a conta não pode ser conectada." };
  }
  const { knews } = await getKnewsSessionClient();
  const { error } = await knews.rpc("save_social_account", {
    p_portal_id: ctx.active.portalId,
    p_provider: d.provider,
    p_external_account_id: d.external_account_id,
    p_display_name: d.display_name ?? "",
    p_token_encrypted: cipher,
    p_expires_at: d.expires_on,
    p_daily_post_limit: d.daily_post_limit,
  });
  if (error) return { ok: false, message: dbMessage(error.message) };
  revalidatePath("/social");
  return { ok: true, message: "Conta conectada. O token foi cifrado e não aparece mais no painel." };
}

export async function setSocialAccountStatus(fd: FormData): Promise<void> {
  const id = str(fd, "account_id");
  const status = str(fd, "status");
  if (!id || (status !== "active" && status !== "disabled")) return;
  const { knews } = await getKnewsSessionClient();
  await knews.rpc("set_social_account_status", { p_account_id: id, p_status: status });
  revalidatePath("/social");
}

export async function scheduleSocialPost(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getAdminContext();
  if (!ctx?.active || !canEdit(ctx.active)) return { ok: false, message: "Só a redação do portal agenda posts." };
  const parsed = socialPostSchema.safeParse({
    article_id: str(fd, "article_id"),
    providers: fd.getAll("providers").filter((v): v is string => typeof v === "string"),
    message: str(fd, "message"),
    image_url: str(fd, "image_url"),
    image_rights_confirmed: fd.get("image_rights_confirmed") === "on",
    scheduled_at: str(fd, "scheduled_at"),
  });
  if (!parsed.success) return { ok: false, message: issuesMessage(parsed.error) };
  const d = parsed.data;
  const { knews } = await getKnewsSessionClient();
  const { data: article } = await knews
    .from("articles")
    .select("slug, portals(slug, portal_domains(domain, is_primary))")
    .eq("id", d.article_id)
    .eq("portal_id", ctx.active.portalId)
    .maybeSingle();
  if (!article) return { ok: false, message: "Matéria não encontrada neste portal." };
  const portal = article.portals as unknown as { slug: string; portal_domains: Array<{ domain: string; is_primary: boolean }> };
  const link = portalUrl({ slug: portal.slug, primary_domain: portal.portal_domains.find((x) => x.is_primary)?.domain }, `/portal/noticia/${article.slug}`);
  const { error } = await knews.from("social_posts").insert(
    d.providers.map((provider) => ({
      portal_id: ctx.active!.portalId,
      article_id: d.article_id,
      provider,
      message: d.message,
      link_url: link,
      image_url: d.image_url,
      image_rights_confirmed: d.image_rights_confirmed,
      scheduled_at: d.scheduled_at,
    })),
  );
  if (error) return { ok: false, message: dbMessage(error.message) };
  revalidatePath("/social");
  return { ok: true, message: d.providers.length > 1 ? "Posts agendados." : "Post agendado." };
}

export async function setSocialPostStatus(fd: FormData): Promise<void> {
  const id = str(fd, "post_id");
  const status = str(fd, "status");
  if (!id || (status !== "cancelled" && status !== "scheduled")) return;
  const { knews } = await getKnewsSessionClient();
  const fields = status === "scheduled" ? { status, scheduled_at: new Date().toISOString() } : { status };
  await knews.from("social_posts").update(fields).eq("id", id);
  revalidatePath("/social");
}
