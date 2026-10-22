import "server-only";
import { getSupabaseServerClient } from "./server";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const ACTIVE_PORTAL_COOKIE = "knews_selected_portal_id";

export class AuthenticationError extends Error {
  constructor(message = "Acesso não autorizado. Faça login para continuar.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    return user;
  } catch {
    return null;
  }
}

export async function requireAuth(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationError("Acesso não autorizado. Sessão inválida ou expirada.");
  return user;
}

export async function getActivePortalId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ACTIVE_PORTAL_COOKIE)?.value ?? null;
}
