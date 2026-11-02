import { z } from "zod";

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "169.254.169.254"]);

export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().split(":")[0]?.trim() ?? "";
  if (BLOCKED_HOSTS.has(h)) return true;
  if (h.startsWith("10.")) return true;
  if (h.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h.startsWith("169.254.")) return true;
  if (h === "0.0.0.0") return true;
  if (h.includes(":")) return true; // IPv6 literal — bloquear por padrão em staging
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
  if (isBlockedHost(u.host) || isBlockedHost(u.hostname)) throw new Error("Destino interno bloqueado (SSRF)");
}

export async function fetchRssSafe(url: string, opts: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number } = {}): Promise<string> {
  assertSafeUrl(url);
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const maxRedirects = opts.maxRedirects ?? 2;
  let currentUrl = url;
  for (let r = 0; r <= maxRedirects; r++) {
    assertSafeUrl(currentUrl);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(currentUrl, { signal: controller.signal, headers: { "User-Agent": "K-NEWS/1.0" }, redirect: "manual" });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error(`Redirect sem Location`);
        currentUrl = new URL(loc, currentUrl).toString();
        assertSafeUrl(currentUrl);
        if (r === maxRedirects) throw new Error("Muitos redirecionamentos");
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      if (buf.byteLength > maxBytes) throw new Error("Resposta excede limite de tamanho");
      return new TextDecoder().decode(buf);
    } finally {
      clearTimeout(t);
    }
  }
  throw new Error("Falha ao buscar RSS");
}

export const rssFetchResultSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  canonical: z.string().url().nullable(),
  publishedAt: z.string().nullable(),
  summary: z.string().nullable(),
});
export type RssFetchResult = z.infer<typeof rssFetchResultSchema>;
