"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getKnewsSessionClient } from "@/lib/supabase/knews";

// requeue_job/cancel_job conferem a funcao (super_admin ou operador tecnico) e auditam.

export async function requeueJob(fd: FormData): Promise<void> {
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return;
  const { knews } = await getKnewsSessionClient();
  await knews.rpc("requeue_job", { p_job_id: id.data });
  revalidatePath("/automacoes");
}

export async function cancelJob(fd: FormData): Promise<void> {
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return;
  const { knews } = await getKnewsSessionClient();
  await knews.rpc("cancel_job", { p_job_id: id.data });
  revalidatePath("/automacoes");
}
