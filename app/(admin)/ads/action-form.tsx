"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ActionState } from "./actions";

type Props = {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "default" | "outline" | "destructive" | "secondary";
  className?: string;
  children?: React.ReactNode;
};

// Formulario generico do Revenue Center: campos renderizados no servidor,
// envio por Server Action e mensagem de resultado acessivel.
export function ActionForm({ action, submitLabel, pendingLabel = "Salvando...", variant = "default", className, children }: Props) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  return (
    <form action={formAction} className={cn("space-y-4", className)}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={variant} disabled={pending}>{pending ? pendingLabel : submitLabel}</Button>
        {state && (
          <p role="status" className={state.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
