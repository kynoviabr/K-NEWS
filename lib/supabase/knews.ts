import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";

// Clientes sem tipagem gerada para os schemas knews/knews_public (database.types.ts
// cobre so o nucleo da Fase 1). Sempre do lado do servidor.

// Sessao do usuario: todas as leituras/escritas passam pela RLS do schema knews.
export async function getKnewsSessionClient() {
  const client = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  return { client, knews: client.schema("knews") };
}

// Anonimo, sem cookies: leitura publica do portal via funcoes de knews_public.
export function getPortalPublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }).schema("knews_public");
}

// service_role: somente worker e acoes administrativas ja autorizadas no servidor.
export function getKnewsServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar configuradas.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
