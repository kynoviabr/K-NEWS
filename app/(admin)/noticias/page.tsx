import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAdminContext } from "@/lib/admin-context";
import { getKnewsSessionClient } from "@/lib/supabase/knews";
import { NotSignedIn, PortalSwitcher } from "../portal-switcher";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  reviewing: "Em revisão",
  blocked: "Bloqueado",
  draft: "Devolvido",
  published: "Publicado",
  unpublished: "Retirado",
  archived: "Rejeitado",
};

const RISK_CLASS: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-900",
  medium: "bg-amber-100 text-amber-900",
  high: "bg-orange-100 text-orange-900",
  blocked: "bg-red-100 text-red-900",
};

type Row = { id: string; title: string; status: string; risk_level: string; created_at: string; published_at: string | null; ai_provider: string | null };

export default async function NoticiasPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await getAdminContext();
  if (!ctx) return <NotSignedIn />;
  const { status = "fila" } = await searchParams;
  const filters: Record<string, string[]> = {
    fila: ["reviewing", "blocked", "draft"],
    publicados: ["published"],
    retirados: ["unpublished", "archived"],
  };

  let rows: Row[] = [];
  if (ctx.active) {
    const { knews } = await getKnewsSessionClient();
    const { data } = await knews
      .from("articles")
      .select("id, title, status, risk_level, created_at, published_at, ai_provider")
      .eq("portal_id", ctx.active.portalId)
      .in("status", filters[status] ?? filters.fila!)
      .order("created_at", { ascending: false })
      .limit(100);
    rows = (data ?? []) as Row[];
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Notícias</h1>
          <p className="text-sm text-muted-foreground">Nada é publicado sem revisão humana. Temas sensíveis ficam bloqueados.</p>
        </div>
        <PortalSwitcher ctx={ctx} back="/noticias" />
      </div>
      <nav className="flex gap-2 text-sm" aria-label="Filtro">
        {Object.keys(filters).map((k) => (
          <Link key={k} href={`/noticias?status=${k}`} className={`rounded-md px-3 py-1.5 ${k === status ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
            {{ fila: "Fila de revisão", publicados: "Publicados", retirados: "Retirados/rejeitados" }[k]}
          </Link>
        ))}
      </nav>
      <Card>
        <CardHeader>
          <CardTitle>{rows.length} matéria(s)</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada por aqui.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Risco</TableHead>
                  <TableHead>Criado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/noticias/${r.id}`} className="font-medium hover:underline">{r.title}</Link>
                      {r.ai_provider && <div className="text-xs text-muted-foreground">Rascunho: {r.ai_provider === "mock" ? "sem IA (reescrever)" : r.ai_provider}</div>}
                    </TableCell>
                    <TableCell>{STATUS_LABEL[r.status] ?? r.status}</TableCell>
                    <TableCell><Badge className={RISK_CLASS[r.risk_level]}>{r.risk_level}</Badge></TableCell>
                    <TableCell className="text-sm">{new Date(r.created_at).toLocaleString("pt-BR")}</TableCell>
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
