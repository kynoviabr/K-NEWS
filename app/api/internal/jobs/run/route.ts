import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getKnewsServiceClient } from "@/lib/supabase/knews";
import { runWorker } from "@/lib/news-intelligence/worker";
import { allowPrivateFeeds } from "@/lib/news-intelligence/dev-flags";
import { socialPublishingEnabled } from "@/lib/social/publisher";

// Acionado pelo agendador (pg_cron + pg_net no Supabase, ADR-006). Nao e cron da Vercel.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getKnewsServiceClient();
  const due = await db.schema("knews").rpc("enqueue_due_source_fetches");
  if (due.error) return NextResponse.json({ error: due.error.message }, { status: 500 });
  // Posts sociais so entram na fila com o envio liberado neste ambiente; sem isso
  // ficam "agendados" e nada sai para a Meta.
  let social: Record<string, unknown> = { disabled: true };
  if (socialPublishingEnabled()) {
    const [posts, metrics] = [await db.schema("knews").rpc("enqueue_due_social_posts"), await db.schema("knews").rpc("enqueue_due_social_metrics")];
    if (posts.error || metrics.error) return NextResponse.json({ error: (posts.error ?? metrics.error)!.message }, { status: 500 });
    social = { posts: posts.data, metrics: metrics.data };
  }
  const report = await runWorker({ db, workerId: `vercel-${crypto.randomUUID().slice(0, 8)}`, fetchOptions: { allowPrivateNetwork: allowPrivateFeeds() } }, 10);
  // Manutencao do motor de anuncios: devolve inventario de reservas abandonadas e
  // encerra campanhas vencidas ou entregues.
  const expired = await db.schema("knews").rpc("expire_stale_reservations");
  const closed = await db.schema("knews").rpc("close_finished_campaigns");
  return NextResponse.json({ enqueued_fetches: due.data, social, ...report, ads: { expired_reservations: expired.data, closed_campaigns: closed.data } });
}
