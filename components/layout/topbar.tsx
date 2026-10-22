"use client";

import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-card px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick} aria-label="Abrir menu">
          <Menu className="h-5 w-5" />
        </Button>
        <span className="hidden text-sm font-medium text-muted-foreground lg:block">Painel administrativo</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">Fase 0 · Fundação</span>
      </div>
    </header>
  );
}
