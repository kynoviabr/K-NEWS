// Executa o worker da fila no Supabase LOCAL: `npx tsx scripts/run-worker.ts`.
// Usa SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (de `npx supabase status -o env`).
// KNEWS_ALLOW_PRIVATE_FEEDS=1 libera feeds em 127.0.0.1, so com banco local.
import { createClient } from "@supabase/supabase-js";
import { runWorker } from "@/lib/news-intelligence/worker";
import { allowPrivateFeeds } from "@/lib/news-intelligence/dev-flags";

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.API_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  const allowPrivate = allowPrivateFeeds({ ...process.env, SUPABASE_URL: url });
  if (process.env.KNEWS_ALLOW_PRIVATE_FEEDS === "1" && !allowPrivate) throw new Error("KNEWS_ALLOW_PRIVATE_FEEDS so e permitido com Supabase local.");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const due = await db.schema("knews").rpc("enqueue_due_source_fetches");
  if (due.error) throw new Error(due.error.message);
  for (let round = 0; round < 10; round++) {
    const report = await runWorker({ db, workerId: `cli-${process.pid}`, fetchOptions: { allowPrivateNetwork: allowPrivate } }, 20);
    console.log(JSON.stringify({ round, ...report }, null, 2));
    if (report.claimed === 0) break;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
