import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function NoticiasPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Notícias</h1>
        <p className="mt-1 text-sm text-muted-foreground">Gestão editorial — artigos, evidências e publicação.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Em construção</CardTitle>
          <CardDescription>Fase 3 — News Intelligence. Artigos com evidências rastreáveis e guardrails editoriais.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nenhuma notícia cadastrada. Conecte um portal e fontes na Fase 3.</p>
        </CardContent>
      </Card>
    </div>
  );
}
