import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function FontesPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Fontes</h1>
      <Card>
        <CardHeader>
          <CardTitle>Gerenciamento de fontes</CardTitle>
          <CardDescription>Por portal: RSS, API oficial, diario, licenciado — com license/terms e fetch_logs. Intake via knews.sources + coleta RSS segura.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">CRUD em knews.sources (portal_id, url, kind, license, enabled) com historico em knews.fetch_logs. Bloqueio de sensiveis e sem IA como fonte independente.</p>
        </CardContent>
      </Card>
    </div>
  );
}
