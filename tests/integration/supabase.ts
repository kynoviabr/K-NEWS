import { execSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertLocal } from "./db";

// Chaves do Supabase LOCAL (supabase status). Nunca chaves do projeto remoto.
type LocalEnv = { url: string; anonKey: string; serviceKey: string };
let cached: LocalEnv | null = null;

export function localEnv(): LocalEnv {
  if (cached) return cached;
  let url = process.env.API_URL;
  let anonKey = process.env.ANON_KEY;
  let serviceKey = process.env.SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    const out = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const env = Object.fromEntries(
      out
        .split("\n")
        .map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/))
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => [m[1], m[2]]),
    );
    url = env.API_URL;
    anonKey = env.ANON_KEY;
    serviceKey = env.SERVICE_ROLE_KEY;
  }
  if (!url || !anonKey || !serviceKey) throw new Error("Supabase local nao encontrado: rode `npx supabase start`.");
  assertLocal(url);
  cached = { url, anonKey, serviceKey };
  return cached;
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

export function serviceClient(): SupabaseClient {
  const e = localEnv();
  return createClient(e.url, e.serviceKey, opts);
}

export function anonClient(): SupabaseClient {
  const e = localEnv();
  return createClient(e.url, e.anonKey, opts);
}

// Cria (ou reaproveita) um usuario real no GoTrue local e devolve um cliente logado.
export async function signedInClient(email: string, password = "senha-local-123"): Promise<{ client: SupabaseClient; userId: string }> {
  const admin = serviceClient();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error && !/already/i.test(created.error.message)) throw created.error;
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw error ?? new Error("login falhou");
  return { client, userId: data.user.id };
}
