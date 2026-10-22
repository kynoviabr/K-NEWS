import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SocialPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Redes Sociais</h1>
      <Card>
        <CardHeader>
          <CardTitle>Em construcao</CardTitle>
          <CardDescription>Meta Graph API — Fase 5.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Publicacao idempotente, retry seguro e metricas por portal.</p>
        </CardContent>
      </Card>
    </div>
  );
}
