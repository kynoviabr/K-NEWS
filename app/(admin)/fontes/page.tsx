import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canEdit, getAdminContext } from "@/lib/admin-context";
import { getKnewsSessionClient } from "@/lib/supabase/knews";
import { NotSignedIn, PortalSwitcher } from "../portal-switcher";
import { SourceForm } from "./source-form";
import { fetchSourceNow, toggleSource } from "./actions";

export const dynamic = "force-dynamic";

type SourceRow = {
  id: string;
  name: string | null;
  url: string;
  license: string | null;
  enabled: boolean;
  fetch_interval_minutes: number;
  last_fetched_at: string | null;
  last_status: string | null;
  last_error: string | null;
};

export default async function FontesPage() {
  const ctx = await getAdminContext();
  if (!ctx) return <NotSignedIn />;
  const editable = canEdit(ctx.active);

  let sources: SourceRow[] = [];
  let intake: Record<string, number> = {};
  if (ctx.active) {
    const { knews } = await getKnewsSessionClient();
    const { data } = await knews
      .from("sources")
      .select("id, name, url, license, enabled, fetch_interval_minutes, last_fetched_at, last_status, last_error")
      .eq("portal_id", ctx.active.portalId)
      .order("created_at", { ascending: false });
    sources = (data ?? []) as SourceRow[];
    const { data: items } = await knews.from("source_items").select("status").eq("portal_id", ctx.active.portalId).limit(1000);
    intake = (items ?? []).reduce((acc: Record<string, number>, i: { status: string }) => ({ ...acc, [i.status]: (acc[i.status] ?? 0) + 1 }), {});
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Fontes</h1>
          <p className="text-sm text-muted-foreground">Feeds RSS/Atom coletados com proteção SSRF, deduplicação persistente e registro de cada coleta.</p>
        </div>
        <PortalSwitcher ctx={ctx} back="/fontes" />
      </div>

      {!ctx.active && <p className="text-sm text-muted-foreground">Sua conta não tem vínculo com nenhum portal.</p>}

      {ctx.active && (
        <div className="grid gap-4 sm:grid-cols-4">
          {(["new", "drafted", "duplicate", "discarded"] as const).map((k) => (
            <Card key={k}>
              <CardHeader className="pb-2">
                <CardDescription>{{ new: "Na fila", drafted: "Viraram rascunho", duplicate: "Duplicados", discarded: "Fora do território" }[k]}</CardDescription>
                <CardTitle className="text-2xl">{intake[k] ?? 0}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {editable && (
        <Card>
          <CardHeader>
            <CardTitle>Nova fonte</CardTitle>
            <CardDescription>Registre a licença ou os termos de uso. Conteúdo de terceiros nunca é republicado integralmente.</CardDescription>
          </CardHeader>
          <CardContent>
            <SourceForm />
          </CardContent>
        </Card>
      )}

      {ctx.active && (
        <Card>
          <CardHeader>
            <CardTitle>Fontes de {ctx.active.portalName}</CardTitle>
          </CardHeader>
          <CardContent>
            {sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma fonte cadastrada.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fonte</TableHead>
                    <TableHead>Última coleta</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sources.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="font-medium">{s.name ?? s.url}</div>
                        <div className="max-w-md truncate text-xs text-muted-foreground">{s.url}</div>
                        {s.license && <div className="text-xs text-muted-foreground">Licença: {s.license}</div>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {s.last_fetched_at ? new Date(s.last_fetched_at).toLocaleString("pt-BR") : "nunca"}
                        <div className="text-xs text-muted-foreground">a cada {s.fetch_interval_minutes} min</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge className={s.enabled ? "" : "bg-muted text-muted-foreground"}>{s.enabled ? "Ativa" : "Pausada"}</Badge>
                          {s.last_status === "failed" && <span className="max-w-xs text-xs text-destructive">Falhou: {s.last_error}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {editable && (
                          <div className="flex justify-end gap-2">
                            <form action={fetchSourceNow}>
                              <input type="hidden" name="id" value={s.id} />
                              <Button type="submit" size="sm" variant="outline" disabled={!s.enabled}>Coletar agora</Button>
                            </form>
                            <form action={toggleSource}>
                              <input type="hidden" name="id" value={s.id} />
                              <input type="hidden" name="enabled" value={String(!s.enabled)} />
                              <Button type="submit" size="sm" variant="ghost">{s.enabled ? "Pausar" : "Ativar"}</Button>
                            </form>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
