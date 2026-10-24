"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const pathname = usePathname();

  // Portal publico tem identidade propria, sem a sidebar administrativa.
  if (pathname?.startsWith("/portal")) return <div className="min-h-screen bg-background">{children}</div>;

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="flex min-h-screen flex-1 flex-col lg:pl-0">
          <Topbar onMenuClick={() => setSidebarOpen((v) => !v)} />
          <main className="flex-1 bg-background p-4 md:p-6 lg:p-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
