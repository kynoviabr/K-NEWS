import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canEdit, getAdminContext } from "@/lib/admin-context";
import { getKnewsSessionClient } from "@/lib/supabase/knews";
import { NotSignedIn } from "../../portal-switcher";
import { setClaimStatus } from "../actions";
import { EditForm, ReviewForm, UnpublishForm } from "./review-forms";

export const dynamic = "force-dynamic";

type Claim = { id: string; claim: string; kind: string; status: string; note: string | null };
type Evidence = { id: string; source_url: string; source_label: string | null; source_type: string; content_snippet: string | null; captured_at: string };

const CLAIM_LABEL: Record<string, string> = { supported: "Confirmada", unsupported: "Sem respaldo", needs_review: "A verificar" };

export default async function ArticleReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext();
  if (!ctx) return <NotSignedIn />;
  const { id } = await params;
  const { knews } = await getKnewsSessionClient();
  const { data: article } = await knews.from("articles").select("*").eq("id", id).maybeSingle();
  if (!article) notFound();

  const [{ data: evidences }, { data: claims }, { data: decisions }, { data: item }] = await Promise.all([
    knews.from("article_evidences").select("*").eq("article_id", id).order("captured_at"),
    knews.from("article_claims").select("*").eq("article_id", id).order("created_at"),
    knews.from("editorial_decisions").select("risk_level, blocked_reasons, decided_by, decided_at").eq("article_id", id).order("decided_at", { ascending: false }),
    article.source_item_id ? knews.from("source_items").select("title, summary, url").eq("id", article.source_item_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const member = ctx.memberships.find((m) => m.portalId === article.portal_id) ?? null;
  const editable = canEdit(member);
  const autoDecision = (decisions ?? []).find((d: { decided_by: string | null }) => !d.decided_by);
  const reasons: string[] = Array.isArray(autoDecision?.blocked_reasons) ? autoDecision.blocked_reasons.filter((r: unknown) => typeof r === "string") : [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/noticias" className="text-sm text-primary hover:underline">← Notícias</Link>
        <h1 className="mt-2 font-heading text-2xl font-bold tracking-tight">{article.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge>{article.status}</Badge>
          <Badge className="bg-muted text-foreground">risco: {article.risk_level}</Badge>
          {article.ai_provider && <span>rascunho: {article.ai_provider === "mock" ? "sem IA — reescrever antes de publicar" : `${article.ai_provider} / ${article.ai_model}`}</span>}
          {article.published_at && <span>publicado em {new Date(article.published_at).toLocaleString("pt-BR")}</span>}
        </div>
      </div>

      {article.risk_level === "blocked" && (
        <Card className="border-red-300">
          <CardHeader>
            <CardTitle className="text-red-900">Bloqueado para publicação</CardTitle>
            <CardDescription>Tema sensível ou sem evidência. Só um gestor regional pode reduzir o risco, com justificativa.</CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Texto</CardTitle></CardHeader>
            <CardContent>
              {editable && article.status !== "published" ? (
                <EditForm article={article} />
              ) : (
                <div className="space-y-2 whitespace-pre-wrap text-sm leading-relaxed">{article.body}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Afirmações</CardTitle>
              <CardDescription>Números e citações ausentes da fonte aparecem como “sem respaldo” e impedem a publicação até serem corrigidos.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(claims ?? []).length === 0 && <p className="text-sm text-muted-foreground">Nenhuma afirmação extraída.</p>}
              {(claims as Claim[] | null)?.map((c) => (
                <div key={c.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p>{c.claim}</p>
                    <Badge className={c.status === "unsupported" ? "bg-red-100 text-red-900" : c.status === "supported" ? "bg-emerald-100 text-emerald-900" : ""}>{CLAIM_LABEL[c.status]}</Badge>
                  </div>
                  {c.note && <p className="mt-1 text-xs text-muted-foreground">{c.note}</p>}
                  {editable && article.status !== "published" && (
                    <div className="mt-2 flex gap-2">
                      {(["supported", "unsupported"] as const).map((s) => (
                        <form key={s} action={setClaimStatus}>
                          <input type="hidden" name="claim_id" value={c.id} />
                          <input type="hidden" name="article_id" value={article.id} />
                          <input type="hidden" name="status" value={s} />
                          <Button type="submit" size="sm" variant="ghost">{s === "supported" ? "Confirmar" : "Marcar sem respaldo"}</Button>
                        </form>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {editable && ["reviewing", "draft", "blocked", "unpublished"].includes(article.status) && (
            <Card>
              <CardHeader><CardTitle>Revisão</CardTitle></CardHeader>
              <CardContent><ReviewForm id={article.id} /></CardContent>
            </Card>
          )}
          {editable && article.status === "published" && (
            <Card>
              <CardHeader><CardTitle>Retirar do ar</CardTitle></CardHeader>
              <CardContent><UnpublishForm id={article.id} /></CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Evidências</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {(evidences as Evidence[] | null)?.map((e) => (
                <div key={e.id}>
                  <a href={e.source_url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">{e.source_label ?? e.source_url}</a>
                  <div className="text-xs text-muted-foreground">{e.source_type} · capturado em {new Date(e.captured_at).toLocaleString("pt-BR")}</div>
                  {e.content_snippet && <p className="mt-1 line-clamp-6 text-xs">{e.content_snippet}</p>}
                </div>
              ))}
              {item && <p className="text-xs text-muted-foreground">Título original: {item.title}</p>}
            </CardContent>
          </Card>

          {reasons.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Avaliação automática</CardTitle></CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1 pl-4 text-sm">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
