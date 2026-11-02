import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { asActor, connect, tryQuery } from "./db";
import { IDS, seed } from "./fixtures";

// Operacao da automacao: visao da fila so para quem opera, reprocessar e cancelar
// com trilha, e auditoria sem portal fora do alcance de usuarios comuns do Auth.

const OPERATOR = "00000000-0000-4000-8000-0000000000e1";
let pg: Client;
let deadJob = "";
let queuedJob = "";
let doneJob = "";

beforeAll(async () => {
  pg = await connect();
  await seed(pg);
  await pg.query(
    `insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'operador@knews.test', now(), now()) on conflict (id) do nothing`,
    [OPERATOR],
  );
  await pg.query("insert into knews.portal_members (portal_id, user_id, role) values ($1, $2, 'technical_operator') on conflict do nothing", [IDS.portalSantos, OPERATOR]);
  await pg.query("delete from knews.jobs where idempotency_key like 'ops-test:%'");
  const ins = async (status: string, key: string) =>
    (
      await pg.query<{ id: string }>(
        `insert into knews.jobs (portal_id, job_type, status, payload, idempotency_key, attempts, last_error, failed_at)
         values ($1, 'rss_fetch', $2, '{}', $3, case when $2 = 'dead_letter' then 5 else 0 end, case when $2 = 'dead_letter' then 'HTTP 500 na fonte' end,
                 case when $2 = 'dead_letter' then now() end) returning id`,
        [IDS.portalGuaruja, status, key],
      )
    ).rows[0]!.id;
  deadJob = await ins("dead_letter", "ops-test:dead");
  queuedJob = await ins("queued", "ops-test:queued");
  doneJob = await ins("completed", "ops-test:done");
  await pg.query("delete from knews.audit_logs where action in ('ops-test.rede','ops-test.editorial')");
  await pg.query(
    `insert into knews.audit_logs (portal_id, action, target_type, target_id) values
       (null, 'ops-test.rede', 'partner', 'x'), ($1, 'ops-test.editorial', 'article', 'y')`,
    [IDS.portalGuaruja],
  );
});

afterAll(async () => {
  await pg.query("delete from knews.jobs where idempotency_key like 'ops-test:%'");
  await pg.query("delete from knews.audit_logs where action like 'ops-test.%' or (action in ('job.requeue','job.cancel') and target_id = any($1))", [[deadJob, queuedJob, doneJob]]);
  await pg.query("delete from knews.portal_members where user_id = $1", [OPERATOR]);
  await pg.end();
});

describe("auditoria", () => {
  it("linhas da rede so para super_admin; do portal so para a gestao", async () => {
    const actions = async (userId: string) =>
      asActor(pg, { role: "authenticated", userId }, async (c) => (await c.query<{ action: string }>("select action from knews.audit_logs where action like 'ops-test.%' order by action")).rows.map((r) => r.action));
    expect(await actions(IDS.outsider)).toEqual([]);
    expect(await actions(IDS.commercialGuaruja)).toEqual([]);
    expect(await actions(IDS.editorGuaruja)).toEqual([]);
    expect(await actions(IDS.managerGuaruja)).toEqual(["ops-test.editorial"]);
    expect(await actions(IDS.superAdmin)).toEqual(["ops-test.editorial", "ops-test.rede"]);
    await asActor(pg, { role: "authenticated", userId: IDS.managerGuaruja }, async (c) => {
      expect((await tryQuery(c, "insert into knews.audit_logs (portal_id, action, target_type) values ($1, 'forjado', 'x')", [IDS.portalGuaruja])).error).toMatch(/permission denied/);
    });
  });
});

describe("fila", () => {
  it("visao da operacao so para super_admin e operador tecnico", async () => {
    await asActor(pg, { role: "authenticated", userId: IDS.editorGuaruja }, async (c) => {
      expect((await c.query("select knews.ops_overview() as o")).rows[0].o).toBeNull();
    });
    for (const userId of [IDS.superAdmin, OPERATOR]) {
      await asActor(pg, { role: "authenticated", userId }, async (c) => {
        const o = (await c.query("select knews.ops_overview() as o")).rows[0].o;
        expect(o.dead_letter).toBeGreaterThanOrEqual(1);
        expect(o.due_backlog).toBeGreaterThanOrEqual(1);
        expect(o.recent_dead_letters).toEqual(expect.arrayContaining([expect.objectContaining({ id: deadJob, last_error: "HTTP 500 na fonte" })]));
      });
    }
    await asActor(pg, { role: "anon" }, async (c) => {
      expect((await tryQuery(c, "select knews.ops_overview()")).error).toMatch(/permission denied/);
    });
  });

  it("reprocessar e cancelar ficam com a operacao e deixam trilha", async () => {
    await asActor(pg, { role: "authenticated", userId: IDS.managerGuaruja }, async (c) => {
      expect((await tryQuery(c, "select knews.requeue_job($1)", [deadJob])).error).toMatch(/somente operacao/);
      expect((await tryQuery(c, "select knews.cancel_job($1)", [queuedJob])).error).toMatch(/somente operacao/);
    });
    await asActor(pg, { role: "authenticated", userId: OPERATOR }, async (c) => {
      // O operador e de Santos e o job e de Guaruja: confere o resultado fora da RLS.
      const asAdmin = async (sql: string, params: unknown[]) => {
        await c.query("reset role");
        try {
          return await c.query(sql, params);
        } finally {
          await c.query("set local role authenticated");
        }
      };
      await c.query("select knews.requeue_job($1)", [deadJob]);
      const j = await asAdmin("select status, attempts from knews.jobs where id = $1", [deadJob]);
      expect(j.rows[0]).toEqual({ status: "queued", attempts: 0 });
      expect((await tryQuery(c, "select knews.requeue_job($1)", [doneJob])).error).toMatch(/so job em dead-letter/);
      await c.query("select knews.cancel_job($1)", [queuedJob]);
      expect((await asAdmin("select status from knews.jobs where id = $1", [queuedJob])).rows[0].status).toBe("cancelled");
      expect((await tryQuery(c, "select knews.cancel_job($1)", [doneJob])).error).toMatch(/nao pode ser cancelado/);
      const trail = await asAdmin("select action from knews.audit_logs where target_id = any($1) order by action", [[deadJob, queuedJob]]);
      expect(trail.rows.map((r) => r.action)).toEqual(["job.cancel", "job.requeue"]);
      const events = await asAdmin("select to_status from knews.job_events where job_id = $1", [deadJob]);
      expect(events.rows.map((r) => r.to_status)).toContain("queued");
    });
  });
});
