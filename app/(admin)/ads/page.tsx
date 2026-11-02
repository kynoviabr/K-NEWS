import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function AdsPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Ad Management</h1>
      <Card>
        <CardHeader>
          <CardTitle>Inventario e programacao</CardTitle>
          <CardDescription>Slots, campanhas, placements, geo, caps, orcamento e rotacao com reserva transacional.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Badge>knews.ad_slots + ad_campaigns + reserve_ad RPC</Badge>
          <p className="text-sm text-muted-foreground">Upload em knews-creative, decision por /api/ads/decision, expiracao via expire_stale_reservations.</p>
        </CardContent>
      </Card>
    </div>
  );
}
