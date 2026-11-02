import { Badge } from "@/components/ui/badge";

const LABELS: Record<string, [string, string]> = {
  draft: ["Rascunho", "bg-muted text-muted-foreground"],
  active: ["No ar", "bg-emerald-100 text-emerald-800 border-emerald-200"],
  paused: ["Pausada", "bg-amber-100 text-amber-800 border-amber-200"],
  ended: ["Encerrada", "bg-muted text-muted-foreground"],
  blocked: ["Bloqueada", "bg-red-100 text-red-800 border-red-200"],
  pending: ["Em revisão", "bg-amber-100 text-amber-800 border-amber-200"],
  approved: ["Aprovado", "bg-emerald-100 text-emerald-800 border-emerald-200"],
  rejected: ["Rejeitado", "bg-red-100 text-red-800 border-red-200"],
  signed: ["Assinado", "bg-emerald-100 text-emerald-800 border-emerald-200"],
  cancelled: ["Cancelado", "bg-muted text-muted-foreground"],
  estimated: ["Estimada", "bg-amber-100 text-amber-800 border-amber-200"],
  confirmed: ["Confirmada", "bg-emerald-100 text-emerald-800 border-emerald-200"],
  paid: ["Paga", "bg-emerald-100 text-emerald-800 border-emerald-200"],
};

export function CampaignStatusBadge({ status }: { status: string }) {
  const [label, cls] = LABELS[status] ?? [status, ""];
  return <Badge className={cls}>{label}</Badge>;
}
