import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canManage, canSell, getAdminContext, isSuperAdmin } from "@/lib/admin-context";
import { getKnewsSessionClient } from "@/lib/supabase/knews";
import { formatCents, summarizeRevenue, type RevenueRow } from "@/lib/ads/visitor";
import { NotSignedIn, PortalSwitcher } from "../portal-switcher";
import { ActionForm } from "../ads/action-form";
import { createRevenue, setRevenueStatus } from "../ads/actions";
import { CampaignStatusBadge } from "../ads/status-badge";

export const dynamic = "force-dynamic";

const SOURCE: Record<string, string> = { direct: "Venda direta", adsense: "AdSense", mgid: "MGID", affiliate: "Afiliados", own_product: "Produtos próprios", other: "Outros" };

function period(searchParams: Record<string, string | string[] | undefined>): { from: string; to: string } {
  const valid = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  return { from: valid(searchParams.de) ?? `${today.slice(0, 8)}01`, to: valid(searchParams.ate) ?? today };
}

export default async function ComercialPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getAdminContext();
  if (!ctx) return <NotSignedIn />;
  const { from, to } = period(await searchParams);
  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Comercial</h1>
        <p className="text-sm text-muted-foreground">Entrega, receitas e comissões. Receita só conta depois que a gestão do portal confirma; cliques não são vendas.</p>
      </div>
      <PortalSwitcher ctx={ctx} back="/comercial" />
    </div>
  );
  if (!ctx.active || !canSell(ctx.active)) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-muted-foreground">Área restrita à equipe comercial do portal.</p>
      </div>
    );
  }

  const portalId = ctx.active.portalId;
  const { knews } = await getKnewsSessionClient();
  const [statsRes, revenueRes, contractsRes, commissionsRes, linkClicksRes] = await Promise.all([
    knews.from("ad_daily_stats").select("campaign_id, reserved, impressions, clicks, ad_campaigns(name, kind)").eq("portal_id", portalId).gte("day", from).lte("day", to),
    knews
      .from("ad_revenue_entries")
      .select("id, source, status, amount_cents, contract_id, period_start, period_end, reference")
      .eq("portal_id", portalId)
      .lte("period_start", to)
      .gte("period_end", from)
      .order("period_start", { ascending: false }),
    knews.from("ad_contracts").select("id, reference").eq("portal_id", portalId).order("reference"),
    // Livro de comissoes (knews.partner_commissions): gerado pela receita confirmada.
    knews
      .from("partner_commissions")
      .select("id, base_cents, pct, amount_cents, status, needs_review, ad_contracts(reference)")
      .eq("portal_id", portalId)
      .lte("period_start", to)
      .gte("period_end", from)
      .neq("status", "cancelled"),
    knews.from("ad_link_clicks").select("link_id, ad_links(title, code)").eq("portal_id", portalId).gte("at", `${from}T03:00:00Z`).lte("at", `${to}T23:59:59-03:00`).limit(10000),
  ]);

  type StatRow = { campaign_id: string; reserved: number; impressions: number; clicks: number; ad_campaigns: { name: string; kind: string } | null };
  const delivery = new Map<string, { name: string; kind: string; reserved: number; impressions: number; clicks: number }>();
  for (const s of (statsRes.data ?? []) as unknown as StatRow[]) {
    const row = delivery.get(s.campaign_id) ?? { name: s.ad_campaigns?.name ?? s.campaign_id, kind: s.ad_campaigns?.kind ?? "direct", reserved: 0, impressions: 0, clicks: 0 };
    row.reserved += s.reserved;
    row.impressions += s.impressions;
    row.clicks += s.clicks;
    delivery.set(s.campaign_id, row);
  }
  const revenue = (revenueRes.data ?? []) as Array<RevenueRow & { id: string; period_start: string; period_end: string; reference: string | null }>;
  const totals = summarizeRevenue(revenue.filter((r) => r.status !== "cancelled"));
  const contracts = (contractsRes.data ?? []) as Array<{ id: string; reference: string }>;
  type CommissionRow = { id: string; base_cents: number; pct: number; amount_cents: number; status: string; needs_review: boolean; ad_contracts: { reference: string } | null };
  const commissions = (commissionsRes.data ?? []) as unknown as CommissionRow[];
  // Receita que gera comissao so e confirmada pela gestao (o banco tambem barra).
  const confirmer = canManage(ctx.active) || isSuperAdmin(ctx);
  const bySource = new Map<string, number>();
  for (const r of revenue) if (r.status === "confirmed" || r.status === "paid") bySource.set(r.source, (bySource.get(r.source) ?? 0) + Number(r.amount_cents));
  const linkClicks = new Map<string, { title: string; code: string; clicks: number }>();
  for (const c of (linkClicksRes.data ?? []) as unknown as Array<{ link_id: string; ad_links: { title: string; code: string } | null }>) {
    const row = linkClicks.get(c.link_id) ?? { title: c.ad_links?.title ?? "", code: c.ad_links?.code ?? "", clicks: 0 };
    row.clicks += 1;
    linkClicks.set(c.link_id, row);
  }
  const date = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR");

  return (
    <div className="space-y-6">
      {header}

      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="space-y-1.5">
          <Label htmlFor="de">De</Label>
          <Input id="de" name="de" type="date" defaultValue={from} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ate">Até</Label>
          <Input id="ate" name="ate" type="date" defaultValue={to} />
        </div>
        <Button type="submit" variant="outline">Filtrar</Button>
      </form>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Receita confirmada</CardDescription>
            <CardTitle className="text-2xl">{formatCents(totals.confirmedCents)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Receita estimada (não confirmada)</CardDescription>
            <CardTitle className="text-2xl text-muted-foreground">{formatCents(totals.estimatedCents)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Comissões de parceiros</CardDescription>
            <CardTitle className="text-2xl">{formatCents(commissions.reduce((a, c) => a + Number(c.amount_cents), 0))}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Entrega por campanha</CardTitle>
          <CardDescription>{date(from)} a {date(to)}</CardDescription>
        </CardHeader>
        <CardContent>
          {delivery.size === 0 ? (
            <p className="text-sm text-muted-foreground">Sem entregas no período.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campanha</TableHead>
                  <TableHead className="text-right">Servidas</TableHead>
                  <TableHead className="text-right">Impressões</TableHead>
                  <TableHead className="text-right">Cliques</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...delivery.entries()].map(([id, d]) => (
                  <TableRow key={id}>
                    <TableCell>{d.name}{d.kind === "house" && <span className="ml-2 text-xs text-muted-foreground">(casa)</span>}</TableCell>
                    <TableCell className="text-right">{d.reserved}</TableCell>
                    <TableCell className="text-right">{d.impressions}</TableCell>
                    <TableCell className="text-right">{d.clicks}</TableCell>
                    <TableCell className="text-right">{d.impressions ? ((d.clicks / d.impressions) * 100).toFixed(2) : "0.00"}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Receita confirmada por origem</CardTitle>
          </CardHeader>
          <CardContent>
            {bySource.size === 0 ? (
              <p className="text-sm text-muted-foreground">Nada confirmado no período.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {[...bySource.entries()].map(([s, v]) => (
                  <li key={s} className="flex justify-between"><span>{SOURCE[s]}</span><strong>{formatCents(v)}</strong></li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cliques em links afiliados e produtos</CardTitle>
            <CardDescription>Indicador de interesse, não de venda.</CardDescription>
          </CardHeader>
          <CardContent>
            {linkClicks.size === 0 ? (
              <p className="text-sm text-muted-foreground">Sem cliques no período.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {[...linkClicks.values()].map((l) => (
                  <li key={l.code} className="flex justify-between"><span>{l.title} <code className="text-xs">/r/{l.code}</code></span><strong>{l.clicks}</strong></li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {commissions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Comissões por contrato</CardTitle>
            <CardDescription>Aprovação e pagamento ficam com a rede, em Parceiros.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contrato</TableHead>
                  <TableHead className="text-right">Base confirmada</TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="text-right">Comissão</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commissions.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.ad_contracts?.reference ?? "—"}</TableCell>
                    <TableCell className="text-right">{formatCents(Number(c.base_cents))}</TableCell>
                    <TableCell className="text-right">{Number(c.pct)}%</TableCell>
                    <TableCell className="text-right">{formatCents(Number(c.amount_cents))}</TableCell>
                    <TableCell>
                      {c.status === "pending" ? <span className="text-sm">A aprovar</span> : <CampaignStatusBadge status={c.status} />}
                      {c.needs_review && <span className="ml-2 text-xs text-destructive">receita mudou: revisar</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Lançar receita</CardTitle>
          <CardDescription>AdSense, MGID e afiliados: lance pelo relatório do provedor. Venda direta: vincule ao contrato.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={createRevenue} submitLabel="Lançar">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="source">Origem</Label>
                <Select id="source" name="source" defaultValue="direct">
                  {Object.entries(SOURCE).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rv_contract">Contrato</Label>
                <Select id="rv_contract" name="contract_id" defaultValue="">
                  <option value="">—</option>
                  {contracts.map((c) => (
                    <option key={c.id} value={c.id}>{c.reference}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="period_start">Período: início</Label>
                <Input id="period_start" name="period_start" type="date" required defaultValue={from} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="period_end">Período: fim</Label>
                <Input id="period_end" name="period_end" type="date" required defaultValue={to} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="amount_cents">Valor (R$)</Label>
                <Input id="amount_cents" name="amount_cents" inputMode="decimal" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rv_status">Situação</Label>
                <Select id="rv_status" name="status" defaultValue="estimated">
                  <option value="estimated">Estimada</option>
                  {confirmer && <option value="confirmed">Confirmada</option>}
                  {confirmer && <option value="paid">Paga</option>}
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="rv_reference">Referência (relatório, NF)</Label>
                <Input id="rv_reference" name="reference" />
              </div>
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lançamentos do período</CardTitle>
        </CardHeader>
        <CardContent>
          {revenue.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum lançamento.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Origem</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revenue.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{SOURCE[r.source]}{r.reference && <div className="text-xs text-muted-foreground">{r.reference}</div>}</TableCell>
                    <TableCell className="text-sm">{date(r.period_start)} → {date(r.period_end)}</TableCell>
                    <TableCell className="text-right">{formatCents(Number(r.amount_cents))}</TableCell>
                    <TableCell><CampaignStatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {confirmer && r.status === "estimated" && (
                          <form action={setRevenueStatus}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="status" value="confirmed" />
                            <Button size="sm" type="submit">Confirmar</Button>
                          </form>
                        )}
                        {confirmer && r.status === "confirmed" && (
                          <form action={setRevenueStatus}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="status" value="paid" />
                            <Button size="sm" type="submit" variant="outline">Marcar paga</Button>
                          </form>
                        )}
                        {r.status !== "cancelled" && r.status !== "paid" && (
                          <form action={setRevenueStatus}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="status" value="cancelled" />
                            <Button size="sm" type="submit" variant="ghost">Cancelar</Button>
                          </form>
                        )}
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
