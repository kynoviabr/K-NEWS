"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getKnewsSessionClient } from "@/lib/supabase/knews";
import { checkDraft } from "@/lib/news-intelligence/draft-guard";

// Todas as acoes usam a sessao do editor: RLS e as funcoes knews.review_article /
// knews.unpublish_article decidem permissao; as guardas do banco decidem se publica.

export type ReviewState = { ok: boolean; message: string } | null;

const idSchema = z.string().uuid();

export async function saveDraft(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const id = idSchema.safeParse(formData.get("id"));
  const parsed = z
    .object({
      title: z.string().trim().min(10).max(200),
      excerpt: z.string().trim().max(300),
      body: z.string().trim().min(1).max(50_000),
      // A guarda do banco confere que editoria e bairro sao do portal da materia.
      category: z.string().regex(/^[a-z0-9-]{0,41}$/).transform((v) => v || null),
      neighborhood_id: z.union([z.uuid(), z.literal("")]).transform((v) => v || null),
    })
    .safeParse({
      title: formData.get("title"),
      excerpt: formData.get("excerpt") ?? "",
      body: formData.get("body"),
      category: formData.get("category") ?? "",
      neighborhood_id: formData.get("neighborhood_id") ?? "",
    });
  if (!id.success || !parsed.success) return { ok: false, message: "Titulo (min. 10) e texto sao obrigatorios." };
  const { knews } = await getKnewsSessionClient();
  const { error, count } = await knews.from("articles").update(parsed.data, { count: "exact" }).eq("id", id.data).neq("status", "published");
  if (error) return { ok: false, message: error.message };
  if (!count) return { ok: false, message: "Nao foi possivel salvar (sem permissao ou artigo publicado: despublique antes de editar)." };

  // Texto novo, afirmacoes novas: reextrai e confere de novo contra as evidencias.
  const { data: evidences } = await knews.from("article_evidences").select("id, content_snippet").eq("article_id", id.data);
  const sourceText = (evidences ?? []).map((e: { content_snippet: string | null }) => e.content_snippet ?? "").join("\n");
  const guard = checkDraft(parsed.data.body, sourceText);
  const evidenceId = (evidences ?? [])[0]?.id ?? null;
  await knews.from("article_claims").delete().eq("article_id", id.data);
  if (guard.claims.length > 0) {
    const { error: claimsError } = await knews.from("article_claims").insert(
      guard.claims.map((c) => ({ article_id: id.data, claim: c.text, kind: c.kind, status: c.status, note: c.note, evidence_id: c.status === "needs_review" ? evidenceId : null })),
    );
    if (claimsError) return { ok: false, message: `Texto salvo, mas as afirmacoes nao foram reavaliadas: ${claimsError.message}` };
  }
  revalidatePath(`/noticias/${id.data}`);
  const pending = guard.claims.filter((c) => c.status === "unsupported").length;
  return { ok: true, message: pending ? `Rascunho salvo. ${pending} afirmacao(oes) sem respaldo na fonte.` : "Rascunho salvo." };
}

export async function setClaimStatus(formData: FormData): Promise<void> {
  const claimId = idSchema.parse(formData.get("claim_id"));
  const articleId = idSchema.parse(formData.get("article_id"));
  const status = z.enum(["supported", "unsupported", "needs_review"]).parse(formData.get("status"));
  const { knews } = await getKnewsSessionClient();
  await knews.from("article_claims").update({ status }).eq("id", claimId);
  revalidatePath(`/noticias/${articleId}`);
}

export async function reviewArticle(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const id = idSchema.safeParse(formData.get("id"));
  const decision = z.enum(["approve", "reject", "request_changes"]).safeParse(formData.get("decision"));
  if (!id.success || !decision.success) return { ok: false, message: "Requisicao invalida." };
  const note = String(formData.get("note") ?? "").trim() || null;
  const { knews } = await getKnewsSessionClient();
  const { error } = await knews.rpc("review_article", { p_article_id: id.data, p_decision: decision.data, p_note: note });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/noticias");
  revalidatePath(`/noticias/${id.data}`);
  if (decision.data === "approve") return { ok: true, message: "Publicado no portal." };
  redirect("/noticias");
}

export async function unpublishArticle(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, message: "Requisicao invalida." };
  const { knews } = await getKnewsSessionClient();
  const { error } = await knews.rpc("unpublish_article", { p_article_id: id.data, p_reason: String(formData.get("reason") ?? "") });
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/noticias/${id.data}`);
  return { ok: true, message: "Retirado do ar e registrado nas correcoes." };
}
