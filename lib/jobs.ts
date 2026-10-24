export type JobStatus = "queued" | "running" | "retrying" | "completed" | "dead_letter" | "cancelled";
export type JobRow = {
  id: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  scheduled_at: string;
  lease_expires_at: string | null;
  idempotency_key: string | null;
  portal_id: string | null;
  priority: number;
  payload: Record<string, unknown>;
};

export function canRetry(job: JobRow): boolean {
  return job.attempts < job.max_attempts;
}

export function nextRetryAt(attempts: number, now: Date = new Date()): Date {
  const delaySec = Math.pow(2, attempts) * 30;
  return new Date(now.getTime() + delaySec * 1000);
}

export function isLeaseExpired(job: JobRow, now: Date = new Date()): boolean {
  if (!job.lease_expires_at) return false;
  return new Date(job.lease_expires_at) < now;
}

export function isIdempotentDuplicate(existing: JobRow | null, idempotencyKey: string | null): boolean {
  if (!idempotencyKey) return false;
  if (!existing) return false;
  return existing.idempotency_key === idempotencyKey;
}

export function shouldDeadLetter(job: JobRow): boolean {
  return job.attempts >= job.max_attempts;
}
