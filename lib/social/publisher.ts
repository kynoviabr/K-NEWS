import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createInstagramContainer,
  DEFAULT_GRAPH_BASE_URL,
  fetchFacebookMetrics,
  fetchInstagramMetrics,
  GraphError,
  instagramContainerStatus,
  publishFacebookPost,
  publishInstagramContainer,
  type GraphConfig,
} from "@/lib/social/meta-graph";
import { decryptToken, tokenAad } from "@/lib/social/token-crypto";

// Handlers dos jobs social_publish e social_metrics. Envio no maximo uma vez:
// begin_social_publish marca "publishing" antes da chamada; so erros com resposta da
// Meta dizendo que nada foi criado voltam para "scheduled".

export type SocialConfig = GraphConfig & { enabled: boolean; tokenKey?: string };

export function socialPublishingEnabled(): boolean {
  return process.env.KNEWS_SOCIAL_PUBLISHING === "enabled";
}

export function socialConfigFromEnv(): SocialConfig {
  return {
    enabled: socialPublishingEnabled(),
    baseUrl: process.env.META_GRAPH_BASE_URL || DEFAULT_GRAPH_BASE_URL,
    tokenKey: process.env.KNEWS_SOCIAL_TOKEN_KEY,
  };
}

export class SocialStop extends Error {} // nao repetir o job

type Claim = {
  skip?: string;
  deferred?: boolean;
  post_id: string;
  portal_id: string;
  provider: "facebook" | "instagram";
  message: string;
  link_url: string | null;
  image_url: string | null;
  ig_container_id: string | null;
  account_id: string;
  external_account_id: string;
  token: string;
};

export function composeMessage(message: string, link: string | null, provider: string): string {
  // No Instagram link no texto nao e clicavel, mas o endereco ajuda quem quiser digitar.
  if (provider === "instagram" && link && !message.includes(link)) return `${message}\n\n${link}`.slice(0, 2200);
  return message;
}

export async function handleSocialPublish(db: SupabaseClient, cfg: SocialConfig, job: { payload: Record<string, unknown>; attempts: number; max_attempts?: number }): Promise<Record<string, unknown>> {
  if (!cfg.enabled) throw new SocialStop("publicacao social desativada neste ambiente (KNEWS_SOCIAL_PUBLISHING)");
  const k = db.schema("knews");
  const postId = String(job.payload.post_id ?? "");
  const begin = await k.rpc("begin_social_publish", { p_post_id: postId, p_revision: Number(job.payload.revision ?? 0) });
  if (begin.error) throw new Error(`begin_social_publish: ${begin.error.message}`);
  const claim = begin.data as Claim;
  if (claim.skip) return { skipped: claim.skip };
  if (claim.deferred) return { deferred: true };

  const update = async (fields: Record<string, unknown>) => {
    const { error } = await k.from("social_posts").update(fields).eq("id", postId);
    if (error) throw new Error(`social_posts: ${error.message}`);
  };

  let token: string;
  try {
    token = decryptToken(claim.token, tokenAad(claim.portal_id, claim.provider), cfg.tokenKey);
  } catch {
    await update({ status: "failed", last_error: "token da conta ilegivel: reconecte a conta" });
    throw new SocialStop("token ilegivel");
  }

  try {
    let result: { id: string; permalink: string | null };
    if (claim.provider === "facebook") {
      result = await publishFacebookPost(cfg, claim.external_account_id, token, { message: claim.message, link: claim.link_url });
    } else {
      if (!claim.image_url) throw new GraphError("instagram sem imagem", "permanent");
      let container = claim.ig_container_id;
      if (!container) {
        container = await createInstagramContainer(cfg, claim.external_account_id, token, { imageUrl: claim.image_url, caption: composeMessage(claim.message, claim.link_url, "instagram") });
        await update({ ig_container_id: container });
      }
      const status = await instagramContainerStatus(cfg, container, token);
      if (status === "IN_PROGRESS") throw new GraphError("midia ainda em processamento no Instagram", "transient");
      if (status === "ERROR" || status === "EXPIRED") {
        await update({ ig_container_id: null });
        throw new GraphError(`container do Instagram ${status}`, status === "EXPIRED" ? "transient" : "permanent");
      }
      result = await publishInstagramContainer(cfg, claim.external_account_id, container, token);
    }
    await update({ status: "published", external_post_id: result.id, permalink: result.permalink, published_at: new Date().toISOString(), last_error: null });
    await k.from("audit_logs").insert({ portal_id: claim.portal_id, action: "social_post.published", target_type: "social_post", target_id: postId, meta: { provider: claim.provider, external_post_id: result.id } });
    return { published: result.id, provider: claim.provider };
  } catch (e) {
    if (!(e instanceof GraphError)) {
      await update({ status: "needs_check", last_error: "erro interno durante o envio: confira a pagina" });
      throw new SocialStop(e instanceof Error ? e.message : String(e));
    }
    const lastAttempt = job.attempts >= (job.max_attempts ?? 5);
    switch (e.kind) {
      case "auth":
        await k.from("portal_social_accounts").update({ status: "expired", last_error: e.message, updated_at: new Date().toISOString() }).eq("id", claim.account_id);
        await update({ status: "failed", last_error: `token expirado ou revogado: ${e.message}` });
        throw new SocialStop(e.message);
      case "uncertain":
        await update({ status: "needs_check", last_error: `${e.message}: confira a pagina antes de reagendar` });
        throw new SocialStop(e.message);
      case "transient":
      case "rate_limit":
        await update(lastAttempt ? { status: "failed", last_error: e.message } : { status: "scheduled", last_error: e.message });
        if (lastAttempt) throw new SocialStop(e.message);
        throw e; // a fila repete com backoff
      default:
        await update({ status: "failed", last_error: e.message });
        throw new SocialStop(e.message);
    }
  }
}

export async function handleSocialMetrics(db: SupabaseClient, cfg: SocialConfig, job: { payload: Record<string, unknown> }): Promise<Record<string, unknown>> {
  if (!cfg.enabled) throw new SocialStop("publicacao social desativada neste ambiente (KNEWS_SOCIAL_PUBLISHING)");
  const k = db.schema("knews");
  const postId = String(job.payload.post_id ?? "");
  const { data: post, error } = await k.from("social_posts").select("id, portal_id, provider, status, external_post_id, account_id").eq("id", postId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!post || post.status !== "published" || !post.external_post_id) return { skipped: "post sem publicacao" };
  const { data: account } = await k.from("portal_social_accounts").select("id, status, access_token_encrypted").eq("id", post.account_id).maybeSingle();
  if (!account || account.status !== "active") return { skipped: "conta inativa" };
  const token = decryptToken(account.access_token_encrypted, tokenAad(post.portal_id, post.provider), cfg.tokenKey);
  try {
    const metrics = post.provider === "facebook" ? await fetchFacebookMetrics(cfg, post.external_post_id, token) : await fetchInstagramMetrics(cfg, post.external_post_id, token);
    await k.from("social_posts").update({ metrics, metrics_updated_at: new Date().toISOString() }).eq("id", postId);
    return { metrics };
  } catch (e) {
    if (e instanceof GraphError && e.kind === "auth") {
      await k.from("portal_social_accounts").update({ status: "expired", last_error: e.message, updated_at: new Date().toISOString() }).eq("id", account.id);
      throw new SocialStop(e.message);
    }
    throw e;
  }
}
