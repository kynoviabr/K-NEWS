import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AnunciantesPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Anunciantes</h1>
      <Card>
        <CardHeader>
          <CardTitle>Em construcao</CardTitle>
          <CardDescription>Cadastro de anunciantes e contratos — Fase 4.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">CRUD em knews.advertisers / knews.ad_campaigns com validacao de datas e status.</p>
        </CardContent>
      </Card>
    </div>
  );
}
