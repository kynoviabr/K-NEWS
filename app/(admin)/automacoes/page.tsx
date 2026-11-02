import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canOperate, getAdminContext } from "@/lib/admin-context";
import { getKnewsSessionClient } from "@/lib/supabase/knews";
import { opsAlerts, type OpsOverview } from "@/lib/ops";
import { socialPublishingEnabled } from "@/lib/social/publisher";
import { NotSignedIn } from "../portal-switcher";
import { cancelJob, requeueJob } from "./actions";

export const dynamic = "force-dynamic";

const TYPE: Record<string, string> = {
  rss_fetch: "Coleta de fontes",
  draft: "Rascunho por IA",
  social_publish: "Envio para redes",
  social_metrics: "Métricas das redes",
};
const STATUSES = ["queued", "retrying", "running", "completed", "dead_letter", "cancelled"] as const;
const STATUS_LABEL: Record<string, string> = { queued: "Na fila", retrying: "Repetindo", running: "Rodando", completed: "Concluídos", dead_letter: "Dead-letter", cancelled: "Cancelados" };

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—");

export default async function AutomacoesPage() {
  const ctx = await getAdminContext();
  if (!ctx) return <NotSignedIn />;
  const header = (
    <div>
      <h1 className="font-heading text-2xl font-bold tracking-tight">Automações</h1>
      <p className="text-sm text-muted-foreground">Fila durável: coleta, rascunhos e redes sociais. Reprocessar e cancelar ficam registrados na auditoria.</p>
    </div>
  );
  if (!canOperate(ctx)) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-muted-foreground">Área da administração da rede e da operação técnica.</p>
      </div>
    );
  }
  const { knews } = await getKnewsSessionClient();
  const { data } = await knews.rpc("ops_overview");
  const o = data as OpsOverview | null;
  if (!o) return <div className="space-y-6">{header}<p className="text-sm text-destructive">Não foi possível ler a fila.</p></div>;
  const alerts = opsAlerts(o);
  const types = [...new Set([...Object.keys(TYPE), ...o.by_type.map((r) => r.job_type)])];
  const count = (type: string, status: string) => o.by_type.find((r) => r.job_type === type && r.status === status)?.count ?? 0;

  return (
    <div className="space-y-6">
      {header}
      {alerts.length === 0 ? (
        <div role="status" className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">Tudo em dia: fila andando, sem dead-letter nem contas expiradas.</div>
      ) : (
        <ul role="alert" className="space-y-2">
          {alerts.map((a) => (
            <li key={a.message} className={a.level === "critical" ? "rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900" : "rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"}>
              {a.message}
            </li>
          ))}
        </ul>
      )}

      <section aria-label="Resumo" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["Vencidos na fila", o.due_backlog, o.oldest_due_seconds > 0 ? `mais antigo há ${Math.round(o.oldest_due_seconds / 60)} min` : "nada esperando"],
            ["Dead-letter", o.dead_letter, "esgotaram as tentativas"],
            ["Reservas de anúncio abertas", o.ad_reservations_open, "aguardando impressão"],
            ["Envio social", socialPublishingEnabled() ? "Liberado" : "Desativado", "KNEWS_SOCIAL_PUBLISHING"],
          ] as const
        ).map(([label, value, hint]) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-2xl">{value}</CardTitle>
              <p className="text-xs text-muted-foreground">{hint}</p>
            </CardHeader>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Jobs por tipo</CardTitle>
          <CardDescription>Situação atual na fila, de todos os portais.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                {STATUSES.map((s) => (
                  <TableHead key={s} className="text-right">{STATUS_LABEL[s]}</TableHead>
                ))}
                <TableHead>Último concluído</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((t) => (
                <TableRow key={t}>
                  <TableCell>{TYPE[t] ?? t}</TableCell>
                  {STATUSES.map((s) => (
                    <TableCell key={s} className={s === "dead_letter" && count(t, s) > 0 ? "text-right font-semibold text-destructive" : "text-right"}>{count(t, s)}</TableCell>
                  ))}
                  <TableCell className="text-sm">{fmt(o.last_completed[t])}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dead-letter</CardTitle>
          <CardDescription>Reprocessar devolve o job à fila com as tentativas zeradas; os handlers não repetem efeitos já feitos.</CardDescription>
        </CardHeader>
        <CardContent>
          {o.recent_dead_letters.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum job em dead-letter.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Portal</TableHead>
                  <TableHead>Erro</TableHead>
                  <TableHead>Quando</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.recent_dead_letters.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell>{TYPE[j.job_type] ?? j.job_type}<div className="text-xs text-muted-foreground">{j.attempts} tentativa(s)</div></TableCell>
                    <TableCell>{j.portal ?? "Rede"}</TableCell>
                    <TableCell className="max-w-md text-sm">{j.last_error ?? "—"}</TableCell>
                    <TableCell className="text-sm">{fmt(j.failed_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <form action={requeueJob}>
                          <input type="hidden" name="id" value={j.id} />
                          <Button type="submit" size="sm">Reprocessar</Button>
                        </form>
                        <form action={cancelJob}>
                          <input type="hidden" name="id" value={j.id} />
                          <Button type="submit" size="sm" variant="outline">Descartar</Button>
                        </form>
                      </div>
                    </TableCell>
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
