// Cliente minimo da Meta Graph API (Facebook Pages e Instagram Graph API).
// O token vai so no cabecalho Authorization, nunca na URL, para nao aparecer em logs.
// Erros sao classificados para o worker decidir entre repetir, parar ou pedir conferencia.

export type GraphConfig = { baseUrl: string; timeoutMs?: number; fetchImpl?: typeof fetch };

export type GraphErrorKind = "transient" | "rate_limit" | "auth" | "permanent" | "uncertain";

export class GraphError extends Error {
  constructor(
    message: string,
    public readonly kind: GraphErrorKind,
    public readonly code?: number,
  ) {
    super(message);
  }
}

export const DEFAULT_GRAPH_BASE_URL = "https://graph.facebook.com/v24.0";

const RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 613, 80001, 80002]);
// 190/102: token invalido ou expirado. Falta de permissao (10, 200) e erro permanente.
const AUTH_CODES = new Set([102, 190]);

export function sanitizeGraphMessage(message: string): string {
  return message.replace(/(access_token=)[^&\s]+/gi, "$1***").replace(/EAA[A-Za-z0-9]{10,}/g, "***").slice(0, 300);
}

type GraphErrorBody = { error?: { message?: string; code?: number; error_subcode?: number; is_transient?: boolean; type?: string } };

export function classifyGraphError(status: number, body: GraphErrorBody | null): GraphError {
  const e = body?.error;
  const code = e?.code;
  const message = sanitizeGraphMessage(e?.message ?? `HTTP ${status}`);
  if (code !== undefined && AUTH_CODES.has(code)) return new GraphError(message, "auth", code);
  if (status === 429 || (code !== undefined && RATE_LIMIT_CODES.has(code))) return new GraphError(message, "rate_limit", code);
  if (status >= 500 || e?.is_transient || code === 1 || code === 2) return new GraphError(message, "transient", code);
  return new GraphError(message, "permanent", code);
}

async function call<T>(cfg: GraphConfig, method: "GET" | "POST", path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(cfg.baseUrl.replace(/\/$/, "") + path);
  const init: RequestInit = { method, headers: { authorization: `Bearer ${token}` }, redirect: "error" };
  if (method === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  else init.body = new URLSearchParams(params);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 15000);
  let res: Response;
  try {
    res = await (cfg.fetchImpl ?? fetch)(url, { ...init, signal: controller.signal });
  } catch (err) {
    // Sem resposta: um POST pode ter chegado a Meta. Quem chama decide se e seguro repetir.
    const reason = err instanceof Error ? err.name : "erro de rede";
    throw new GraphError(`sem resposta da Graph API (${reason})`, method === "POST" ? "uncertain" : "transient");
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok || (body && typeof body === "object" && "error" in body)) throw classifyGraphError(res.status, body as GraphErrorBody);
  return body as T;
}

export async function publishFacebookPost(cfg: GraphConfig, pageId: string, token: string, post: { message: string; link?: string | null }): Promise<{ id: string; permalink: string | null }> {
  const params: Record<string, string> = { message: post.message };
  if (post.link) params.link = post.link;
  const created = await call<{ id: string }>(cfg, "POST", `/${pageId}/feed`, token, params);
  const permalink = await call<{ permalink_url?: string }>(cfg, "GET", `/${created.id}`, token, { fields: "permalink_url" })
    .then((r) => r.permalink_url ?? null)
    .catch(() => null);
  return { id: created.id, permalink };
}

// Instagram: 1) container de midia (sem efeito publico, pode repetir); 2) media_publish.
export async function createInstagramContainer(cfg: GraphConfig, igUserId: string, token: string, post: { imageUrl: string; caption: string }): Promise<string> {
  try {
    const r = await call<{ id: string }>(cfg, "POST", `/${igUserId}/media`, token, { image_url: post.imageUrl, caption: post.caption });
    return r.id;
  } catch (e) {
    if (e instanceof GraphError && e.kind === "uncertain") throw new GraphError(e.message, "transient");
    throw e;
  }
}

export async function instagramContainerStatus(cfg: GraphConfig, containerId: string, token: string): Promise<string> {
  const r = await call<{ status_code?: string }>(cfg, "GET", `/${containerId}`, token, { fields: "status_code" });
  return r.status_code ?? "FINISHED";
}

export async function publishInstagramContainer(cfg: GraphConfig, igUserId: string, containerId: string, token: string): Promise<{ id: string; permalink: string | null }> {
  const r = await call<{ id: string }>(cfg, "POST", `/${igUserId}/media_publish`, token, { creation_id: containerId });
  const permalink = await call<{ permalink?: string }>(cfg, "GET", `/${r.id}`, token, { fields: "permalink" })
    .then((x) => x.permalink ?? null)
    .catch(() => null);
  return { id: r.id, permalink };
}

export type SocialMetrics = { reactions: number; comments: number; shares: number; reach?: number };

export async function fetchFacebookMetrics(cfg: GraphConfig, postId: string, token: string): Promise<SocialMetrics> {
  const r = await call<{ shares?: { count?: number }; reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } }>(
    cfg,
    "GET",
    `/${postId}`,
    token,
    { fields: "shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)" },
  );
  return { reactions: r.reactions?.summary?.total_count ?? 0, comments: r.comments?.summary?.total_count ?? 0, shares: r.shares?.count ?? 0 };
}

export async function fetchInstagramMetrics(cfg: GraphConfig, mediaId: string, token: string): Promise<SocialMetrics> {
  const r = await call<{ like_count?: number; comments_count?: number }>(cfg, "GET", `/${mediaId}`, token, { fields: "like_count,comments_count" });
  const metrics: SocialMetrics = { reactions: r.like_count ?? 0, comments: r.comments_count ?? 0, shares: 0 };
  // Insights dependem da permissao instagram_manage_insights; ausencia nao e erro.
  try {
    const ins = await call<{ data?: Array<{ name: string; values?: Array<{ value?: number }> }> }>(cfg, "GET", `/${mediaId}/insights`, token, { metric: "reach,shares" });
    for (const m of ins.data ?? []) {
      const v = m.values?.[0]?.value ?? 0;
      if (m.name === "reach") metrics.reach = v;
      if (m.name === "shares") metrics.shares = v;
    }
  } catch (e) {
    if (e instanceof GraphError && e.kind === "auth") throw e;
  }
  return metrics;
}
