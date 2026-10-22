import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function AdsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Ad Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">Campanhas, criativos, slots e entrega — MVP obrigatório.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Campanhas</CardTitle>
            <CardDescription>Cadastro central, entrega dinâmica</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge>Fase 4</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Inventário</CardTitle>
            <CardDescription>Slots, targeting, pacing e fallback</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge>Fase 4</Badge>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
