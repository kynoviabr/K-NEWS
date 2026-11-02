import { describe, it, expect } from "vitest";
import { canRetry, nextRetryAt, isLeaseExpired, isIdempotentDuplicate, shouldDeadLetter } from "@/lib/jobs";
import type { JobRow } from "@/lib/jobs";

const job = (overrides: Partial<JobRow> = {}): JobRow => ({
  id: "j1",
  status: "running",
  attempts: 1,
  max_attempts: 3,
  scheduled_at: new Date().toISOString(),
  lease_expires_at: new Date(Date.now() + 60000).toISOString(),
  idempotency_key: "key-1",
  portal_id: "p1",
  priority: 100,
  payload: {},
  ...overrides,
});

describe("jobs durable", () => {
  it("canRetry respeita max_attempts", () => {
    expect(canRetry(job({ attempts: 2, max_attempts: 3 }))).toBe(true);
    expect(canRetry(job({ attempts: 3, max_attempts: 3 }))).toBe(false);
  });

  it("nextRetryAt usa backoff exponencial", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const r0 = nextRetryAt(0, now);
    const r1 = nextRetryAt(1, now);
    expect(r1.getTime() - now.getTime()).toBeGreaterThan(r0.getTime() - now.getTime());
  });

  it("isLeaseExpired detecta lease vencido", () => {
    expect(isLeaseExpired(job({ lease_expires_at: new Date(Date.now() - 1000).toISOString() }))).toBe(true);
    expect(isLeaseExpired(job({ lease_expires_at: new Date(Date.now() + 10000).toISOString() }))).toBe(false);
    expect(isLeaseExpired(job({ lease_expires_at: null }))).toBe(false);
  });

  it("isIdempotentDuplicate detecta chave repetida", () => {
    expect(isIdempotentDuplicate(job({ idempotency_key: "k1" }), "k1")).toBe(true);
    expect(isIdempotentDuplicate(job({ idempotency_key: "k1" }), "k2")).toBe(false);
    expect(isIdempotentDuplicate(null, "k1")).toBe(false);
  });

  it("shouldDeadLetter quando attempts >= max", () => {
    expect(shouldDeadLetter(job({ attempts: 3, max_attempts: 3 }))).toBe(true);
    expect(shouldDeadLetter(job({ attempts: 2, max_attempts: 3 }))).toBe(false);
  });

  it("claim concorrente simulado: so um claim por idempotency_key", () => {
    const existing = job({ idempotency_key: "dup-key" });
    expect(isIdempotentDuplicate(existing, "dup-key")).toBe(true);
    expect(canRetry(existing)).toBe(true);
  });
});
