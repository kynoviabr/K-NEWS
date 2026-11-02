import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function SocialPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Redes Sociais</h1>
      <Card>
        <CardHeader>
          <CardTitle>Meta Graph API — idempotente e agendado</CardTitle>
          <CardDescription>knews.portal_social_accounts (tokens Vault) + knews.social_posts com idempotency_key e retry.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Badge>pending → scheduled → publishing → published</Badge>
          <p className="text-sm text-muted-foreground">Envio por API oficial com retentativa e metricas por portal. Sem publicacao real sem autorizacao.</p>
        </CardContent>
      </Card>
    </div>
  );
}
