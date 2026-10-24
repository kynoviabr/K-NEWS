import { createHash } from "node:crypto";

// Utilitarios puros do motor de anuncios (sem dependencia de Next), testaveis em unidade.

export const CONSENT_COOKIE = "kn_consent";
export const VISITOR_COOKIE = "kn_vid";

export type Device = "desktop" | "mobile" | "tablet";

export function detectDevice(userAgent: string | null | undefined): Device {
  const ua = userAgent ?? "";
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Android|Windows Phone|Opera Mini/i.test(ua)) return "mobile";
  return "desktop";
}

// Consentimento LGPD: sem "ads=granted" nao ha identificador de visitante nem
// scripts de terceiros; a entrega direta continua, sem limite de frequencia.
export function hasAdsConsent(cookieValue: string | null | undefined): boolean {
  return cookieValue === "ads=granted";
}

// O identificador bruto nunca vai para o banco: grava-se o hash com sal do servidor.
export function hashVisitor(visitorId: string | null | undefined, salt: string): string | null {
  if (!visitorId || !/^[A-Za-z0-9-]{16,64}$/.test(visitorId)) return null;
  return createHash("sha256").update(`${salt}:${visitorId}`).digest("hex");
}

export const RESERVATION_TOKEN = /^[a-f0-9]{64}$/;

// Destino de clique/redirecionamento: so https, sem credenciais na URL.
export function isSafeRedirectUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password && !!u.hostname && !/\s/.test(raw);
  } catch {
    return false;
  }
}

export type RevenueRow = { source: string; status: string; amount_cents: number; contract_id: string | null };
// Comissoes sao calculadas no banco (knews.partner_commissions), a partir da receita confirmada.
export function summarizeRevenue(revenue: RevenueRow[]): { confirmedCents: number; estimatedCents: number } {
  let confirmedCents = 0;
  let estimatedCents = 0;
  for (const r of revenue) {
    if (r.status === "confirmed" || r.status === "paid") confirmedCents += Number(r.amount_cents);
    else if (r.status === "estimated") estimatedCents += Number(r.amount_cents);
  }
  return { confirmedCents, estimatedCents };
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function parseMoneyToCents(raw: string | null | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const normalized = raw.trim().replace(/\s|R\$/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100);
}
