import { AppShell } from "@/components/layout/app-shell";

// Painel com sidebar. O portal publico (app/portal) tem moldura propria, servida na
// raiz do host da cidade pelo middleware.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
