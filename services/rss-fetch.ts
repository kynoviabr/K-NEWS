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

export function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v.includes(":")) {
    if (v === "::" || v === "::1") return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]!);
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(v);
  }
  const parts = v.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  // Somente testes de integracao locais: permite servidor RSS em 127.0.0.1.
  allowPrivateNetwork?: boolean;
  lookup?: (host: string) => Promise<string[]>;
};

async function defaultLookup(host: string): Promise<string[]> {
  const { lookup } = await import("node:dns/promises");
  const res = await lookup(host, { all: true, verbatim: true });
  return res.map((r) => r.address);
}

// Valida o destino resolvido (evita DNS apontando para rede interna).
async function assertResolvedSafe(url: string, opts: SafeFetchOptions): Promise<void> {
  if (opts.allowPrivateNetwork) return;
  assertSafeUrl(url);
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  const addresses = await (opts.lookup ?? defaultLookup)(host);
  if (addresses.length === 0 || addresses.some(isPrivateIp)) throw new Error("Destino interno bloqueado (SSRF)");
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new Error("Resposta excede limite de tamanho");
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Resposta excede limite de tamanho");
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

export async function fetchRssSafe(url: string, opts: SafeFetchOptions = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const maxRedirects = opts.maxRedirects ?? 2;
  let currentUrl = url;
  for (let r = 0; r <= maxRedirects; r++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Protocolo nao permitido");
    if (parsed.username || parsed.password) throw new Error("URL com credenciais nao permitida");
    await assertResolvedSafe(currentUrl, opts);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(currentUrl, {
        signal: controller.signal,
        headers: { "User-Agent": "K-NEWS/1.0 (+https://portal24h.news)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
        redirect: "manual",
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error(`Redirect sem Location`);
        if (r === maxRedirects) throw new Error("Muitos redirecionamentos");
        currentUrl = new URL(loc, currentUrl).toString();
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      if (type && !/xml|rss|atom|text\/plain/i.test(type)) throw new Error(`Content-Type nao suportado: ${type}`);
      return await readLimited(res, maxBytes);
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
