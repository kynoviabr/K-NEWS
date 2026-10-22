import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LocalidadesPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Localidades e Portais</h1>
      <Card>
        <CardHeader>
          <CardTitle>Em construção</CardTitle>
          <CardDescription>Regiões, cidades, bairros, portais e domínios — Fase 1/2.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Piloto: Guarujá/SP. Estrutura <code>knews.{`regions,cities,neighborhoods,portals`}</code> pronta na migration.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
