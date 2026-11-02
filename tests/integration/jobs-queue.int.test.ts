import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connect } from "./db";
import { IDS, seed } from "./fixtures";

// Fila duravel real: varias conexoes concorrentes chamando knews.claim_jobs.
let admin: Client;
const workers: Client[] = [];
const JOB_TAG = "int-test-jobs";

beforeAll(async () => {
  admin = await connect();
  await seed(admin);
  for (let i = 0; i < 4; i++) {
    const c = await connect();
    await c.query("set role service_role");
    workers.push(c);
  }
});

afterAll(async () => {
  await admin.query("delete from knews.jobs where payload->>'tag' = $1", [JOB_TAG]);
  await Promise.all([admin, ...workers].map((c) => c.end()));
});

beforeEach(async () => {
  await admin.query("delete from knews.jobs where payload->>'tag' = $1", [JOB_TAG]);
});

async function enqueue(n: number, extra: Record<string, unknown> = {}): Promise<string[]> {
  const res = await admin.query<{ id: string }>(
    `insert into knews.jobs (portal_id, job_type, payload, max_attempts)
     select $1, 'rss_fetch', jsonb_build_object('tag', $2::text, 'n', g), coalesce(($3::jsonb->>'max_attempts')::int, 5)
     from generate_series(1, $4) g returning id`,
    [IDS.portalGuaruja, JOB_TAG, JSON.stringify(extra), n],
  );
  return res.rows.map((r) => r.id);
}

async function claim(c: Client, worker: string, limit: number, lease = 60): Promise<string[]> {
  const res = await c.query<{ id: string; payload: { tag?: string } }>("select id, payload from knews.claim_jobs($1, $2, $3)", [worker, limit, lease]);
  return res.rows.filter((r) => r.payload.tag === JOB_TAG).map((r) => r.id);
}

describe("knews.claim_jobs concorrente", () => {
  it("4 workers simultaneos nunca recebem o mesmo job", async () => {
    const ids = await enqueue(40);
    const rounds = await Promise.all(workers.map((w, i) => claim(w, `w${i}`, 15)));
    const claimed = rounds.flat();
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(claimed.length).toBe(ids.length);
    const st = await admin.query<{ n: string }>(
      "select count(*)::text n from knews.jobs where payload->>'tag' = $1 and status = 'running' and attempts = 1",
      [JOB_TAG],
    );
    expect(Number(st.rows[0]?.n)).toBe(40);
  });

  it("lease expirado volta para retrying e e reivindicado de novo", async () => {
    await enqueue(1);
    const [first] = await claim(workers[0]!, "crashed-worker", 1, 1);
    expect(first).toBeDefined();
    // Simula queda do worker: o lease vence sem complete/fail.
    await admin.query("update knews.jobs set lease_expires_at = now() - interval '1 second' where id = $1", [first]);
    const again = await claim(workers[1]!, "recovery-worker", 1);
    expect(again).toEqual([first]);
    const row = await admin.query<{ attempts: number; claimed_by: string }>("select attempts, claimed_by from knews.jobs where id = $1", [first]);
    expect(row.rows[0]).toMatchObject({ attempts: 2, claimed_by: "recovery-worker" });
  });

  it("falha com retry aplica backoff e, no limite, vai para dead_letter", async () => {
    await enqueue(1, { max_attempts: 2 });
    const [id] = await claim(workers[0]!, "w", 1);
    await workers[0]!.query("select knews.fail_job($1, 'timeout na fonte', true)", [id]);
    let row = await admin.query<{ status: string; delay: number }>(
      "select status, extract(epoch from scheduled_at - now())::int as delay from knews.jobs where id = $1",
      [id],
    );
    expect(row.rows[0]?.status).toBe("retrying");
    expect(row.rows[0]?.delay).toBeGreaterThan(30);
    // Ainda nao vencido: nao pode ser reivindicado.
    expect(await claim(workers[1]!, "w", 5)).toEqual([]);

    await admin.query("update knews.jobs set scheduled_at = now() where id = $1", [id]);
    expect(await claim(workers[1]!, "w", 5)).toEqual([id]);
    await workers[1]!.query("select knews.fail_job($1, 'timeout de novo', true)", [id]);
    row = await admin.query("select status from knews.jobs where id = $1", [id]);
    expect(row.rows[0]?.status).toBe("dead_letter");
    const events = await admin.query<{ to_status: string }>("select to_status from knews.job_events where job_id = $1 order by at", [id]);
    expect(events.rows.map((e) => e.to_status)).toEqual(["retrying", "dead_letter"]);
  });

  it("complete_job conclui e registra evento", async () => {
    await enqueue(1);
    const [id] = await claim(workers[2]!, "w", 1);
    await workers[2]!.query("select knews.complete_job($1, '{\"items\": 3}'::jsonb)", [id]);
    const row = await admin.query<{ status: string; result: { items: number } }>("select status, result from knews.jobs where id = $1", [id]);
    expect(row.rows[0]).toMatchObject({ status: "completed", result: { items: 3 } });
  });

  it("idempotency_key repetida no mesmo portal e rejeitada", async () => {
    await admin.query("insert into knews.jobs (portal_id, job_type, payload, idempotency_key) values ($1, 'rss_fetch', $2, 'fonte-1:2026-10-24T11')", [
      IDS.portalGuaruja,
      { tag: JOB_TAG },
    ]);
    await expect(
      admin.query("insert into knews.jobs (portal_id, job_type, payload, idempotency_key) values ($1, 'rss_fetch', $2, 'fonte-1:2026-10-24T11')", [
        IDS.portalGuaruja,
        { tag: JOB_TAG },
      ]),
    ).rejects.toThrow(/uq_knews_jobs_idempotency/);
  });
});
