"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canEdit, canManage, getAdminContext, isSuperAdmin } from "@/lib/admin-context";
import { getKnewsSessionClient } from "@/lib/supabase/knews";
import { toSlug } from "@/lib/news-intelligence/fingerprint";
import { themeProblems } from "@/lib/theme";
import type { ActionState } from "../ads/actions";

// Cadastro multirregional. Autorizacao real: RLS, privilegios por coluna e
// knews.create_portal no banco; as checagens daqui so dao mensagens claras.

const name = z.string().trim().min(2, "Nome muito curto").max(80);
const slugOf = (raw: FormDataEntryValue | null, fallback: string) => {
  const s = typeof raw === "string" && raw.trim() ? toSlug(raw) : toSlug(fallback);
  return s.length >= 2 ? s : null;
};

function dbMessage(message: string): string {
  if (/row-level security|permission denied|42501|somente super_admin/.test(message)) return "Sem permissão para esta operação.";
  if (/duplicate key/.test(message)) return "Já existe um cadastro com esse endereço (slug ou domínio).";
  if (/portal_domains_format/.test(message)) return "Domínio inválido (ex.: guaruja.portal24h.news).";
  if (/uq_knews_portal_domains_primary/.test(message)) return "O portal já tem um domínio principal.";
  return message;
}

function done(message: string): ActionState {
  revalidatePath("/localidades");
  return { ok: true, message };
}

export async function createRegion(_prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!isSuperAdmin(await getAdminContext())) return { ok: false, message: "Somente administradores da rede cadastram regiões." };
  const n = name.safeParse(fd.get("name"));
  if (!n.success) return { ok: false, message: n.error.issues[0]!.message };
  const slug = slugOf(fd.get("slug"), n.data);
  if (!slug) return { ok: false, message: "Slug inválido." };
  const { knews } = await getKnewsSessionClient();
  const { error } = await knews.from("regions").insert({ name: n.data, slug });
  return error ? { ok: false, message: dbMessage(error.message) } : done(`Região ${n.data} cadastrada.`);
}

export async function createCity(_prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!isSuperAdmin(await getAdminContext())) return { ok: false, message: "Somente administradores da rede cadastram cidades." };
  const parsed = z.object({ region_id: z.uuid("Escolha a região"), name }).safeParse({ region_id: fd.get("region_id"), name: fd.get("name") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
  const slug = slugOf(fd.get("slug"), parsed.data.name);
  if (!slug) return { ok: false, message: "Slug inválido." };
  const { knews } = await getKnewsSessionClient();
  const { error } = await knews.from("cities").insert({ ...parsed.data, slug });
  return error ? { ok: false, message: dbMessage(error.message) } : done(`Cidade ${parsed.data.name} cadastrada.`);
}

export async function createNeighborhood(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z.object({ city_id: z.uuid(), name }).safeParse({ city_id: fd.get("city_id"), name: fd.get("name") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
  const slug = slugOf(null, parsed.data.name);
  if (!slug) return { ok: false, message: "Nome inválido." };
  const { knews } = await getKnewsSessionClient();
  const { error } = await knews.from("neighborhoods").insert({ ...parsed.data, slug });
  return error ? { ok: false, message: dbMessage(error.message) } : done(`Bairro ${parsed.data.name} cadastrado.`);
}

export async function createPortal(_prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!isSuperAdmin(await getAdminContext())) return { ok: false, message: "Somente administradores da rede criam portais." };
  const parsed = z
    .object({ city_id: z.uuid("Escolha a cidade"), name: z.string().trim().min(3).max(80), domain: z.string().trim().toLowerCase().max(253).optional() })
    .safeParse({ city_id: fd.get("city_id"), name: fd.get("name"), domain: fd.get("domain") || undefined });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
  const slug = slugOf(fd.get("slug"), parsed.data.name);
  if (!slug) return { ok: false, message: "Slug inválido." };
  const { knews } = await getKnewsSessionClient();
  const { error } = await knews.rpc("create_portal", { p_city_id: parsed.data.city_id, p_name: parsed.data.name, p_slug: slug, p_domain: parsed.data.domain ?? null });
  return error ? { ok: false, message: dbMessage(error.message) } : done(`Portal ${parsed.data.name} criado (inativo). Ative quando houver conteúdo publicado.`);
}

export async function setPortalStatus(fd: FormData): Promise<void> {
  const status = fd.get("status");
  if (status !== "active" && status !== "inactive") return;
  const { knews } = await getKnewsSessionClient();
  await knews.from("portals").update({ status }).eq("id", String(fd.get("id") ?? ""));
  revalidatePath("/localidades");
}

export async function addDomain(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const domain = String(fd.get("domain") ?? "").trim().toLowerCase();
  const { knews } = await getKnewsSessionClient();
  const { error } = await knews.from("portal_domains").insert({ portal_id: String(fd.get("portal_id") ?? ""), domain, is_primary: fd.get("is_primary") === "on" });
  return error ? { ok: false, message: dbMessage(error.message) } : done(`Domínio ${domain} adicionado. O DNS é configurado fora do painel.`);
}

export async function saveIdentity(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getAdminContext();
  if (!ctx?.active || !canManage(ctx.active)) return { ok: false, message: "Somente o gerente regional do portal edita a identidade." };
  const text = (k: string) => String(fd.get(k) ?? "").trim();
  const theme = Object.fromEntries(
    Object.entries({ primary: text("primary"), accent: text("accent"), tagline: text("tagline"), logo_text: text("logo_text") }).filter(([, v]) => v !== ""),
  );
  const problems = themeProblems(theme);
  if (problems.length) return { ok: false, message: problems.join("; ") };
  const seo = Object.fromEntries(Object.entries({ description: text("description").slice(0, 200) }).filter(([, v]) => v !== ""));
  const portalName = z.string().trim().min(3).max(80).safeParse(fd.get("name"));
  if (!portalName.success) return { ok: false, message: "Nome do portal muito curto." };
  const { knews } = await getKnewsSessionClient();
  const { error, count } = await knews.from("portals").update({ name: portalName.data, theme, seo }, { count: "exact" }).eq("id", ctx.active.portalId);
  if (error) return { ok: false, message: dbMessage(error.message) };
  if (!count) return { ok: false, message: "Sem permissão para editar este portal." };
  revalidatePath("/portal", "layout");
  return done("Identidade salva: já vale para o portal público.");
}

export async function createCategory(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getAdminContext();
  if (!ctx?.active || !canEdit(ctx.active)) return { ok: false, message: "Sem permissão para editorias neste portal." };
  const n = name.safeParse(fd.get("name"));
  if (!n.success) return { ok: false, message: n.error.issues[0]!.message };
  const slug = slugOf(null, n.data);
  const position = Number(fd.get("position") ?? 100);
  const { knews } = await getKnewsSessionClient();
  const { error } = await knews
    .from("categories")
    .insert({ portal_id: ctx.active.portalId, name: n.data, slug, position: Number.isInteger(position) ? Math.min(Math.max(position, 0), 999) : 100 });
  return error ? { ok: false, message: dbMessage(error.message) } : done(`Editoria ${n.data} criada.`);
}
