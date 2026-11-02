import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/security/rate-limit";

const schema = z.object({
  campaign_id: z.string().uuid(),
  slot_code: z.string().min(1),
  idempotency_key: z.string().min(8).max(100),
  ttl_seconds: z.number().int().min(30).max(3600).optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    // A reserva e feita para visitantes anonimos do portal: knews.reserve_ad so executa
    // com service_role (servidor), e a rota limita requisicoes por IP para conter abuso.
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!checkRateLimit(`ads-reserve:${ip}`, 60, 60_000).allowed) {
      return NextResponse.json({ error: "muitas requisicoes" }, { status: 429 });
    }

    const supabase = getSupabaseAdminClient();

    const { data, error } = await supabase.schema("knews").rpc("reserve_ad" as never, {
      p_campaign_id: parsed.data.campaign_id,
      p_slot_code: parsed.data.slot_code,
      p_idempotency_key: parsed.data.idempotency_key,
      p_ttl_seconds: parsed.data.ttl_seconds ?? 300,
    } as never);

    if (error) {
      const msg = error.message ?? "erro ao reservar";
      const status = msg.includes("nao encontrada") ? 404 : msg.includes("nao ativa") || msg.includes("janela") || msg.includes("cap") || msg.includes("orcamento") || msg.includes("slot") ? 409 : 400;
      return NextResponse.json({ error: msg }, { status });
    }

    return NextResponse.json({ ok: true, reservation: data });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
