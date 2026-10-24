import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canEdit, canManage, getAdminContext } from "@/lib/admin-context";
import { getKnewsSessionClient } from "@/lib/supabase/knews";
import { socialPublishingEnabled } from "@/lib/social/publisher";
import { NotSignedIn, PortalSwitcher } from "../portal-switcher";
import { ActionForm } from "../ads/action-form";
import { connectSocialAccount, scheduleSocialPost, setSocialAccountStatus, setSocialPostStatus } from "./actions";

export const dynamic = "force-dynamic";

type Account = { id: string; provider: string; external_account_id: string; display_name: string | null; status: string; expires_at: string | null; last_error: string | null; daily_post_limit: number };
type Post = {
  id: string;
  provider: string;
  status: string;
  message: string;
  scheduled_at: string | null;
  published_at: string | null;
  permalink: string | null;
  last_error: string | null;
  metrics: { reactions?: number; comments?: number; shares?: number; reach?: number };
  articles: { title: string; status: string } | null;
};
type Summary = { provider: string; published: number; scheduled: number; attention: number; reactions: number; comments: number; shares: number; reach: number };

const NETWORK: Record<string, string> = { facebook: "Facebook", instagram: "Instagram" };
const STATUS: Record<string, [string, string]> = {
  scheduled: ["Agendado", "bg-sky-100 text-sky-800 border-sky-200"],
  publishing: ["Enviando", "bg-amber-100 text-amber-800 border-amber-200"],
  published: ["Publicado", "bg-emerald-100 text-emerald-800 border-emerald-200"],
  failed: ["Falhou", "bg-red-100 text-red-800 border-red-200"],
  needs_check: ["Conferir na rede", "bg-amber-100 text-amber-800 border-amber-200"],
  cancelled: ["Cancelado", "bg-muted text-muted-foreground"],
  active: ["Conectada", "bg-emerald-100 text-emerald-800 border-emerald-200"],
  disabled: ["Desativada", "bg-muted text-muted-foreground"],
  expired: ["Token expirado", "bg-red-100 text-red-800 border-red-200"],
};

function StatusBadge({ status }: { status: string }) {
  const [label, cls] = STATUS[status] ?? [status, ""];
  return <Badge className={cls}>{label}</Badge>;
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—");

export default async function SocialPage() {
  const ctx = await getAdminContext();
  if (!ctx) return <NotSignedIn />;
  if (!ctx.active) return <p className="text-sm text-muted-foreground">Você não tem vínculo ativo com nenhum portal.</p>;
  const portalId = ctx.active.portalId;
  const editor = canEdit(ctx.active);
  const manager = canManage(ctx.active);
  const { knews } = await getKnewsSessionClient();
  const [accountsRes, postsRes, articlesRes, summaryRes] = await Promise.all([
    knews.from("portal_social_accounts").select("id, provider, external_account_id, display_name, status, expires_at, last_error, daily_post_limit").eq("portal_id", portalId).order("provider"),
    knews
      .from("social_posts")
      .select("id, provider, status, message, scheduled_at, published_at, permalink, last_error, metrics, articles(title, status)")
      .eq("portal_id", portalId)
      .order("created_at", { ascending: false })
      .limit(100),
    knews.from("articles").select("id, title").eq("portal_id", portalId).eq("status", "published").order("published_at", { ascending: false }).limit(50),
    knews.rpc("social_summary", { p_portal_id: portalId }),
  ]);
  const accounts = (accountsRes.data ?? []) as Account[];
  const posts = (postsRes.data ?? []) as unknown as Post[];
  const articles = (articlesRes.data ?? []) as Array<{ id: string; title: string }>;
  const summary = (summaryRes.data ?? []) as Summary[];
  const live = socialPublishingEnabled();
  const connected = accounts.filter((a) => a.status === "active");
  // Post publicado de materia que saiu do ar: a API do Instagram nao apaga, e a remocao fica com a equipe.
  const orphans = posts.filter((p) => p.status === "published" && p.articles && p.articles.status !== "published");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Redes sociais</h1>
          <p className="text-sm text-muted-foreground">Facebook e Instagram pela API oficial da Meta. Um post por matéria e rede, enviado uma única vez.</p>
        </div>
        <PortalSwitcher ctx={ctx} back="/social" />
      </div>

      {!live && (
        <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Envio desativado neste ambiente. Os posts ficam agendados e nada é enviado à Meta até a liberação (<code>KNEWS_SOCIAL_PUBLISHING=enabled</code>).
        </div>
      )}
      {orphans.length > 0 && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {orphans.length === 1 ? "1 post continua" : `${orphans.length} posts continuam`} nas redes, mas a matéria saiu do portal. Remova direto na página ou no perfil.
        </div>
      )}

      <section aria-label="Resumo" className="grid gap-4 sm:grid-cols-2">
        {(["facebook", "instagram"] as const).map((provider) => {
          const s = summary.find((x) => x.provider === provider);
          return (
            <Card key={provider}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{NETWORK[provider]}</CardTitle>
                <CardDescription>
                  {s ? `${s.published} publicados · ${s.scheduled} agendados${s.attention ? ` · ${s.attention} pedem atenção` : ""}` : "Nenhum post ainda"}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {s ? `${s.reactions} reações · ${s.comments} comentários · ${s.shares} compartilhamentos${s.reach ? ` · alcance ${s.reach}` : ""}` : "Métricas aparecem depois do primeiro envio."}
              </CardContent>
            </Card>
          );
        })}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Contas conectadas</CardTitle>
          <CardDescription>Página do Facebook e conta profissional do Instagram deste portal. O token fica cifrado no servidor e não volta a ser exibido.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma conta conectada.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rede</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Token vence</TableHead>
                  <TableHead>Limite/dia</TableHead>
                  {manager && <TableHead className="text-right">Ação</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{NETWORK[a.provider]}</TableCell>
                    <TableCell>
                      {a.display_name ?? "—"} <span className="text-xs text-muted-foreground">({a.external_account_id})</span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={a.status} />
                      {a.last_error && <p className="mt-1 text-xs text-destructive">{a.last_error}</p>}
                    </TableCell>
                    <TableCell>{a.expires_at ? fmt(a.expires_at) : "Não informado"}</TableCell>
                    <TableCell>{a.daily_post_limit}</TableCell>
                    {manager && (
                      <TableCell className="text-right">
                        {a.status !== "expired" && (
                          <form action={setSocialAccountStatus}>
                            <input type="hidden" name="account_id" value={a.id} />
                            <input type="hidden" name="status" value={a.status === "active" ? "disabled" : "active"} />
                            <Button type="submit" size="sm" variant="outline">{a.status === "active" ? "Desativar" : "Reativar"}</Button>
                          </form>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {manager && (
            <details className="rounded-md border p-4">
              <summary className="cursor-pointer text-sm font-medium">Conectar ou reconectar conta</summary>
              <ActionForm action={connectSocialAccount} submitLabel="Conectar" className="mt-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="provider">Rede</Label>
                    <Select id="provider" name="provider" defaultValue="facebook">
                      <option value="facebook">Facebook (página)</option>
                      <option value="instagram">Instagram (conta profissional)</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="external_account_id">ID da página ou da conta</Label>
                    <Input id="external_account_id" name="external_account_id" required inputMode="numeric" pattern="[0-9]{5,30}" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="display_name">Nome para exibir</Label>
                    <Input id="display_name" name="display_name" placeholder="Portal 24h Guarujá" />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="access_token">Token de acesso da página</Label>
                    <Input id="access_token" name="access_token" type="password" required autoComplete="off" />
                    <p className="text-xs text-muted-foreground">Gerado no app da Meta com pages_manage_posts ou instagram_content_publish. Não é guardado em texto puro.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="expires_on">Vencimento do token</Label>
                    <Input id="expires_on" name="expires_on" type="date" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="daily_post_limit">Limite de posts por dia</Label>
                    <Input id="daily_post_limit" name="daily_post_limit" type="number" min={1} max={100} defaultValue={25} />
                  </div>
                </div>
              </ActionForm>
            </details>
          )}
        </CardContent>
      </Card>

      {editor && (
        <Card>
          <CardHeader>
            <CardTitle>Agendar post</CardTitle>
            <CardDescription>Só matérias publicadas. O link aponta para a matéria no domínio do portal.</CardDescription>
          </CardHeader>
          <CardContent>
            {connected.length === 0 ? (
              <p className="text-sm text-muted-foreground">Conecte uma conta para agendar.</p>
            ) : articles.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma matéria publicada neste portal.</p>
            ) : (
              <ActionForm action={scheduleSocialPost} submitLabel="Agendar">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="article_id">Matéria</Label>
                    <Select id="article_id" name="article_id" required defaultValue="">
                      <option value="" disabled>Escolha…</option>
                      {articles.map((a) => (
                        <option key={a.id} value={a.id}>{a.title}</option>
                      ))}
                    </Select>
                  </div>
                  <fieldset className="space-y-1.5">
                    <legend className="text-sm font-medium">Redes</legend>
                    <div className="flex gap-4">
                      {connected.map((a) => (
                        <label key={a.id} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" name="providers" value={a.provider} defaultChecked={a.provider === "facebook"} /> {NETWORK[a.provider]}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="space-y-1.5">
                    <Label htmlFor="scheduled_at">Enviar em (horário de Brasília)</Label>
                    <Input id="scheduled_at" name="scheduled_at" type="datetime-local" />
                    <p className="text-xs text-muted-foreground">Em branco: no próximo ciclo da fila.</p>
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="message">Texto</Label>
                    <Textarea id="message" name="message" required maxLength={2000} rows={4} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="image_url">Imagem (https)</Label>
                    <Input id="image_url" name="image_url" type="url" placeholder="https://" />
                    <p className="text-xs text-muted-foreground">Obrigatória no Instagram. Use só imagem licenciada ou produzida pela equipe.</p>
                  </div>
                  <label className="flex items-start gap-2 self-center text-sm">
                    <input type="checkbox" name="image_rights_confirmed" className="mt-1" /> Confirmo que temos direito de uso desta imagem.
                  </label>
                </div>
              </ActionForm>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
          <CardDescription>Métricas atualizadas a cada 6 horas nos 14 dias seguintes ao envio.</CardDescription>
        </CardHeader>
        <CardContent>
          {posts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum post agendado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Matéria</TableHead>
                  <TableHead>Rede</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Quando</TableHead>
                  <TableHead>Métricas</TableHead>
                  {editor && <TableHead className="text-right">Ação</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {posts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-xs">
                      <p className="truncate font-medium">{p.articles?.title ?? "Matéria removida"}</p>
                      <p className="truncate text-xs text-muted-foreground">{p.message}</p>
                    </TableCell>
                    <TableCell>{NETWORK[p.provider]}</TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                      {p.last_error && <p className="mt-1 max-w-xs text-xs text-muted-foreground">{p.last_error}</p>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.published_at ? fmt(p.published_at) : fmt(p.scheduled_at)}
                      {p.permalink && (
                        <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="block text-xs underline">Ver na rede</a>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.status === "published" && p.metrics.reactions !== undefined
                        ? `${p.metrics.reactions} reações · ${p.metrics.comments ?? 0} coment. · ${p.metrics.shares ?? 0} compart.${p.metrics.reach ? ` · alcance ${p.metrics.reach}` : ""}`
                        : "—"}
                    </TableCell>
                    {editor && (
                      <TableCell className="text-right">
                        {p.status === "scheduled" && (
                          <form action={setSocialPostStatus}>
                            <input type="hidden" name="post_id" value={p.id} />
                            <input type="hidden" name="status" value="cancelled" />
                            <Button type="submit" size="sm" variant="outline">Cancelar</Button>
                          </form>
                        )}
                        {["failed", "cancelled", "needs_check"].includes(p.status) && (
                          <form action={setSocialPostStatus}>
                            <input type="hidden" name="post_id" value={p.id} />
                            <input type="hidden" name="status" value="scheduled" />
                            <Button type="submit" size="sm" variant="outline" title={p.status === "needs_check" ? "Confira antes na rede para não duplicar" : undefined}>
                              {p.status === "needs_check" ? "Conferi, reenviar" : "Reagendar"}
                            </Button>
                          </form>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
