import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ACTIVE_PORTAL_COOKIE } from "@/lib/supabase/auth";
import type { AdminContext } from "@/lib/admin-context";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

async function switchPortal(formData: FormData) {
  "use server";
  const portalId = String(formData.get("portal_id") ?? "");
  const back = String(formData.get("back") ?? "/");
  if (/^[0-9a-f-]{36}$/.test(portalId)) {
    (await cookies()).set(ACTIVE_PORTAL_COOKIE, portalId, { httpOnly: true, sameSite: "lax", path: "/" });
  }
  redirect(back.startsWith("/") ? back : "/");
}

export function PortalSwitcher({ ctx, back }: { ctx: AdminContext; back: string }) {
  if (ctx.memberships.length <= 1) {
    return <p className="text-sm text-muted-foreground">Portal: <strong>{ctx.active?.portalName ?? "nenhum"}</strong></p>;
  }
  return (
    <form action={switchPortal} className="flex items-center gap-2">
      <input type="hidden" name="back" value={back} />
      <Select name="portal_id" defaultValue={ctx.active?.portalId} aria-label="Portal ativo" className="w-56">
        {ctx.memberships.map((m) => (
          <option key={m.portalId} value={m.portalId}>{m.portalName}</option>
        ))}
      </Select>
      <Button type="submit" variant="outline" size="sm">Trocar</Button>
    </form>
  );
}

export function NotSignedIn() {
  return (
    <div className="space-y-2">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Acesso restrito</h1>
      <p className="text-sm text-muted-foreground">Entre com uma conta vinculada a um portal K-NEWS. <a className="text-primary underline" href="/login">Entrar</a></p>
    </div>
  );
}
