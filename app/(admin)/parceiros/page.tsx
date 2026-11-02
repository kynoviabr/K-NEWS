import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAdminContext, isSuperAdmin } from "@/lib/admin-context";
import { getKnewsSessionClient } from "@/lib/supabase/knews";
import { formatCents } from "@/lib/ads/visitor";
import { NotSignedIn } from "../portal-switcher";
import { ActionForm } from "../ads/action-form";
import { addPartnerUser, addTerritory, createPartner, endTerritory, payCommission, removePartnerUser, setCommissionStatus, setPartnerStatus } from "./actions";

export const dynamic = "force-dynamic";

type Partner = { id: string; name: string; status: string; document: string | null; contact_name: string | null; contact_email: string | null; contact_phone: string | null };
type Territory = { id: string; partner_id: string; status: string; commission_pct: number; created_at: string; ended_at: string | null; cities: { name: string } | null; regions: { name: string } | null };
type Commission = {
  id: string;
  partner_id: string;
  base_cents: number;
  pct: number;
  amount_cents: number;
  status: string;
  needs_review: boolean;
  period_start: string;
  period_end: string;
  payment_reference: string | null;
  ad_contracts: { reference: string } | null;
  portals: { name: string } | null;
};
type Indicators = {
  portals: Array<{ portal_id: string; portal_name: string; contracts_signed: number; contracted_cents: number; revenue_confirmed_cents: number; revenue_estimated_cents: number; campaigns_active: number; impressions: number; clicks: number }>;
  commissions: { pending_cents: number; approved_cents: number; paid_cents: number; needs_review: number };
};

const STATUS: Record<string, [string, string]> = {
  active: ["Ativo", "bg-emerald-100 text-emerald-800 border-emerald-200"],
  suspended: ["Suspenso", "bg-amber-100 text-amber-800 border-amber-200"],
  ended: ["Encerrado", "bg-muted text-muted-foreground"],
  pending: ["A aprovar", "bg-amber-100 text-amber-800 border-amber-200"],
  approved: ["Aprovada", "bg-sky-100 text-sky-800 border-sky-200"],
  paid: ["Paga", "bg-emerald-100 text-emerald-800 border-emerald-200"],
  cancelled: ["Cancelada", "bg-muted text-muted-foreground"],
};

function StatusBadge({ status }: { status: string }) {
  const [label, cls] = STATUS[status] ?? [status, ""];
  return <Badge className={cls}>{label}</Badge>;
}

function monthRange(): { from: string; to: string } {
  const now = new Date(Date.now() - 3 * 3600_000);
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  return { from, to: now.toISOString().slice(0, 10) };
}

const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const date = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR");
const ctr = (clicks: number, impressions: number) => (impressions > 0 ? `${((clicks / impressions) * 100).toFixed(2).replace(".", ",")}%` : "—");

export default async function ParceirosPage({ searchParams }: { searchParams: Promise<{ parceiro?: string; de?: string; ate?: string }> }) {
  const ctx = await getAdminContext();
  if (!ctx) return <NotSignedIn />;
  const sp = await searchParams;
  const range = monthRange();
  const from = isDate(sp.de) ? sp.de : range.from;
  const to = isDate(sp.ate) ? sp.ate : range.to;
  const admin = isSuperAdmin(ctx);
  const { knews } = await getKnewsSessionClient();
  const { data: myPartnerId } = await knews.rpc("my_partner_id");

  const header = (
    <div>
      <h1 className="font-heading text-2xl font-bold tracking-tight">Parceiros regionais</h1>
      <p className="text-sm text-muted-foreground">Cada território tem um parceiro só. O acesso comercial do parceiro vem do território e termina junto com ele.</p>
    </div>
  );

  if (!admin && !myPartnerId) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-muted-foreground">Área da administração da rede e dos parceiros comerciais.</p>
      </div>
    );
  }

  const { data: partnersData } = await knews.from("partners").select("id, name, status, document, contact_name, contact_email, contact_phone").order("name");
  const partners = (partnersData ?? []) as Partner[];
  const selectedId = admin ? (partners.find((p) => p.id === sp.parceiro)?.id ?? null) : (myPartnerId as string);
  const selected = partners.find((p) => p.id === selectedId) ?? null;

  const [territoriesRes, commissionsRes, regionsRes, citiesRes] = await Promise.all([
    knews.from("partner_territories").select("id, partner_id, status, commission_pct, created_at, ended_at, cities(name), regions(name)").order("created_at", { ascending: false }),
    knews
      .from("partner_commissions")
      .select("id, partner_id, base_cents, pct, amount_cents, status, needs_review, period_start, period_end, payment_reference, ad_contracts(reference), portals(name)")
      .lte("period_start", to)
      .gte("period_end", from)
      .order("period_start", { ascending: false }),
    admin ? knews.from("regions").select("id, name").order("name") : Promise.resolve({ data: [] }),
    admin ? knews.from("cities").select("id, name, region_id").order("name") : Promise.resolve({ data: [] }),
  ]);
  const territories = (territoriesRes.data ?? []) as unknown as Territory[];
  const commissions = (commissionsRes.data ?? []) as unknown as Commission[];
  const regions = (regionsRes.data ?? []) as Array<{ id: string; name: string }>;
  const cities = (citiesRes.data ?? []) as Array<{ id: string; name: string; region_id: string }>;
  const regionName = new Map(regions.map((r) => [r.id, r.name]));

  let indicators: Indicators | null = null;
  let people: Array<{ user_id: string; email: string }> = [];
  if (selected) {
    const [ind, ppl] = await Promise.all([
      knews.rpc("partner_indicators", { p_partner_id: selected.id, p_from: from, p_to: to }),
      knews.rpc("partner_user_emails", { p_partner_id: selected.id }),
    ]);
    indicators = (ind.data ?? null) as Indicators | null;
    people = (ppl.data ?? []) as Array<{ user_id: string; email: string }>;
  }
  const selectedTerritories = territories.filter((t) => t.partner_id === selectedId);
  const selectedCommissions = commissions.filter((c) => c.partner_id === selectedId);
  const territoryLabel = (t: Territory) => (t.cities ? t.cities.name : `Região ${t.regions?.name ?? ""}`);
  const qs = (extra: Record<string, string>) => new URLSearchParams({ de: from, ate: to, ...extra }).toString();

  return (
    <div className="space-y-6">
      {header}

      <form className="flex flex-wrap items-end gap-3" method="get">
        {selectedId && admin && <input type="hidden" name="parceiro" value={selectedId} />}
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

      {admin && (
        <Card>
          <CardHeader>
            <CardTitle>Parceiros</CardTitle>
            <CardDescription>Comissões do período; aprovar e pagar fica na página de cada parceiro.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {partners.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum parceiro cadastrado.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Parceiro</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Territórios ativos</TableHead>
                    <TableHead className="text-right">A aprovar</TableHead>
                    <TableHead className="text-right">A pagar</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {partners.map((p) => {
                    const own = commissions.filter((c) => c.partner_id === p.id);
                    const sum = (s: string) => own.filter((c) => c.status === s).reduce((a, c) => a + Number(c.amount_cents), 0);
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <Link href={`/parceiros?${qs({ parceiro: p.id })}`} className="font-medium underline-offset-4 hover:underline">{p.name}</Link>
                        </TableCell>
                        <TableCell><StatusBadge status={p.status} /></TableCell>
                        <TableCell className="text-sm">{territories.filter((t) => t.partner_id === p.id && t.status === "active").map(territoryLabel).join(", ") || "—"}</TableCell>
                        <TableCell className="text-right">{formatCents(sum("pending"))}</TableCell>
                        <TableCell className="text-right">{formatCents(sum("approved"))}</TableCell>
                        <TableCell className="text-right">
                          {p.status !== "ended" && (
                            <form action={setPartnerStatus} className="inline">
                              <input type="hidden" name="partner_id" value={p.id} />
                              <input type="hidden" name="status" value={p.status === "active" ? "suspended" : "active"} />
                              <Button type="submit" size="sm" variant="outline">{p.status === "active" ? "Suspender" : "Reativar"}</Button>
                            </form>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            <details className="rounded-md border p-4">
              <summary className="cursor-pointer text-sm font-medium">Cadastrar parceiro</summary>
              <ActionForm action={createPartner} submitLabel="Cadastrar" className="mt-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Nome ou razão social</Label>
                    <Input id="name" name="name" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="document">CPF ou CNPJ</Label>
                    <Input id="document" name="document" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact_name">Contato</Label>
                    <Input id="contact_name" name="contact_name" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact_email">E-mail</Label>
                    <Input id="contact_email" name="contact_email" type="email" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact_phone">Telefone</Label>
                    <Input id="contact_phone" name="contact_phone" />
                  </div>
                </div>
              </ActionForm>
            </details>
          </CardContent>
        </Card>
      )}

      {selected && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-heading text-xl font-semibold">{selected.name}</h2>
            <StatusBadge status={selected.status} />
            {selected.contact_email && <span className="text-sm text-muted-foreground">{selected.contact_name ?? ""} {selected.contact_email}</span>}
          </div>

          {indicators && (
            <>
              <section aria-label="Comissões do período" className="grid gap-4 sm:grid-cols-3">
                {(
                  [
                    ["A aprovar", indicators.commissions.pending_cents],
                    ["Aprovadas, a pagar", indicators.commissions.approved_cents],
                    ["Pagas", indicators.commissions.paid_cents],
                  ] as const
                ).map(([label, cents]) => (
                  <Card key={label}>
                    <CardHeader className="pb-2">
                      <CardDescription>{label}</CardDescription>
                      <CardTitle className="text-2xl">{formatCents(Number(cents))}</CardTitle>
                    </CardHeader>
                  </Card>
                ))}
              </section>
              {indicators.commissions.needs_review > 0 && (
                <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  {indicators.commissions.needs_review} comissão(ões) aprovada(s) ou paga(s) tiveram a receita alterada depois. Revise com o parceiro.
                </div>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Indicadores por portal</CardTitle>
                  <CardDescription>Contratos e receita da carteira do parceiro; entrega de anúncios de todo o portal no período.</CardDescription>
                </CardHeader>
                <CardContent>
                  {indicators.portals.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sem território ativo.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Portal</TableHead>
                          <TableHead className="text-right">Contratos assinados</TableHead>
                          <TableHead className="text-right">Valor contratado</TableHead>
                          <TableHead className="text-right">Receita confirmada</TableHead>
                          <TableHead className="text-right">Estimada</TableHead>
                          <TableHead className="text-right">Campanhas no ar</TableHead>
                          <TableHead className="text-right">Impressões</TableHead>
                          <TableHead className="text-right">CTR</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {indicators.portals.map((p) => (
                          <TableRow key={p.portal_id}>
                            <TableCell>{p.portal_name}</TableCell>
                            <TableCell className="text-right">{p.contracts_signed}</TableCell>
                            <TableCell className="text-right">{formatCents(Number(p.contracted_cents))}</TableCell>
                            <TableCell className="text-right">{formatCents(Number(p.revenue_confirmed_cents))}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{formatCents(Number(p.revenue_estimated_cents))}</TableCell>
                            <TableCell className="text-right">{p.campaigns_active}</TableCell>
                            <TableCell className="text-right">{Number(p.impressions).toLocaleString("pt-BR")}</TableCell>
                            <TableCell className="text-right">{ctr(Number(p.clicks), Number(p.impressions))}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Comissões do período</CardTitle>
              <CardDescription>Geradas quando a gestão confirma a receita de um contrato do parceiro. Clique não é venda: só receita confirmada conta.</CardDescription>
            </CardHeader>
            <CardContent>
              {selectedCommissions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma comissão no período.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contrato</TableHead>
                      <TableHead>Período</TableHead>
                      <TableHead className="text-right">Base</TableHead>
                      <TableHead className="text-right">Comissão</TableHead>
                      <TableHead>Situação</TableHead>
                      {admin && <TableHead className="text-right">Ação</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedCommissions.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          {c.ad_contracts?.reference ?? "—"}
                          <div className="text-xs text-muted-foreground">{c.portals?.name}</div>
                        </TableCell>
                        <TableCell className="text-sm">{date(c.period_start)} → {date(c.period_end)}</TableCell>
                        <TableCell className="text-right">{formatCents(Number(c.base_cents))} · {Number(c.pct)}%</TableCell>
                        <TableCell className="text-right font-medium">{formatCents(Number(c.amount_cents))}</TableCell>
                        <TableCell>
                          <StatusBadge status={c.status} />
                          {c.payment_reference && <div className="text-xs text-muted-foreground">{c.payment_reference}</div>}
                          {c.needs_review && <div className="text-xs text-destructive">Receita alterada: revisar</div>}
                        </TableCell>
                        {admin && (
                          <TableCell className="text-right">
                            <div className="flex flex-wrap justify-end gap-2">
                              {c.status === "pending" && (
                                <form action={setCommissionStatus}>
                                  <input type="hidden" name="id" value={c.id} />
                                  <input type="hidden" name="status" value="approved" />
                                  <Button type="submit" size="sm">Aprovar</Button>
                                </form>
                              )}
                              {c.status === "approved" && (
                                <ActionForm action={payCommission} submitLabel="Registrar pagamento" className="flex items-end gap-2 space-y-0">
                                  <input type="hidden" name="id" value={c.id} />
                                  <Input name="payment_reference" placeholder="Comprovante" aria-label="Comprovante do pagamento" className="h-8 w-36" required />
                                </ActionForm>
                              )}
                              {(c.status === "pending" || c.status === "approved") && (
                                <form action={setCommissionStatus}>
                                  <input type="hidden" name="id" value={c.id} />
                                  <input type="hidden" name="status" value="cancelled" />
                                  <Button type="submit" size="sm" variant="outline">Cancelar</Button>
                                </form>
                              )}
                            </div>
                          </TableCell>
                        )}
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
                <CardTitle>Territórios</CardTitle>
                <CardDescription>Encerrar tira o acesso do parceiro aos portais na hora. Território encerrado não reabre.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedTerritories.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum território.</p>
                ) : (
                  <ul className="divide-y text-sm">
                    {selectedTerritories.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                        <span>
                          {territoryLabel(t)} · {Number(t.commission_pct)}%{" "}
                          <span className="text-xs text-muted-foreground">{t.status === "active" ? "ativo" : `encerrado em ${new Date(t.ended_at ?? t.created_at).toLocaleDateString("pt-BR")}`}</span>
                        </span>
                        {admin && t.status === "active" && (
                          <form action={endTerritory}>
                            <input type="hidden" name="territory_id" value={t.id} />
                            <Button type="submit" size="sm" variant="outline">Encerrar</Button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {admin && (
                  <ActionForm action={addTerritory} submitLabel="Atribuir território">
                    <input type="hidden" name="partner_id" value={selected.id} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="scope">Cidade ou região</Label>
                        <Select id="scope" name="scope" required defaultValue="">
                          <option value="" disabled>Escolha…</option>
                          <optgroup label="Cidades">
                            {cities.map((c) => (
                              <option key={c.id} value={`city:${c.id}`}>{c.name} ({regionName.get(c.region_id) ?? ""})</option>
                            ))}
                          </optgroup>
                          <optgroup label="Regiões inteiras">
                            {regions.map((r) => (
                              <option key={r.id} value={`region:${r.id}`}>{r.name}</option>
                            ))}
                          </optgroup>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="commission_pct">Comissão (%)</Label>
                        <Input id="commission_pct" name="commission_pct" type="number" min={0} max={100} step="0.01" required defaultValue={10} />
                      </div>
                    </div>
                  </ActionForm>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Pessoas do parceiro</CardTitle>
                <CardDescription>Entram com a própria conta e só veem a área comercial dos portais do território.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {people.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ninguém vinculado.</p>
                ) : (
                  <ul className="divide-y text-sm">
                    {people.map((p) => (
                      <li key={p.user_id} className="flex items-center justify-between gap-3 py-2">
                        <span>{p.email}</span>
                        {admin && (
                          <form action={removePartnerUser}>
                            <input type="hidden" name="partner_id" value={selected.id} />
                            <input type="hidden" name="user_id" value={p.user_id} />
                            <Button type="submit" size="sm" variant="outline">Remover</Button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {admin && (
                  <ActionForm action={addPartnerUser} submitLabel="Vincular">
                    <input type="hidden" name="partner_id" value={selected.id} />
                    <div className="space-y-1.5">
                      <Label htmlFor="email">E-mail de quem já tem conta</Label>
                      <Input id="email" name="email" type="email" required />
                    </div>
                  </ActionForm>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
