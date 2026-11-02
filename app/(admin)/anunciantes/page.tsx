import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canSell, getAdminContext, isSuperAdmin } from "@/lib/admin-context";
import { getKnewsSessionClient } from "@/lib/supabase/knews";
import { formatCents } from "@/lib/ads/visitor";
import { NotSignedIn, PortalSwitcher } from "../portal-switcher";
import { ActionForm } from "../ads/action-form";
import { createAdvertiser, createContract, setContractStatus } from "../ads/actions";
import { CampaignStatusBadge } from "../ads/status-badge";

export const dynamic = "force-dynamic";

type Advertiser = { id: string; name: string; document: string | null; contact_name: string | null; contact_email: string | null; portal_id: string | null };
type Contract = {
  id: string;
  reference: string;
  status: string;
  starts_on: string;
  ends_on: string;
  total_value_cents: number;
  commission_pct: number;
  advertisers: { name: string } | null;
};

const date = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR");

export default async function AnunciantesPage() {
  const ctx = await getAdminContext();
  if (!ctx) return <NotSignedIn />;
  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Anunciantes e contratos</h1>
        <p className="text-sm text-muted-foreground">Cadastro comercial do portal. Campanha paga só entra no ar com contrato assinado.</p>
      </div>
      <PortalSwitcher ctx={ctx} back="/anunciantes" />
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

  const { knews } = await getKnewsSessionClient();
  const [advRes, ctrRes] = await Promise.all([
    knews.from("advertisers").select("id, name, document, contact_name, contact_email, portal_id").order("name"),
    knews
      .from("ad_contracts")
      .select("id, reference, status, starts_on, ends_on, total_value_cents, commission_pct, advertisers(name)")
      .eq("portal_id", ctx.active.portalId)
      .order("created_at", { ascending: false }),
  ]);
  const advertisers = (advRes.data ?? []) as Advertiser[];
  const contracts = (ctrRes.data ?? []) as unknown as Contract[];

  return (
    <div className="space-y-6">
      {header}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Novo anunciante</CardTitle>
            <CardDescription>Fica vinculado a {ctx.active.portalName}.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={createAdvertiser} submitLabel="Cadastrar anunciante">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="adv_name">Nome / razão social</Label>
                  <Input id="adv_name" name="name" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="document">CNPJ/CPF</Label>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Novo contrato</CardTitle>
            <CardDescription>A comissão de parceiro incide sobre a receita confirmada do contrato.</CardDescription>
          </CardHeader>
          <CardContent>
            {advertisers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Cadastre um anunciante primeiro.</p>
            ) : (
              <ActionForm action={createContract} submitLabel="Registrar contrato">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ct_advertiser">Anunciante</Label>
                    <Select id="ct_advertiser" name="advertiser_id" required defaultValue="">
                      <option value="" disabled>Escolha…</option>
                      {advertisers.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reference">Referência</Label>
                    <Input id="reference" name="reference" required placeholder="GRJ-2026-001" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="starts_on">Início</Label>
                    <Input id="starts_on" name="starts_on" type="date" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ends_on">Fim</Label>
                    <Input id="ends_on" name="ends_on" type="date" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="total_value_cents">Valor total (R$)</Label>
                    <Input id="total_value_cents" name="total_value_cents" inputMode="decimal" required placeholder="1.500,00" />
                  </div>
                  {isSuperAdmin(ctx) ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="commission_pct">Comissão do parceiro (%)</Label>
                      <Input id="commission_pct" name="commission_pct" type="number" min={0} max={100} step="0.01" defaultValue={0} />
                      <p className="text-xs text-muted-foreground">Em branco ou 0: vale a comissão do território.</p>
                    </div>
                  ) : (
                    <p className="self-end text-xs text-muted-foreground">Parceiro e comissão vêm do território do portal.</p>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="ct_status">Situação</Label>
                    <Select id="ct_status" name="status" defaultValue="draft">
                      <option value="draft">Rascunho</option>
                      <option value="signed">Assinado</option>
                    </Select>
                  </div>
                </div>
              </ActionForm>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Contratos de {ctx.active.portalName}</CardTitle>
        </CardHeader>
        <CardContent>
          {contracts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum contrato.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Vigência</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="font-medium">{c.reference}</div>
                      <div className="text-xs text-muted-foreground">{c.advertisers?.name}{Number(c.commission_pct) > 0 ? ` · comissão ${c.commission_pct}%` : ""}</div>
                    </TableCell>
                    <TableCell className="text-sm">{date(c.starts_on)} → {date(c.ends_on)}</TableCell>
                    <TableCell className="text-right text-sm">{formatCents(Number(c.total_value_cents))}</TableCell>
                    <TableCell><CampaignStatusBadge status={c.status} /></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {c.status === "draft" && (
                          <form action={setContractStatus}>
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="status" value="signed" />
                            <Button size="sm" type="submit">Marcar assinado</Button>
                          </form>
                        )}
                        {(c.status === "draft" || c.status === "signed") && (
                          <form action={setContractStatus}>
                            <input type="hidden" name="id" value={c.id} />
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

      <Card>
        <CardHeader>
          <CardTitle>Anunciantes</CardTitle>
        </CardHeader>
        <CardContent>
          {advertisers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum anunciante.</p>
          ) : (
            <ul className="divide-y text-sm">
              {advertisers.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span className="font-medium">{a.name}{a.portal_id === null && <span className="ml-2 text-xs text-muted-foreground">(rede)</span>}</span>
                  <span className="text-muted-foreground">{[a.document, a.contact_name, a.contact_email].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
