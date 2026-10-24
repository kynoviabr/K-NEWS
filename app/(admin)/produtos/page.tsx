import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { canSell, getAdminContext } from "@/lib/admin-context";
import { getKnewsSessionClient } from "@/lib/supabase/knews";
import { NotSignedIn, PortalSwitcher } from "../portal-switcher";
import { ActionForm } from "../ads/action-form";
import { createLink, toggleLink, updateLinkDestination } from "../ads/actions";

export const dynamic = "force-dynamic";

type LinkRow = { id: string; code: string; title: string; kind: string; destination_url: string; rel: string; disclosure: string; active: boolean; clicks: number };

const KIND: Record<string, string> = { affiliate: "Afiliado", own_product: "Produto próprio", partner: "Parceiro" };

export default async function ProdutosPage() {
  const ctx = await getAdminContext();
  if (!ctx) return <NotSignedIn />;
  const sells = canSell(ctx.active);
  let links: LinkRow[] = [];
  if (ctx.active) {
    const { knews } = await getKnewsSessionClient();
    const { data } = await knews.from("ad_links").select("id, code, title, kind, destination_url, rel, disclosure, active, clicks").eq("portal_id", ctx.active.portalId).order("created_at", { ascending: false });
    links = (data ?? []) as LinkRow[];
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Produtos e links afiliados</h1>
          <p className="text-sm text-muted-foreground">
            Cada link tem um endereço curto do portal (<code>/r/código</code>). Trocar o destino aqui atualiza todas as matérias que usam o link. Clique não é venda: comissões entram como receita confirmada em Comercial.
          </p>
        </div>
        <PortalSwitcher ctx={ctx} back="/produtos" />
      </div>

      {sells && (
        <Card>
          <CardHeader>
            <CardTitle>Novo link</CardTitle>
            <CardDescription>O link é sempre marcado como patrocinado (rel=&quot;sponsored&quot;) e exibido com o aviso de divulgação.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={createLink} submitLabel="Criar link">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="code">Código</Label>
                  <Input id="code" name="code" required placeholder="kit-praia" pattern="[a-z0-9][a-z0-9-]{2,59}" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="title">Título interno</Label>
                  <Input id="title" name="title" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="kind">Tipo</Label>
                  <Select id="kind" name="kind" defaultValue="affiliate">
                    <option value="affiliate">Afiliado</option>
                    <option value="own_product">Produto próprio</option>
                    <option value="partner">Parceiro</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="destination_url">Destino (https)</Label>
                  <Input id="destination_url" name="destination_url" type="url" required />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="disclosure">Aviso de divulgação</Label>
                  <Input id="disclosure" name="disclosure" required defaultValue="Link patrocinado: o portal pode receber comissão." />
                </div>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Links de {ctx.active?.portalName ?? "—"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {links.length === 0 && <p className="text-sm text-muted-foreground">Nenhum link cadastrado.</p>}
          {links.map((l) => (
            <div key={l.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium">{l.title}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{KIND[l.kind]} · <code>/r/{l.code}</code> · {l.clicks} cliques{l.active ? "" : " · desativado"}</span>
                </div>
                {sells && (
                  <form action={toggleLink}>
                    <input type="hidden" name="id" value={l.id} />
                    <input type="hidden" name="active" value={String(!l.active)} />
                    <Button size="sm" variant="ghost" type="submit">{l.active ? "Desativar" : "Ativar"}</Button>
                  </form>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{l.disclosure}</p>
              {sells ? (
                <ActionForm action={updateLinkDestination} submitLabel="Atualizar destino" variant="outline" className="space-y-2">
                  <input type="hidden" name="id" value={l.id} />
                  <Label htmlFor={`dest-${l.id}`} className="sr-only">Destino</Label>
                  <Input id={`dest-${l.id}`} name="destination_url" type="url" defaultValue={l.destination_url} />
                </ActionForm>
              ) : (
                <p className="truncate text-xs">{l.destination_url}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Para usar numa matéria: <code>{`<a href="/r/${l.code}" rel="${l.rel}">…</a>`}</code> seguido do aviso acima.
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
