"use client";

import { useActionState } from "react";
import { createSource, type ActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SourceForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createSource, null);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="name">Nome</Label>
        <Input id="name" name="name" required placeholder="Prefeitura de Guarujá — notícias" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="url">URL do feed RSS/Atom</Label>
        <Input id="url" name="url" type="url" required placeholder="https://www.guaruja.sp.gov.br/feed/" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="license">Licença / termos de uso</Label>
        <Input id="license" name="license" placeholder="Conteúdo público oficial, atribuição obrigatória" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="fetch_interval_minutes">Intervalo de coleta (min)</Label>
        <Input id="fetch_interval_minutes" name="fetch_interval_minutes" type="number" min={5} max={1440} defaultValue={60} />
      </div>
      <div className="flex items-center gap-3 md:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? "Salvando..." : "Cadastrar fonte"}</Button>
        {state && (
          <p role="status" className={state.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
