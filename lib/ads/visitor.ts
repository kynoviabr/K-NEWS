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
export type ContractRow = { id: string; reference: string; partner_id: string | null; commission_pct: number };
export type CommissionLine = { contractId: string; reference: string; partnerId: string; baseCents: number; pct: number; commissionCents: number };

// Comissao incide so sobre receita confirmada ou paga de contratos com parceiro.
export function computeCommissions(revenue: RevenueRow[], contracts: ContractRow[]): CommissionLine[] {
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const base = new Map<string, number>();
  for (const r of revenue) {
    if (!r.contract_id || (r.status !== "confirmed" && r.status !== "paid")) continue;
    base.set(r.contract_id, (base.get(r.contract_id) ?? 0) + Number(r.amount_cents));
  }
  const lines: CommissionLine[] = [];
  for (const [contractId, baseCents] of base) {
    const c = byId.get(contractId);
    if (!c?.partner_id || Number(c.commission_pct) <= 0) continue;
    const pct = Number(c.commission_pct);
    lines.push({ contractId, reference: c.reference, partnerId: c.partner_id, baseCents, pct, commissionCents: Math.round((baseCents * pct) / 100) });
  }
  return lines.sort((a, b) => b.commissionCents - a.commissionCents);
}

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
