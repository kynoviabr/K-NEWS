import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchRssSafe, type SafeFetchOptions } from "@/services/rss-fetch";
import { parseFeed } from "@/services/feed-parser";
import { createAiProviderFromEnv, type AiProviderClient } from "@/services/ai-provider";
import { classifyRiskFromContext, detectSensitiveCategories } from "@/lib/editorial";
import { classifyTerritory, type TerritoryCatalog } from "@/lib/geo";
import { canonicalDedupKey, slugify, titleFingerprint } from "@/lib/news-intelligence/fingerprint";
import { checkDraft } from "@/lib/news-intelligence/draft-guard";
import { logger } from "@/lib/logger";

// Worker da fila duravel knews.jobs. Roda com service_role (rota interna ou script),
// nunca no browser. Cada handler e idempotente: reexecutar um job nao duplica efeitos.

export type WorkerDeps = {
  db: SupabaseClient; // cliente service_role
  workerId: string;
  ai?: AiProviderClient;
  fetchOptions?: SafeFetchOptions;
  leaseSeconds?: number;
};

export class NonRetryableError extends Error {}

type Job = { id: string; portal_id: string | null; job_type: string; payload: Record<string, unknown>; attempts: number };

export type WorkerReport = { claimed: number; completed: number; failed: number; results: Array<{ jobId: string; jobType: string; ok: boolean; detail: unknown }> };

function knews(db: SupabaseClient) {
  return db.schema("knews");
}

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function mustOne<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<NonNullable<T>> {
  const data = await must(p, what);
  if (data == null) throw new Error(`${what}: nao encontrado`);
  return data as NonNullable<T>;
}

export async function handleRssFetch(deps: WorkerDeps, job: Job): Promise<Record<string, unknown>> {
  const sourceId = String(job.payload.source_id ?? "");
  const db = knews(deps.db);
  const source = await must(db.from("sources").select("id, portal_id, url, kind, enabled").eq("id", sourceId).maybeSingle(), "fonte");
  if (!source) throw new NonRetryableError("fonte nao encontrada");
  if (!source.enabled) return { skipped: "fonte desativada" };
  if (source.kind !== "rss") throw new NonRetryableError(`tipo de fonte nao suportado pelo coletor RSS: ${source.kind}`);

  try {
    const xml = await fetchRssSafe(source.url, deps.fetchOptions);
    const items = parseFeed(xml).map((i) => ({
      dedup_key: canonicalDedupKey(i.canonical ?? i.url),
      title_fingerprint: titleFingerprint(i.title),
      url: i.url,
      canonical_url: i.canonical,
      title: i.title,
      summary: i.summary?.slice(0, 8000) ?? null,
      published_at: i.publishedAt,
    }));
    const ingest = (await must(db.rpc("ingest_source_items", { p_source_id: source.id, p_items: items }), "ingestao")) as {
      inserted: number;
      duplicates: number;
      near_duplicates: number;
      new_item_ids: string[];
    };
    for (const itemId of ingest.new_item_ids) {
      await must(
        db.rpc("enqueue_job", { p_portal_id: source.portal_id, p_job_type: "draft", p_payload: { source_item_id: itemId }, p_idempotency_key: `draft:${itemId}` }),
        "enfileirar rascunho",
      );
    }
    await must(db.from("fetch_logs").insert({ source_id: source.id, status: "success", items_found: items.length }), "fetch_log");
    await must(db.from("sources").update({ last_fetched_at: new Date().toISOString(), last_status: "success", last_error: null }).eq("id", source.id), "fonte");
    return { items: items.length, inserted: ingest.inserted, duplicates: ingest.duplicates, near_duplicates: ingest.near_duplicates };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from("fetch_logs").insert({ source_id: source.id, status: "failed", items_found: 0, error: message.slice(0, 500) });
    await db.from("sources").update({ last_fetched_at: new Date().toISOString(), last_status: "failed", last_error: message.slice(0, 500) }).eq("id", source.id);
    if (/SSRF|Protocolo|credenciais|DOCTYPE|nao reconhecido|Content-Type/.test(message)) throw new NonRetryableError(message);
    throw e;
  }
}

async function loadCatalog(deps: WorkerDeps, portalId: string): Promise<{ catalog: TerritoryCatalog; portalSlug: string; portalCityId: string }> {
  const db = knews(deps.db);
  const portal = await mustOne(db.from("portals").select("id, slug, city_id").eq("id", portalId).single(), "portal");
  const city = await mustOne(db.from("cities").select("id, name, slug, region_id").eq("id", portal.city_id).single(), "cidade");
  const neighborhoods = await must(db.from("neighborhoods").select("id, name, city_id").eq("city_id", city.id), "bairros");
  return {
    portalSlug: portal.slug,
    portalCityId: city.id,
    catalog: {
      cities: [{ id: city.id, name: city.name, slug: city.slug }],
      neighborhoods: (neighborhoods as Array<{ id: string; name: string; city_id: string }>).map((n) => ({ id: n.id, name: n.name, cityId: n.city_id })),
    },
  };
}

export async function handleDraft(deps: WorkerDeps, job: Job): Promise<Record<string, unknown>> {
  const db = knews(deps.db);
  const itemId = String(job.payload.source_item_id ?? "");
  const item = await must(db.from("source_items").select("*").eq("id", itemId).maybeSingle(), "item");
  if (!item) throw new NonRetryableError("item nao encontrado");
  if (item.article_id) return { article_id: item.article_id, idempotent: true };
  if (item.status === "discarded" || item.status === "duplicate") return { skipped: item.status };
  // Retomada apos queda no meio do job: o artigo ja existe (indice unico por source_item_id).
  const existing = await must(db.from("articles").select("id").eq("source_item_id", item.id).maybeSingle(), "artigo existente");
  if (existing) {
    await must(db.from("source_items").update({ status: "drafted", article_id: existing.id }).eq("id", item.id), "item");
    return { article_id: existing.id, resumed: true };
  }

  const { catalog, portalSlug } = await loadCatalog(deps, item.portal_id);
  const sourceText = [item.title, item.summary].filter(Boolean).join("\n");
  const territory = classifyTerritory(sourceText, catalog);
  if (!territory.cityId) {
    await must(db.from("source_items").update({ status: "discarded", discard_reason: "Fora do territorio do portal" }).eq("id", item.id), "descartar");
    return { discarded: "fora do territorio" };
  }

  await must(db.from("source_items").update({ status: "drafting" }).eq("id", item.id), "item");
  const ai = deps.ai ?? createAiProviderFromEnv();
  const draft = await ai.draftArticle({
    title: item.title,
    evidences: [{ sourceUrl: item.url, contentSnippet: sourceText }],
    claims: [item.summary ?? item.title],
    portalSlug,
  });

  const guard = checkDraft(draft.body, sourceText);
  // Fonte RSS sozinha e evidencia fraca: o motor editorial nunca libera autopublicacao aqui.
  const assessment = classifyRiskFromContext({
    title: draft.title,
    body: draft.body,
    evidences: [{ sourceUrl: item.url, sourceLabel: new URL(item.url).hostname, sourceType: "rss", capturedAt: item.fetched_at, contentSnippet: sourceText }],
  });
  const blockedReasons = [...assessment.blockedReasons, ...guard.flags];
  // Coincidencia de palavras com a fonte nao prova nem refuta um fato: quando o
  // bloqueio vem so dessa heuristica, o artigo vai para revisao humana (risco alto).
  // Bloqueio definitivo fica para temas sensiveis e ausencia de evidencia.
  const hardBlock = detectSensitiveCategories(`${draft.title}\n${draft.body}\n${sourceText}`).length > 0 || assessment.evidenceQuality === "none";
  const riskLevel = assessment.level === "blocked" && !hardBlock ? "high" : assessment.level;
  const status = riskLevel === "blocked" ? "blocked" : "reviewing";

  const article: { id: string } = await mustOne(
    db
      .from("articles")
      .insert({
        portal_id: item.portal_id,
        slug: slugify(draft.title, item.id.slice(0, 8)),
        title: draft.title,
        excerpt: draft.excerpt,
        body: draft.body,
        status,
        risk_level: riskLevel,
        source_item_id: item.id,
        city_id: territory.cityId,
        neighborhood_id: territory.neighborhoodId,
        ai_provider: draft.provider,
        ai_model: draft.model,
      })
      .select("id")
      .single(),
    "artigo",
  );

  const evidence: { id: string } = await mustOne(
    db
      .from("article_evidences")
      .insert({ article_id: article.id, source_url: item.url, source_label: new URL(item.url).hostname, source_type: "rss", content_snippet: sourceText.slice(0, 2000) })
      .select("id")
      .single(),
    "evidencia",
  );
  if (guard.claims.length > 0) {
    await must(
      db.from("article_claims").insert(
        guard.claims.map((c) => ({ article_id: article.id, claim: c.text, kind: c.kind, status: c.status, note: c.note, evidence_id: c.status === "needs_review" ? evidence.id : null })),
      ),
      "claims",
    );
  }
  await must(
    db.from("editorial_decisions").insert({
      article_id: article.id,
      risk_level: riskLevel,
      evidence_quality: assessment.evidenceQuality,
      blocked_reasons: blockedReasons,
      is_auto_publishable: false,
    }),
    "decisao",
  );
  await must(
    db.from("ai_costs").insert({ article_id: article.id, job_id: job.id, provider: draft.provider, model: draft.model, tokens_in: draft.tokensIn, tokens_out: draft.tokensOut, cost_cents: draft.costCents }),
    "custo IA",
  );
  await must(db.from("processed_canonicals").update({ article_id: article.id }).eq("portal_id", item.portal_id).eq("dedup_key", item.dedup_key), "ledger");
  await must(db.from("source_items").update({ status: "drafted", article_id: article.id }).eq("id", item.id), "item");
  return { article_id: article.id, status, risk_level: riskLevel, flags: guard.flags };
}

const HANDLERS: Record<string, (deps: WorkerDeps, job: Job) => Promise<Record<string, unknown>>> = {
  rss_fetch: handleRssFetch,
  draft: handleDraft,
};

export async function runWorker(deps: WorkerDeps, limit = 10): Promise<WorkerReport> {
  const db = knews(deps.db);
  const jobs = (await must(db.rpc("claim_jobs", { p_worker_id: deps.workerId, p_limit: limit, p_lease_seconds: deps.leaseSeconds ?? 120 }), "claim")) as Job[];
  const report: WorkerReport = { claimed: jobs.length, completed: 0, failed: 0, results: [] };

  for (const job of jobs) {
    const handler = HANDLERS[job.job_type];
    try {
      if (!handler) throw new NonRetryableError(`sem handler para ${job.job_type}`);
      const result = await handler(deps, job);
      await must(db.rpc("complete_job", { p_job_id: job.id, p_result: result }), "complete");
      report.completed++;
      report.results.push({ jobId: job.id, jobType: job.job_type, ok: true, detail: result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db.rpc("fail_job", { p_job_id: job.id, p_error: message.slice(0, 1000), p_retry: !(e instanceof NonRetryableError) });
      logger.error("knews-worker", "job falhou", { jobId: job.id, jobType: job.job_type, error: message });
      report.failed++;
      report.results.push({ jobId: job.id, jobType: job.job_type, ok: false, detail: message });
    }
  }
  return report;
}
