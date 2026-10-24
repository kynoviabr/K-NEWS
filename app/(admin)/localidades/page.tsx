import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canEdit, canManage, getAdminContext, isSuperAdmin } from "@/lib/admin-context";
import { getKnewsSessionClient } from "@/lib/supabase/knews";
import { NotSignedIn, PortalSwitcher } from "../portal-switcher";
import { ActionForm } from "../ads/action-form";
import { CampaignStatusBadge } from "../ads/status-badge";
import { addDomain, createCategory, createCity, createNeighborhood, createPortal, createRegion, saveIdentity, setPortalStatus } from "./actions";

export const dynamic = "force-dynamic";

type Region = { id: string; name: string; slug: string };
type City = { id: string; name: string; slug: string; region_id: string };
type Portal = {
  id: string;
  name: string;
  slug: string;
  status: string;
  city_id: string;
  theme: { primary?: string; accent?: string; tagline?: string; logo_text?: string };
  seo: { description?: string };
  portal_domains: Array<{ domain: string; is_primary: boolean }>;
};

const STATUS: Record<string, string> = { active: "active", inactive: "draft", archived: "ended" };

export default async function LocalidadesPage() {
  const ctx = await getAdminContext();
  if (!ctx) return <NotSignedIn />;
  const admin = isSuperAdmin(ctx);
  const { knews } = await getKnewsSessionClient();
  const [regionsRes, citiesRes, portalsRes] = await Promise.all([
    knews.from("regions").select("id, name, slug").order("name"),
    knews.from("cities").select("id, name, slug, region_id").order("name"),
    knews.from("portals").select("id, name, slug, status, city_id, theme, seo, portal_domains(domain, is_primary)").order("name"),
  ]);
  const regions = (regionsRes.data ?? []) as Region[];
  const cities = (citiesRes.data ?? []) as City[];
  const portals = (portalsRes.data ?? []) as unknown as Portal[];
  const cityName = new Map(cities.map((c) => [c.id, c.name]));
  const active = portals.find((p) => p.id === ctx.active?.portalId) ?? null;

  let neighborhoods: Array<{ id: string; name: string; slug: string }> = [];
  let categories: Array<{ id: string; name: string; slug: string; position: number }> = [];
  if (active) {
    const [n, c] = await Promise.all([
      knews.from("neighborhoods").select("id, name, slug").eq("city_id", active.city_id).order("name"),
      knews.from("categories").select("id, name, slug, position").eq("portal_id", active.id).order("position"),
    ]);
    neighborhoods = (n.data ?? []) as typeof neighborhoods;
    categories = (c.data ?? []) as typeof categories;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Localidades e portais</h1>
          <p className="text-sm text-muted-foreground">Regiões, cidades, bairros, portais, domínios, identidade visual e editorias. Nova cidade não exige código novo.</p>
        </div>
        <PortalSwitcher ctx={ctx} back="/localidades" />
      </div>

      {active && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Identidade de {active.name}</CardTitle>
              <CardDescription>Cores, nome e slogan do portal público. A cor principal precisa de contraste com texto branco.</CardDescription>
            </CardHeader>
            <CardContent>
              {canManage(ctx.active) ? (
                <ActionForm action={saveIdentity} submitLabel="Salvar identidade">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="pname">Nome do portal</Label>
                      <Input id="pname" name="name" defaultValue={active.name} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="logo_text">Nome no cabeçalho</Label>
                      <Input id="logo_text" name="logo_text" maxLength={40} defaultValue={active.theme.logo_text ?? ""} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="tagline">Slogan</Label>
                      <Input id="tagline" name="tagline" maxLength={120} defaultValue={active.theme.tagline ?? ""} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="primary">Cor principal</Label>
                      <Input id="primary" name="primary" type="color" defaultValue={active.theme.primary ?? "#0e7490"} className="h-10 p-1" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="accent">Cor de destaque</Label>
                      <Input id="accent" name="accent" type="color" defaultValue={active.theme.accent ?? "#f59e0b"} className="h-10 p-1" />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="description">Descrição para buscadores</Label>
                      <Input id="description" name="description" maxLength={200} defaultValue={active.seo.description ?? ""} />
                    </div>
                  </div>
                </ActionForm>
              ) : (
                <p className="text-sm text-muted-foreground">Somente o gerente regional do portal edita a identidade.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Editorias</CardTitle>
              <CardDescription>Aparecem no menu do portal quando têm matéria publicada.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="flex flex-wrap gap-2 text-sm">
                {categories.map((c) => (
                  <li key={c.id} className="rounded-md border px-2 py-1">{c.name} <code className="text-xs text-muted-foreground">{c.slug}</code></li>
                ))}
              </ul>
              {canEdit(ctx.active) && (
                <ActionForm action={createCategory} submitLabel="Adicionar editoria">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2 space-y-1.5">
                      <Label htmlFor="cat_name">Nome</Label>
                      <Input id="cat_name" name="name" required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cat_pos">Ordem</Label>
                      <Input id="cat_pos" name="position" type="number" min={0} max={999} defaultValue={100} />
                    </div>
                  </div>
                </ActionForm>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Bairros de {cityName.get(active.city_id)}</CardTitle>
              <CardDescription>Usados para classificar matérias, filtrar o portal e segmentar anúncios.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="flex flex-wrap gap-2 text-sm">
                {neighborhoods.map((n) => (
                  <li key={n.id} className="rounded-md border px-2 py-1">{n.name}</li>
                ))}
              </ul>
              {canManage(ctx.active) && (
                <ActionForm action={createNeighborhood} submitLabel="Adicionar bairro" className="max-w-md">
                  <input type="hidden" name="city_id" value={active.city_id} />
                  <div className="space-y-1.5">
                    <Label htmlFor="nb_name">Nome do bairro</Label>
                    <Input id="nb_name" name="name" required />
                  </div>
                </ActionForm>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Portais</CardTitle>
          <CardDescription>Portal novo nasce inativo. Domínios só passam a responder depois do DNS, que é configurado fora do painel.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Portal</TableHead>
                <TableHead>Cidade</TableHead>
                <TableHead>Domínios</TableHead>
                <TableHead>Situação</TableHead>
                {admin && <TableHead className="text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {portals.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="font-medium">{p.name}</div>
                    <code className="text-xs text-muted-foreground">{p.slug}</code>
                  </TableCell>
                  <TableCell>{cityName.get(p.city_id) ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {p.portal_domains.length === 0 ? <span className="text-muted-foreground">{p.slug}.portal24h.news</span> : p.portal_domains.map((d) => (
                      <div key={d.domain}>{d.domain}{d.is_primary && <span className="ml-1 text-xs text-muted-foreground">(principal)</span>}</div>
                    ))}
                  </TableCell>
                  <TableCell><CampaignStatusBadge status={STATUS[p.status] ?? p.status} /></TableCell>
                  {admin && (
                    <TableCell className="text-right">
                      <form action={setPortalStatus}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="status" value={p.status === "active" ? "inactive" : "active"} />
                        <Button type="submit" size="sm" variant={p.status === "active" ? "ghost" : "default"}>{p.status === "active" ? "Desativar" : "Ativar"}</Button>
                      </form>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {admin && (
            <div className="grid gap-6 lg:grid-cols-2">
              <ActionForm action={createPortal} submitLabel="Criar portal">
                <h3 className="font-medium">Novo portal</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="np_city">Cidade</Label>
                    <Select id="np_city" name="city_id" required defaultValue="">
                      <option value="" disabled>Escolha…</option>
                      {cities.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="np_name">Nome</Label>
                    <Input id="np_name" name="name" required placeholder="Portal 24h Bertioga" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="np_slug">Slug (subdomínio)</Label>
                    <Input id="np_slug" name="slug" placeholder="bertioga" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="np_domain">Domínio principal (opcional)</Label>
                    <Input id="np_domain" name="domain" placeholder="bertioga.portal24h.news" />
                  </div>
                </div>
              </ActionForm>
              <ActionForm action={addDomain} submitLabel="Adicionar domínio">
                <h3 className="font-medium">Domínio adicional</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ad_portal">Portal</Label>
                    <Select id="ad_portal" name="portal_id" required defaultValue="">
                      <option value="" disabled>Escolha…</option>
                      {portals.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ad_domain">Domínio</Label>
                    <Input id="ad_domain" name="domain" required placeholder="noticiasdeguaruja.com.br" />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="is_primary" /> Principal (usado nos links canônicos)
                  </label>
                </div>
              </ActionForm>
            </div>
          )}
        </CardContent>
      </Card>

      {admin && (
        <Card>
          <CardHeader>
            <CardTitle>Regiões e cidades</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <ul className="space-y-1 text-sm">
              {regions.map((r) => (
                <li key={r.id}>
                  <strong>{r.name}</strong>: {cities.filter((c) => c.region_id === r.id).map((c) => c.name).join(", ") || "sem cidades"}
                </li>
              ))}
            </ul>
            <div className="grid gap-6 lg:grid-cols-2">
              <ActionForm action={createRegion} submitLabel="Cadastrar região">
                <div className="space-y-1.5">
                  <Label htmlFor="rg_name">Nova região</Label>
                  <Input id="rg_name" name="name" required placeholder="Litoral Norte" />
                </div>
              </ActionForm>
              <ActionForm action={createCity} submitLabel="Cadastrar cidade">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ct_region">Região</Label>
                    <Select id="ct_region" name="region_id" required defaultValue="">
                      <option value="" disabled>Escolha…</option>
                      {regions.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ct_name">Nova cidade</Label>
                    <Input id="ct_name" name="name" required placeholder="Bertioga" />
                  </div>
                </div>
              </ActionForm>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
