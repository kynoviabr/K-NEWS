import { Client } from "pg";

// Banco LOCAL do Supabase (Docker). Recusa qualquer host que nao seja local
// para impedir execucao acidental contra o projeto remoto compartilhado.
export const LOCAL_DB_URL =
  process.env.KNEWS_LOCAL_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "db", "supabase_db_k-news-local"]);

export function assertLocal(url: string): void {
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Integracao recusada: host ${host} nao e o Supabase local.`);
  }
}

export async function connect(): Promise<Client> {
  assertLocal(LOCAL_DB_URL);
  const client = new Client({ connectionString: LOCAL_DB_URL });
  await client.connect();
  return client;
}

export type Actor =
  | { role: "anon" }
  | { role: "authenticated"; userId: string }
  | { role: "service_role" };

// Executa fn dentro de uma transacao com o papel e as claims JWT do ator,
// como o PostgREST faz, e desfaz tudo ao final.
export async function asActor<T>(client: Client, actor: Actor, fn: (c: Client) => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    const claims = actor.role === "authenticated" ? { sub: actor.userId, role: "authenticated" } : { role: actor.role };
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await client.query(`set local role ${actor.role}`);
    return await fn(client);
  } finally {
    await client.query("rollback");
  }
}

// Captura o erro de uma instrucao sem abortar a transacao externa.
export async function tryQuery(client: Client, sql: string, params: unknown[] = []): Promise<{ error: string | null; rowCount: number }> {
  await client.query("savepoint try_query");
  try {
    const res = await client.query(sql, params);
    await client.query("release savepoint try_query");
    return { error: null, rowCount: res.rowCount ?? 0 };
  } catch (e) {
    await client.query("rollback to savepoint try_query");
    return { error: e instanceof Error ? e.message : String(e), rowCount: 0 };
  }
}
