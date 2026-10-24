import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canSell, getAdminContext } from "@/lib/admin-context";
import { getKnewsSessionClient } from "@/lib/supabase/knews";
import { formatCents } from "@/lib/ads/visitor";
import { NotSignedIn } from "../../../portal-switcher";
import { ActionForm } from "../../action-form";
import { CampaignFields, type CampaignValues } from "../../campaign-fields";
import { createTextCreative, reviewCreative, setCampaignStatus, setGeoTargets, setPlacements, updateCampaign, uploadImageCreative } from "../../actions";
import { CampaignStatusBadge } from "../../status-badge";

export const dynamic = "force-dynamic";

type Campaign = CampaignValues & {
  id: string;
  portal_id: string;
  status: string;
  status_reason: string | null;
  impressions_served: number;
  impressions_confirmed: number;
  clicks: number;
  budget_spent_cents: number;
};
type Creative = {
  id: string;
  format: "image" | "text";
  status: string;
  storage_path: string | null;
  alt_text: string | null;
  headline: string | null;
  body_text: string | null;
  click_url: string | null;
  weight: number;
  width: number | null;
  height: number | null;
  reviewed_at: string | null;
};

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAdminContext();
  if (!ctx) return <NotSignedIn />;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const { client, knews } = await getKnewsSessionClient();
  const { data: campaign } = await knews.from("ad_campaigns").select("*").eq("id", id).maybeSingle<Campaign>();
  if (!campaign) notFound();
  const member = ctx.memberships.find((m) => m.portalId === campaign.portal_id) ?? null;
  const sells = canSell(member);

  const [creativesRes, placementsRes, slotsRes, geoRes, statsRes, auditRes, advertisersRes, contractsRes, portalRes] = await Promise.all([
    knews.from("ad_creatives").select("id, format, status, storage_path, alt_text, headline, body_text, click_url, weight, width, height, reviewed_at").eq("campaign_id", id).order("created_at"),
    knews.from("ad_campaign_placements").select("slot_code").eq("campaign_id", id),
    knews.from("ad_slots").select("code, name, width, height").eq("enabled", true).order("code"),
    knews.from("ad_campaign_geo_targets").select("neighborhood_slug").eq("campaign_id", id),
    knews.from("ad_daily_stats").select("day, slot_code, reserved, impressions, clicks").eq("campaign_id", id).order("day", { ascending: false }).limit(60),
    knews.from("audit_logs").select("action, at, meta").eq("target_type", "ad_campaign").eq("target_id", id).order("at", { ascending: false }).limit(20),
    knews.from("advertisers").select("id, name").order("name"),
    knews.from("ad_contracts").select("id, reference, status").eq("portal_id", campaign.portal_id).neq("status", "cancelled"),
    knews.from("portals").select("city_id, cities(slug)").eq("id", campaign.portal_id).maybeSingle(),
  ]);
  const creatives = (creativesRes.data ?? []) as Creative[];
  const previews = new Map<string, string>();
  for (const c of creatives) {
    if (c.storage_path) {
      const signed = await client.storage.from("knews-creative").createSignedUrl(c.storage_path, 600);
      if (signed.data) previews.set(c.id, signed.data.signedUrl);
    }
  }
  const placements = new Set(((placementsRes.data ?? []) as Array<{ slot_code: string }>).map((p) => p.slot_code));
  const geo = new Set(((geoRes.data ?? []) as Array<{ neighborhood_slug: string | null }>).map((g) => g.neighborhood_slug).filter(Boolean));
  const portal = portalRes.data as unknown as { city_id: string; cities: { slug: string } | null } | null;
  const { data: neighborhoods } = portal ? await knews.from("neighborhoods").select("name, slug").eq("city_id", portal.city_id).order("name") : { data: [] };
  const stats = (statsRes.data ?? []) as Array<{ day: string; slot_code: string; reserved: number; impressions: number; clicks: number }>;
  const advertisers = ((advertisersRes.data ?? []) as Array<{ id: string; name: string }>).map((a) => ({ id: a.id, label: a.name }));
  const contracts = ((contractsRes.data ?? []) as Array<{ id: string; reference: string; status: string }>).map((c) => ({ id: c.id, label: `${c.reference}${c.status === "signed" ? "" : ` (${c.status})`}` }));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/ads" className="text-sm text-primary hover:underline">← Ad Management</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-2xl font-bold tracking-tight">{campaign.name}</h1>
          <CampaignStatusBadge status={campaign.status} />
        </div>
        {campaign.status_reason && <p className="text-sm text-muted-foreground">Motivo: {campaign.status_reason}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ["Impressões confirmadas", campaign.impressions_confirmed.toLocaleString("pt-BR") + (campaign.impressions_cap ? ` / ${campaign.impressions_cap.toLocaleString("pt-BR")}` : "")],
          ["Em reserva / servidas", campaign.impressions_served.toLocaleString("pt-BR")],
          ["Cliques", `${campaign.clicks.toLocaleString("pt-BR")} (${campaign.impressions_confirmed ? ((campaign.clicks / campaign.impressions_confirmed) * 100).toFixed(2) : "0.00"}%)`],
          ["Gasto (CPM/CPC)", campaign.pricing_model === "flat" ? "valor fechado" : formatCents(campaign.budget_spent_cents)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-xl">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      {sells && (
        <Card>
          <CardHeader>
            <CardTitle>Situação</CardTitle>
            <CardDescription>Para ativar, o banco exige contrato assinado (campanha paga), término dentro da vigência, ao menos uma posição e um criativo aprovado. Pausa e encerramento valem na próxima página servida.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={setCampaignStatus} submitLabel="Aplicar">
              <input type="hidden" name="id" value={campaign.id} />
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="status">Nova situação</Label>
                  <Select id="status" name="status" defaultValue={campaign.status === "active" ? "paused" : "active"}>
                    <option value="active">Ativar</option>
                    <option value="paused">Pausar</option>
                    <option value="ended">Encerrar</option>
                    <option value="draft">Voltar para rascunho</option>
                  </Select>
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="reason">Motivo (obrigatório para pausar/encerrar)</Label>
                  <Input id="reason" name="reason" placeholder="Pedido do anunciante, criativo vencido..." />
                </div>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Criativos</CardTitle>
          <CardDescription>Só criativos aprovados entram no rodízio, ponderados pelo peso. Trocar o destino de um criativo aprovado o devolve para revisão.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {creatives.length === 0 && <p className="text-sm text-muted-foreground">Nenhum criativo enviado.</p>}
          <div className="grid gap-4 md:grid-cols-2">
            {creatives.map((c) => (
              <div key={c.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <CampaignStatusBadge status={c.status} />
                  <span className="text-xs text-muted-foreground">peso {c.weight}{c.width && c.height ? ` · ${c.width}×${c.height}` : ""}</span>
                </div>
                {c.format === "image" ? (
                  previews.get(c.id) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- pre-visualizacao com URL assinada temporaria
                    <img src={previews.get(c.id)} alt={c.alt_text ?? ""} className="max-h-40 rounded border" />
                  ) : (
                    <p className="text-xs text-destructive">Arquivo indisponível</p>
                  )
                ) : (
                  <div className="rounded border bg-card p-2">
                    <strong className="block">{c.headline}</strong>
                    {c.body_text && <span className="text-sm text-muted-foreground">{c.body_text}</span>}
                  </div>
                )}
                <p className="truncate text-xs text-muted-foreground">Destino: {c.click_url ?? "sem link"}</p>
                {sells && (
                  <div className="flex gap-2">
                    {c.status !== "approved" && (
                      <form action={reviewCreative}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="campaign_id" value={campaign.id} />
                        <input type="hidden" name="status" value="approved" />
                        <Button type="submit" size="sm">Aprovar</Button>
                      </form>
                    )}
                    {c.status !== "rejected" && (
                      <form action={reviewCreative}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="campaign_id" value={campaign.id} />
                        <input type="hidden" name="status" value="rejected" />
                        <Button type="submit" size="sm" variant="outline">Rejeitar</Button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {sells && (
            <div className="grid gap-6 md:grid-cols-2">
              <ActionForm action={uploadImageCreative} submitLabel="Enviar imagem" pendingLabel="Enviando...">
                <input type="hidden" name="campaign_id" value={campaign.id} />
                <h3 className="font-medium">Imagem</h3>
                <div className="space-y-1.5">
                  <Label htmlFor="file">Arquivo (PNG, JPEG, WebP ou GIF, até 2 MB)</Label>
                  <Input id="file" name="file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="alt_text">Texto alternativo</Label>
                  <Input id="alt_text" name="alt_text" required placeholder="Promoção de verão da Loja X" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="img_click_url">Destino (https)</Label>
                  <Input id="img_click_url" name="click_url" type="url" placeholder="https://anunciante.com.br/oferta" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="width">Largura</Label>
                    <Input id="width" name="width" type="number" min={1} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="height">Altura</Label>
                    <Input id="height" name="height" type="number" min={1} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="img_weight">Peso</Label>
                    <Input id="img_weight" name="weight" type="number" min={1} max={100} defaultValue={1} />
                  </div>
                </div>
              </ActionForm>
              <ActionForm action={createTextCreative} submitLabel="Criar anúncio de texto">
                <input type="hidden" name="campaign_id" value={campaign.id} />
                <h3 className="font-medium">Texto</h3>
                <div className="space-y-1.5">
                  <Label htmlFor="headline">Título</Label>
                  <Input id="headline" name="headline" required maxLength={90} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="body_text">Texto</Label>
                  <Input id="body_text" name="body_text" maxLength={200} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="txt_click_url">Destino (https)</Label>
                  <Input id="txt_click_url" name="click_url" type="url" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="txt_weight">Peso</Label>
                  <Input id="txt_weight" name="weight" type="number" min={1} max={100} defaultValue={1} />
                </div>
              </ActionForm>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Posições</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={setPlacements} submitLabel="Salvar posições">
              <input type="hidden" name="id" value={campaign.id} />
              <div className="space-y-2">
                {((slotsRes.data ?? []) as Array<{ code: string; name: string; width: number | null; height: number | null }>).map((s) => (
                  <label key={s.code} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="slots" value={s.code} defaultChecked={placements.has(s.code)} disabled={!sells} />
                    {s.name} <code className="text-xs text-muted-foreground">{s.code}</code>
                  </label>
                ))}
              </div>
            </ActionForm>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Bairros</CardTitle>
            <CardDescription>Nenhum marcado = todo o portal. Bairro marcado só exibe em matérias daquele bairro.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={setGeoTargets} submitLabel="Salvar segmentação">
              <input type="hidden" name="id" value={campaign.id} />
              <input type="hidden" name="city_slug" value={portal?.cities?.slug ?? ""} />
              <div className="grid grid-cols-2 gap-2">
                {((neighborhoods ?? []) as Array<{ name: string; slug: string }>).map((n) => (
                  <label key={n.slug} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="neighborhoods" value={n.slug} defaultChecked={geo.has(n.slug)} disabled={!sells} />
                    {n.name}
                  </label>
                ))}
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      </div>

      {sells && (
        <Card>
          <CardHeader>
            <CardTitle>Dados da campanha</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={updateCampaign} submitLabel="Salvar alterações">
              <input type="hidden" name="id" value={campaign.id} />
              <CampaignFields values={campaign} advertisers={advertisers} contracts={contracts} />
            </ActionForm>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Entrega por dia</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem entregas ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dia</TableHead>
                  <TableHead>Posição</TableHead>
                  <TableHead className="text-right">Servidas</TableHead>
                  <TableHead className="text-right">Impressões</TableHead>
                  <TableHead className="text-right">Cliques</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.map((s) => (
                  <TableRow key={`${s.day}-${s.slot_code}`}>
                    <TableCell>{new Date(`${s.day}T12:00:00`).toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell><code className="text-xs">{s.slot_code}</code></TableCell>
                    <TableCell className="text-right">{s.reserved}</TableCell>
                    <TableCell className="text-right">{s.impressions}</TableCell>
                    <TableCell className="text-right">{s.clicks}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {((auditRes.data ?? []) as Array<{ action: string; at: string; meta: { from?: string; reason?: string } }>).map((a, i) => (
              <li key={i}>
                {new Date(a.at).toLocaleString("pt-BR")} · {a.meta.from} → {a.action.replace("campaign.", "")}
                {a.meta.reason ? ` · ${a.meta.reason}` : ""}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
