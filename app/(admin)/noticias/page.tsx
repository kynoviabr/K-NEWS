import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function NoticiasPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Noticias</h1>
      <Card>
        <CardHeader>
          <CardTitle>CRUD de noticias</CardTitle>
          <CardDescription>Rascunho, revisao, agendamento, publicacao, retirada e correcoes com historico de versoes.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">knews.articles + article_versions + article_corrections + editorial_decisions. Fluxo validado por riskLevel e evidencias.</p>
        </CardContent>
      </Card>
    </div>
  );
}
