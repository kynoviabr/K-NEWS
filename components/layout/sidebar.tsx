"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Globe,
  Layers,
  MapPin,
  Share2,
  BadgeDollarSign,
  Building2,
  Package,
  BarChart3,
  Users,
  Workflow,
  LineChart,
  LogOut,
  Newspaper,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { navigationItems } from "@/config/navigation";

const iconMap: Record<string, React.ElementType> = {
  LayoutDashboard,
  FileText,
  Globe,
  Layers,
  MapPin,
  Share2,
  BadgeDollarSign,
  Building2,
  Package,
  BarChart3,
  Users,
  Workflow,
  LineChart,
  Newspaper,
};

export function Sidebar({ isOpen, onClose }: { isOpen: boolean; onClose?: () => void }) {
  const pathname = usePathname();

  return (
    <>
      {isOpen && <div className="fixed inset-0 z-40 bg-foreground/35 backdrop-blur-sm lg:hidden" onClick={onClose} aria-hidden />}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-background))] transition-transform duration-200 lg:static lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Navegação principal"
      >
        <div className="flex h-20 items-center gap-3 border-b border-[hsl(var(--sidebar-border))] px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg gradient-primary text-white shadow-glow">
            <Newspaper className="h-5 w-5" />
          </div>
          <div>
            <span className="block text-base font-semibold tracking-tight text-white">K-NEWS</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--sidebar-primary))]">Rede Kynovia</span>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-5" aria-label="Menu">
          <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">Painel</div>
          {navigationItems.map((item) => {
            const Icon = iconMap[item.icon] ?? Layers;
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "group flex h-10 items-center justify-between rounded-lg px-3 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-[hsl(var(--sidebar-primary))] text-white shadow-glow"
                    : "text-white/65 hover:bg-[hsl(var(--sidebar-accent))] hover:text-white"
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="flex items-center gap-3">
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.title}
                </span>
                {isActive && <ChevronRight className="h-4 w-4" />}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-3 border-t border-[hsl(var(--sidebar-border))] p-4">
          <div className="rounded-lg border border-[hsl(var(--sidebar-border))] bg-white/5 p-3">
            <span className="block text-xs font-semibold text-white">K-NEWS</span>
            <span className="block text-[11px] text-white/50">Guarujá · Piloto</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-white/40">
            <LogOut className="h-3.5 w-3.5" />
            Sessão via Supabase Auth
          </div>
        </div>
      </aside>
    </>
  );
}
