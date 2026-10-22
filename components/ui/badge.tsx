import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--radius-chip)] px-2 py-0.5 text-xs font-semibold bg-secondary text-secondary-foreground border",
        className
      )}
      {...props}
    />
  );
}
