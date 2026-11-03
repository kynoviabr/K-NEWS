#!/usr/bin/env node
// Aplica as migrations do K-NEWS no Supabase compartilhado com o BLOGGER.
//
// Por que nao `supabase db push`: o historico do CLI (supabase_migrations.schema_migrations)
// e do BLOGGER. O push recusa porque as versoes do BLOGGER nao estao neste repositorio, e o
// `migration repair` que o CLI sugere apagaria esse historico. Aqui o historico do K-NEWS fica
// em knews_migrations.applied e o do BLOGGER nao e lido nem alterado.
//
// Uso (sem argumentos so mostra o que seria aplicado):
//   KNEWS_DATABASE_URL='postgresql://...' node scripts/knews-migrate.mjs
//   KNEWS_DATABASE_URL='postgresql://...' node scripts/knews-migrate.mjs --apply
//
// A URL nunca e impressa. Cada migration roda numa transacao propria; um erro desfaz so ela e para.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const EXPECTED_REF = process.env.KNEWS_EXPECTED_PROJECT_REF ?? "pnhxvhjudtrzvwduuigj";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const LOCK_KEY = 0x6b6e657773; // "knews"
const apply = process.argv.includes("--apply");
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

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

async function main() {
  const url = process.env.KNEWS_DATABASE_URL;
  if (!url) fail("defina KNEWS_DATABASE_URL (Dashboard > Connect > Session pooler, porta 5432).");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail("KNEWS_DATABASE_URL invalida.");
  }
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
