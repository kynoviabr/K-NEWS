// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = req.headers.get("x-cron-secret") ?? "";
  const bearerOk = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;
  const headerOk = CRON_SECRET && cronSecret === CRON_SECRET;
  const isCron = bearerOk || headerOk;

  // verify_jwt = false: o segredo do cron e a unica credencial aceita. Antes,
  // qualquer "Bearer <valor>" (ou GET sem cabecalho) passava e usava a service role.
  if (!isCron) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ success: false, error: "Supabase not configured" }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (req.method === "GET" && new URL(req.url).searchParams.get("health") === "1") {
    const { data, error } = await supabase.rpc("knews_get_job_health" as any);
    if (error) return jsonResponse({ success: false, error: error.message }, 500);
    return jsonResponse({ success: true, data });
  }

  // Placeholder: claim/execute jobs when knews.jobs is populated (Fase 3+)
  return jsonResponse({
    success: true,
    message: "knews-jobs worker alive — no jobs to claim yet (Fase 1).",
    cron: isCron,
  });
});
