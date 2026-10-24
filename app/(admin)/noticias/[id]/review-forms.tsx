"use client";

import { useActionState } from "react";
import { reviewArticle, saveDraft, unpublishArticle, type ReviewState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

function Status({ state }: { state: ReviewState }) {
  if (!state) return null;
  return <p role="status" className={state.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"}>{state.message}</p>;
}

export function EditForm({ article }: { article: { id: string; title: string; excerpt: string | null; body: string } }) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(saveDraft, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={article.id} />
      <div className="space-y-1">
        <Label htmlFor="title">Título</Label>
        <Input id="title" name="title" defaultValue={article.title} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="excerpt">Linha fina</Label>
        <Input id="excerpt" name="excerpt" defaultValue={article.excerpt ?? ""} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="body">Texto</Label>
        <Textarea id="body" name="body" defaultValue={article.body} rows={12} required />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending}>Salvar rascunho</Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function ReviewForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(reviewArticle, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <div className="space-y-1">
        <Label htmlFor="note">Nota editorial (obrigatória para aprovar)</Label>
        <Textarea id="note" name="note" rows={3} placeholder="Ex.: conferido com o comunicado oficial de 24/10" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="decision">Decisão</Label>
        <Select id="decision" name="decision" defaultValue="approve">
          <option value="approve">Aprovar e publicar</option>
          <option value="request_changes">Devolver para ajustes</option>
          <option value="reject">Rejeitar</option>
        </Select>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Enviando..." : "Confirmar decisão"}</Button>
      <Status state={state} />
    </form>
  );
}

export function UnpublishForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(unpublishArticle, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <div className="space-y-1">
        <Label htmlFor="reason">Motivo da retirada (fica público nas correções)</Label>
        <Input id="reason" name="reason" required minLength={10} />
      </div>
      <Button type="submit" variant="destructive" disabled={pending}>Retirar do ar</Button>
      <Status state={state} />
    </form>
  );
}
