"use client";

import * as React from "react";

export type AdSlotProps = {
  slotId: string;
  className?: string;
  fallbackLabel?: string;
};

export function AdSlot({ slotId, className, fallbackLabel = "Espaco publicitario" }: AdSlotProps) {
  return (
    <div
      data-ad-slot={slotId}
      className={className ?? "flex min-h-[90px] items-center justify-center rounded-lg border border-dashed bg-muted/50 px-4 py-6 text-center"}
      aria-label={fallbackLabel}
    >
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{fallbackLabel} · {slotId}</span>
    </div>
  );
}
