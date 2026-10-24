import "server-only";
import { cookies } from "next/headers";
import { getKnewsSessionClient } from "@/lib/supabase/knews";
import { ACTIVE_PORTAL_COOKIE } from "@/lib/supabase/auth";

export type Membership = { portalId: string; portalName: string; portalSlug: string; role: string };
export type AdminContext = { userId: string; email: string | null; memberships: Membership[]; active: Membership | null };

const EDITOR_ROLES = new Set(["super_admin", "regional_manager", "regional_editor"]);

export function canEdit(m: Membership | null): boolean {
  return !!m && EDITOR_ROLES.has(m.role);
}

// Usuario logado + vinculos ativos no K-NEWS. null = nao logado.
export async function getAdminContext(): Promise<AdminContext | null> {
  let session;
  try {
    session = await getKnewsSessionClient();
  } catch {
    return null;
  }
  const { data: auth } = await session.client.auth.getUser();
  if (!auth.user) return null;

  const { data: members } = await session.knews.from("portal_members").select("portal_id, role").eq("user_id", auth.user.id).eq("status", "active");
  const ids = (members ?? []).map((m: { portal_id: string }) => m.portal_id);
  const { data: portals } = ids.length ? await session.knews.from("portals").select("id, name, slug").in("id", ids) : { data: [] };
  const byId = new Map((portals ?? []).map((p: { id: string; name: string; slug: string }) => [p.id, p]));
  const memberships: Membership[] = (members ?? [])
    .map((m: { portal_id: string; role: string }) => {
      const p = byId.get(m.portal_id);
      return p ? { portalId: p.id, portalName: p.name, portalSlug: p.slug, role: m.role } : null;
    })
    .filter((m): m is Membership => !!m)
    .sort((a, b) => a.portalName.localeCompare(b.portalName));

  const cookieStore = await cookies();
  const wanted = cookieStore.get(ACTIVE_PORTAL_COOKIE)?.value;
  const active = memberships.find((m) => m.portalId === wanted) ?? memberships[0] ?? null;
  return { userId: auth.user.id, email: auth.user.email ?? null, memberships, active };
}
