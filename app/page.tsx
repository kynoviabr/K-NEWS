import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Visão Geral</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          K-NEWS — rede de portais hiperlocais da Kynovia. Fase 0 concluída; fundação em construção.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Portal público</CardTitle>
            <CardDescription>Mobile-first, SEO, slots de anúncios</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge>Fase 2</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>News Intelligence</CardTitle>
            <CardDescription>RSS, evidências, guardrails editoriais</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge>Fase 3</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ad Management</CardTitle>
            <CardDescription>Campanhas dinâmicas, pacing, relatórios</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge>MVP obrigatório</Badge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fase 0 — Auditoria</CardTitle>
          <CardDescription>Leitura do BLOGGER e plano de isolamento Supabase</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm leading-relaxed">
          <p>
            Documentos gerados em <code>docs/</code>: <code>AUDIT-BLOGGER.md</code>, <code>ARCHITECTURE.md</code>,{" "}
            <code>DATABASE-ISOLATION.md</code>, <code>IMPLEMENTATION-ROADMAP.md</code>, <code>DECISIONS.md</code>.
          </p>
          <p className="text-muted-foreground">
            Nenhum arquivo do BLOGGER foi modificado. Nenhuma migration foi aplicada. Nenhum segredo foi exposto.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
