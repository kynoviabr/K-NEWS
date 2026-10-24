import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AnunciantesPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Anunciantes</h1>
      <Card>
        <CardHeader>
          <CardTitle>Cadastro de anunciantes e contratos</CardTitle>
          <CardDescription>knews.advertisers + ad_campaigns com validacao, status e janela contratada.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">CRUD validado por lib/validations/ads.schema.ts; elegibilidade em lib/ad-eligibility.ts; decision em /api/ads/decision por cidade.</p>
        </CardContent>
      </Card>
    </div>
  );
}
