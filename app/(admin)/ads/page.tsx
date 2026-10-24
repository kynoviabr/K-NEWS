import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canSell, getAdminContext } from "@/lib/admin-context";
import { getKnewsSessionClient } from "@/lib/supabase/knews";
import { NotSignedIn, PortalSwitcher } from "../portal-switcher";
import { ActionForm } from "./action-form";
import { CampaignFields } from "./campaign-fields";
import { createCampaign } from "./actions";
import { CampaignStatusBadge } from "./status-badge";

export const dynamic = "force-dynamic";

type CampaignRow = {
  id: string;
  name: string;
  status: string;
  kind: string;
  starts_at: string | null;
  ends_at: string | null;
  impressions_cap: number | null;
  impressions_confirmed: number;
  clicks: number;
  advertisers: { name: string } | null;
};

function todaySaoPaulo(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
}

export default async function AdsPage() {
  const ctx = await getAdminContext();
  if (!ctx) return <NotSignedIn />;
  const sells = canSell(ctx.active);

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Ad Management</h1>
        <p className="text-sm text-muted-foreground">Campanhas cadastradas uma vez e servidas dinamicamente por posição, território, editoria e dispositivo.</p>
      </div>
      <PortalSwitcher ctx={ctx} back="/ads" />
    </div>
  );
  if (!ctx.active || !sells) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-muted-foreground">A área comercial é restrita a gerentes regionais, parceiros comerciais e administradores. A redação não gerencia anúncios.</p>
      </div>
    );
  }

  const { knews } = await getKnewsSessionClient();
  const portalId = ctx.active.portalId;
  const [campaignsRes, statsRes, slotsRes, providersRes, advertisersRes, contractsRes] = await Promise.all([
    knews
      .from("ad_campaigns")
      .select("id, name, status, kind, starts_at, ends_at, impressions_cap, impressions_confirmed, clicks, advertisers(name)")
      .eq("portal_id", portalId)
      .order("created_at", { ascending: false }),
    knews.from("ad_daily_stats").select("impressions, clicks, day").eq("portal_id", portalId).gte("day", new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)),
    knews.from("ad_slots").select("code, name, width, height, fallback_provider, enabled, portal_id").order("code"),
    knews.from("portal_ad_providers").select("provider, enabled, approved_at").eq("portal_id", portalId),
    knews.from("advertisers").select("id, name").eq("status", "active").order("name"),
    knews.from("ad_contracts").select("id, reference, status, advertisers(name)").eq("portal_id", portalId).in("status", ["draft", "signed"]).order("created_at", { ascending: false }),
  ]);
  const campaigns = (campaignsRes.data ?? []) as unknown as CampaignRow[];
  const stats = (statsRes.data ?? []) as Array<{ impressions: number; clicks: number; day: string }>;
  const today = todaySaoPaulo();
  const todayStats = stats.filter((s) => s.day === today);
  const sum = (rows: typeof stats, k: "impressions" | "clicks") => rows.reduce((acc, r) => acc + r[k], 0);
  const week = { impressions: sum(stats, "impressions"), clicks: sum(stats, "clicks") };
  const ctr = week.impressions ? ((week.clicks / week.impressions) * 100).toFixed(2) : "0.00";
  const providers = (providersRes.data ?? []) as Array<{ provider: string; enabled: boolean; approved_at: string | null }>;
  const advertisers = ((advertisersRes.data ?? []) as Array<{ id: string; name: string }>).map((a) => ({ id: a.id, label: a.name }));
  const contracts = ((contractsRes.data ?? []) as unknown as Array<{ id: string; reference: string; status: string; advertisers: { name: string } | null }>).map((c) => ({
    id: c.id,
    label: `${c.reference} · ${c.advertisers?.name ?? "anunciante"}${c.status === "signed" ? "" : " (não assinado)"}`,
  }));

  return (
    <div className="space-y-6">
      {header}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Campanhas no ar", campaigns.filter((c) => c.status === "active").length],
          ["Impressões hoje", sum(todayStats, "impressions")],
          ["Cliques hoje", sum(todayStats, "clicks")],
          ["CTR 7 dias", `${ctr}%`],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-2xl">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Campanhas de {ctx.active.portalName}</CardTitle>
          <CardDescription>Impressões contam só quando o anúncio fica visível; cliques são registrados pelo redirecionador.</CardDescription>
        </CardHeader>
        <CardContent>
          {campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma campanha cadastrada.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campanha</TableHead>
                  <TableHead>Janela</TableHead>
                  <TableHead>Entrega</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/ads/campanhas/${c.id}`} className="font-medium text-primary hover:underline">{c.name}</Link>
                      <div className="text-xs text-muted-foreground">{c.advertisers?.name ?? "—"} · {c.kind === "house" ? "da casa" : "paga"}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.starts_at ? new Date(c.starts_at).toLocaleDateString("pt-BR") : "imediato"} → {c.ends_at ? new Date(c.ends_at).toLocaleDateString("pt-BR") : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.impressions_confirmed.toLocaleString("pt-BR")}
                      {c.impressions_cap ? ` / ${c.impressions_cap.toLocaleString("pt-BR")}` : ""} impr. · {c.clicks.toLocaleString("pt-BR")} cliques
                    </TableCell>
                    <TableCell><CampaignStatusBadge status={c.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nova campanha</CardTitle>
          <CardDescription>Nasce como rascunho. Depois escolha posições, envie e aprove criativos e ative.</CardDescription>
        </CardHeader>
        <CardContent>
          {advertisers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Cadastre um anunciante em <Link className="text-primary underline" href="/anunciantes">Anunciantes</Link> primeiro.</p>
          ) : (
            <ActionForm action={createCampaign} submitLabel="Criar rascunho">
              <CampaignFields advertisers={advertisers} contracts={contracts} />
            </ActionForm>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inventário de posições</CardTitle>
          <CardDescription>Ordem de preenchimento: campanha paga → provedor programático aprovado → campanha da casa.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Posição</TableHead>
                <TableHead>Tamanho</TableHead>
                <TableHead>Programático de reserva</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {((slotsRes.data ?? []) as Array<{ code: string; name: string; width: number | null; height: number | null; fallback_provider: string | null; enabled: boolean }>).map((s) => (
                <TableRow key={s.code}>
                  <TableCell>
                    <div className="font-medium">{s.name}</div>
                    <code className="text-xs text-muted-foreground">{s.code}</code>
                  </TableCell>
                  <TableCell className="text-sm">{s.width && s.height ? `${s.width}×${s.height}` : "responsivo"}</TableCell>
                  <TableCell className="text-sm">{s.fallback_provider ?? "—"}{!s.enabled && " · desativada"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap gap-2 text-sm">
            {(["adsense", "mgid"] as const).map((p) => {
              const row = providers.find((r) => r.provider === p);
              return (
                <Badge key={p} className={row?.enabled ? "" : "bg-muted text-muted-foreground"}>
                  {p === "adsense" ? "AdSense" : "MGID"}: {row?.enabled ? "aprovado e ligado" : row ? "cadastrado, aguardando aprovação" : "não configurado"}
                </Badge>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">Provedores só são ligados por um administrador depois da aprovação da conta; o ads.txt de cada domínio é gerado a partir deles.</p>
        </CardContent>
      </Card>
    </div>
  );
}
