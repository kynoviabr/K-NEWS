import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function ParceirosPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Parceiros Regionais</h1>
      <Card>
        <CardHeader>
          <CardTitle>Territorios e comissoes</CardTitle>
          <CardDescription>knews.partners + partner_territories por cidade/regiao com RBAC por portal.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Badge>Isolamento por territorio — parceiro so seu escopo</Badge>
          <p className="text-sm text-muted-foreground">Comissoes por territorio; comercial sem acesso editorial alheio.</p>
        </CardContent>
      </Card>
    </div>
  );
}
