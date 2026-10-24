import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getKnewsServiceClient } from "@/lib/supabase/knews";
import { opsAlerts, type OpsOverview } from "@/lib/ops";

// Health profundo para o monitor externo: banco, fila e integracoes. Protegido pelo
// CRON_SECRET; o /api/health publico continua so dizendo que o app responde.
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  const { data, error } = await getKnewsServiceClient().schema("knews").rpc("ops_overview");
  if (error || !data) return NextResponse.json({ ok: false, error: "banco indisponivel" }, { status: 503 });
  const overview = data as OpsOverview;
  const alerts = opsAlerts(overview);
  const ok = !alerts.some((a) => a.level === "critical");
  return NextResponse.json(
    { ok, db_ms: Date.now() - started, alerts, queue: { due_backlog: overview.due_backlog, oldest_due_seconds: overview.oldest_due_seconds, dead_letter: overview.dead_letter } },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
