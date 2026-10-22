import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ParceirosPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Parceiros</h1>
      <Card>
        <CardHeader>
          <CardTitle>Em construcao</CardTitle>
          <CardDescription>Territorios e comissoes — Fase 6.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Escopo por territorio; parceiro nao acessa dados de outra regiao.</p>
        </CardContent>
      </Card>
    </div>
  );
}
