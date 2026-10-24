import { headers } from "next/headers";
import { getPortalPublicClient } from "@/lib/supabase/knews";
import { normalizeHost } from "@/lib/domains";

export const dynamic = "force-dynamic";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

// ads.txt por dominio: so provedores aprovados e ligados no portal do host.
export async function GET() {
  const host = normalizeHost((await headers()).get("host"));
  const lookup = host && LOCAL_HOSTS.has(host) && process.env.KNEWS_DEV_PORTAL_HOST ? process.env.KNEWS_DEV_PORTAL_HOST : host;
  const db = getPortalPublicClient();
  let lines: string[] = [];
  if (db && lookup) {
    const { data } = await db.rpc("ads_txt", { p_host: lookup });
    lines = ((data as string[] | null) ?? []).filter(Boolean);
  }
  const body = lines.length ? `${lines.join("\n")}\n` : "# Nenhum vendedor programatico autorizado para este dominio.\n";
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
