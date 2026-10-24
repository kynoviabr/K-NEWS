// Visao da operacao (knews.ops_overview) e os limites que viram alerta no health interno
// e no painel /automacoes.

export type OpsOverview = {
  generated_at: string;
  by_type: Array<{ job_type: string; status: string; count: number }>;
  due_backlog: number;
  oldest_due_seconds: number;
  expired_leases: number;
  dead_letter: number;
  last_completed: Record<string, string>;
  recent_dead_letters: Array<{ id: string; job_type: string; portal: string | null; attempts: number; last_error: string | null; failed_at: string | null }>;
  sources_failing: number;
  social_attention: number;
  social_accounts_expired: number;
  ad_reservations_open: number;
};

export type OpsAlert = { level: "critical" | "warning"; message: string };

// O agendador roda a cada minuto: fila parada ha mais de 15 minutos indica worker fora.
export const MAX_DUE_SECONDS = 15 * 60;

export function opsAlerts(o: OpsOverview): OpsAlert[] {
  const alerts: OpsAlert[] = [];
  if (o.oldest_due_seconds > MAX_DUE_SECONDS) alerts.push({ level: "critical", message: `Fila parada: job vencido ha ${Math.round(o.oldest_due_seconds / 60)} min.` });
  if (o.expired_leases > 0) alerts.push({ level: "warning", message: `${o.expired_leases} job(s) com lease vencido (worker caiu no meio).` });
  if (o.dead_letter > 0) alerts.push({ level: "warning", message: `${o.dead_letter} job(s) em dead-letter.` });
  if (o.sources_failing > 0) alerts.push({ level: "warning", message: `${o.sources_failing} fonte(s) com falha na última coleta.` });
  if (o.social_accounts_expired > 0) alerts.push({ level: "critical", message: `${o.social_accounts_expired} conta(s) social(is) com token expirado.` });
  if (o.social_attention > 0) alerts.push({ level: "warning", message: `${o.social_attention} post(s) social(is) pedem conferência.` });
  return alerts;
}
