#!/usr/bin/env node
// Aplica as migrations do K-NEWS no Supabase compartilhado com o BLOGGER.
//
// Por que nao `supabase db push`: o historico do CLI (supabase_migrations.schema_migrations)
// e do BLOGGER. O push recusa porque as versoes do BLOGGER nao estao neste repositorio, e o
// `migration repair` que o CLI sugere apagaria esse historico. Aqui o historico do K-NEWS fica
// em knews_migrations.applied e o do BLOGGER nao e lido nem alterado.
//
// Uso (sem argumentos so mostra o que seria aplicado), na pasta ja linkada com `supabase link`:
//   npm run db:knews              -> pede a senha do banco (sem eco) e lista o que seria aplicado
//   npm run db:knews -- --apply   -> aplica
// O endereco vem de supabase/.temp/pooler-url (gravado pelo `supabase link`), em modo sessao
// (porta 5432). KNEWS_DATABASE_URL substitui esse endereco; senha com @, #, / etc. funciona.
//
// A URL e a senha nunca sao impressas. Cada migration roda numa transacao propria; um erro desfaz so ela e para.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const EXPECTED_REF = process.env.KNEWS_EXPECTED_PROJECT_REF ?? "pnhxvhjudtrzvwduuigj";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const LOCK_KEY = 0x6b6e657773; // "knews"
const apply = process.argv.includes("--apply");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "supabase", "migrations");

function fail(message) {
  console.error(`\nPARADO: ${message}`);
  process.exit(1);
}

// Comentarios fora, para checar so o SQL que roda.
const stripComments = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

// Nada fora do K-NEWS: schema public (BLOGGER), historico do CLI, schemas inteiros de outros.
const FORBIDDEN = [
  [/\bpublic\s*\./i, "referencia ao schema public (BLOGGER)"],
  [/\bsupabase_migrations\b/i, "historico de migrations do CLI (BLOGGER)"],
  [/\bdrop\s+schema\s+(?!if\s+exists\s+knews|knews)/i, "drop schema fora do K-NEWS"],
  [/\b(alter|drop)\s+(role|database)\b/i, "alteracao de role ou banco"],
  [/\balter\s+default\s+privileges\b/i, "privilegios padrao do projeto"],
];

function migrations() {
  return readdirSync(dir)
    .filter((f) => /^\d{14}_knews_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const sql = readFileSync(join(dir, file), "utf8");
      const problems = FORBIDDEN.filter(([re]) => re.test(stripComments(sql))).map(([, why]) => why);
      return { version: file.slice(0, 14), file, sql, checksum: createHash("sha256").update(sql).digest("hex"), problems };
    });
}

// Senha digitada sem eco no terminal.
function askHidden(prompt) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) fail("rode num terminal interativo para digitar a senha.");
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

// Aceita senha crua na URL (com @, # etc.): o host comeca depois do ULTIMO @.
function parseLoose(raw) {
  const m = /^(postgres(?:ql)?):\/\/([^:/]+)(?::(.*))?@([^@/]+)(\/[^?#]*)?(\?.*)?$/.exec(raw.trim());
  if (!m) return null;
  const [, scheme, user, password, hostPort, path = "/postgres", query = ""] = m;
  const url = new URL(`${scheme}://${hostPort}${path}${query}`);
  url.username = user;
  // O setter do URL nao escapa "%"; escapa tudo antes para a senha chegar intacta.
  if (password !== undefined) url.password = encodeURIComponent(password);
  return url;
}

async function resolveUrl() {
  if (process.env.KNEWS_DATABASE_URL) {
    const url = parseLoose(process.env.KNEWS_DATABASE_URL);
    if (!url) fail("KNEWS_DATABASE_URL invalida (esperado postgresql://usuario:senha@host:porta/postgres).");
    if (url.password.includes("YOUR-PASSWORD")) fail("troque [YOUR-PASSWORD] pela senha do banco, sem colchetes.");
    return url;
  }
  const file = join(root, "supabase", ".temp", "pooler-url");
  if (!existsSync(file)) fail("rode `supabase link --project-ref " + EXPECTED_REF + "` nesta pasta antes (ou defina KNEWS_DATABASE_URL).");
  const url = parseLoose(readFileSync(file, "utf8"));
  if (!url) fail("supabase/.temp/pooler-url invalido; rode `supabase link` de novo.");
  // Pooler em modo sessao (5432): uma transacao por migration precisa de conexao fixa.
  if (url.hostname.endsWith(".pooler.supabase.com")) url.port = "5432";
  const password = await askHidden("Senha do banco (nao aparece na tela): ");
  if (!password) fail("senha vazia.");
  url.password = encodeURIComponent(password);
  return url;
}

async function main() {
  const parsed = await resolveUrl();
  const url = parsed.toString();
  const local = LOCAL_HOSTS.has(parsed.hostname);
  const target = `${parsed.hostname} ${decodeURIComponent(parsed.username)}`;
  if (!local && !target.includes(EXPECTED_REF)) fail(`a conexao nao e do projeto ${EXPECTED_REF}.`);

  const files = migrations();
  const bad = files.filter((m) => m.problems.length);
  if (bad.length) fail(bad.map((m) => `${m.file}: ${m.problems.join(", ")}`).join("\n"));

  const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, application_name: "knews-migrate" });
  await client.connect();
  try {
    const info = (await client.query("select current_database() as db, current_user as usr, split_part(version(), ' ', 2) as pg")).rows[0];
    console.log(`Projeto: ${local ? "LOCAL" : EXPECTED_REF} | banco: ${info.db} | usuario: ${info.usr} | Postgres ${info.pg}`);

    const locked = (await client.query("select pg_try_advisory_lock($1) as ok", [LOCK_KEY])).rows[0].ok;
    if (!locked) fail("outra execucao do knews-migrate esta em andamento.");

    const state = (
      await client.query(`select
        exists (select 1 from pg_namespace where nspname = 'knews') as knews,
        exists (select 1 from pg_namespace where nspname = 'knews_public') as knews_public,
        to_regclass('knews_migrations.applied') is not null as history,
        (select count(*)::int from storage.buckets where id like 'knews-%') as buckets`)
    ).rows[0];
    const applied = new Map();
    if (state.history) {
      for (const r of (await client.query("select version, file, checksum from knews_migrations.applied order by version")).rows) applied.set(r.version, r);
    } else if (state.knews || state.knews_public || state.buckets > 0) {
      fail("ja existe schema knews/knews_public ou bucket knews-* sem historico do K-NEWS. Estado parcial desconhecido: conferir antes de aplicar.");
    }

    for (const [version, row] of applied) {
      const file = files.find((m) => m.version === version);
      if (!file) fail(`versao ${version} aplicada no banco nao existe no repositorio.`);
      if (file.checksum !== row.checksum) fail(`${file.file} mudou depois de aplicada (checksum diferente).`);
    }
    const pending = files.filter((m) => !applied.has(m.version));
    if (pending.length && applied.size && pending[0].version < [...applied.keys()].pop()) {
      fail(`${pending[0].file} e anterior a ultima aplicada; ordem quebrada.`);
    }

    console.log(`Aplicadas: ${applied.size} | pendentes: ${pending.length}`);
    for (const m of pending) console.log(`  - ${m.file}`);
    if (!pending.length) return;
    if (!apply) {
      console.log("\nNada foi alterado. Para aplicar: repita com --apply.");
      return;
    }

    await client.query(`create schema if not exists knews_migrations;
      revoke all on schema knews_migrations from public;
      create table if not exists knews_migrations.applied (
        version text primary key,
        file text not null,
        checksum text not null,
        applied_at timestamptz not null default now(),
        applied_by text not null default current_user
      );
      revoke all on knews_migrations.applied from public;`);

    for (const m of pending) {
      process.stdout.write(`Aplicando ${m.file} ... `);
      try {
        await client.query("begin");
        await client.query("set local lock_timeout = '10s'; set local statement_timeout = '120s'");
        await client.query(m.sql);
        await client.query("insert into knews_migrations.applied (version, file, checksum) values ($1, $2, $3)", [m.version, m.file, m.checksum]);
        await client.query("commit");
        console.log("ok");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        console.log("ERRO");
        fail(`${m.file}: ${error.message}. Esta migration foi desfeita; as anteriores ficaram aplicadas.`);
      }
    }

    const after = (
      await client.query(`select
        (select count(*)::int from pg_tables where schemaname = 'knews') as tables,
        (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'knews_public') as public_functions,
        (select string_agg(id, ', ' order by id) from storage.buckets where id like 'knews-%') as buckets`)
    ).rows[0];
    console.log(`\nConcluido: ${after.tables} tabelas em knews, ${after.public_functions} funcoes em knews_public, buckets: ${after.buckets ?? "nenhum"}.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => fail(error.message));
