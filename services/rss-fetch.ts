import { z } from "zod";

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const BLOCKED_PREFIXES = ["10.", "192.168.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31."];

export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().split(":")[0] ?? "";
  if (BLOCKED_HOSTS.has(h)) return true;
  if (BLOCKED_PREFIXES.some((p) => h.startsWith(p))) return true;
  if (h === "169.254.169.254") return true;
  return false;
}

export function assertSafeUrl(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("URL invalida");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Protocolo nao permitido");
  if (isBlockedHost(u.host)) throw new Error("Destino interno bloqueado (SSRF)");
}

export async function fetchRssSafe(url: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<string> {
  assertSafeUrl(url);
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "K-NEWS/1.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) throw new Error("Resposta excede limite de tamanho");
    return new TextDecoder().decode(buf);
  } finally {
    clearTimeout(t);
  }
}

export const rssFetchResultSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  canonical: z.string().url().nullable(),
  publishedAt: z.string().nullable(),
  summary: z.string().nullable(),
});
export type RssFetchResult = z.infer<typeof rssFetchResultSchema>;
