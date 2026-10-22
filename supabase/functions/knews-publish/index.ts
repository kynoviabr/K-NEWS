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
  if (!bearerOk && !headerOk) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ success: false, error: "Supabase not configured" }, 500);
  }

  // Fase 5 — publish queue (Fase 1: health only)
  if (req.method === "GET") {
    return jsonResponse({ success: true, message: "knews-publish alive — Fase 1 (sem fila ativa)." });
  }

  return jsonResponse({ success: true, message: "knews-publish — no-op in Fase 1." });
});
