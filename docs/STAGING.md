# Staging — Ambiente de homologacao separado

> **Nao aplicar migrations em producao sem aprovacao.** Todas as migrations em `supabase/migrations/` estao com header `NAO APLICAR EM PRODUCAO` e usam schema `knews` isolado de `public.*` (BLOGGER).

## Projeto Supabase de staging

Crie um **projeto Supabase novo e vazio** para homologacao (nao reutilize `pnhxvhjudtrzvwduuigj` do BLOGGER, nunca reutilize seus segredos ou dados).

```bash
supabase link --project-ref <STAGING_REF>
supabase db push --linked   # aplica supabase/migrations/ em ordem cronologica (12 arquivos 20261021*..20261027*)
supabase functions deploy knews-jobs knews-publish
```

12 migrations em ordem (não tocar `public.*`):
- `20261021000001_knews_foundation` (knews, `knews.jobs`, `knews.articles`, `knews.portals`)
- `20261022000002_knews_editorial_ads` / `20261023000001/00003` (editorial + ads)
- `20261024000001_knews_sources_pipeline` (`knews.sources`, `knews.fetch_logs`)
- `20261024000002_knews_jobs_hardening` (`knews.job_events`, `claim_jobs` SKIP LOCKED)
- `20261024000003_knews_ads_storage` (`storage.objects` bucket `knews-creative`, `ad_creatives`)
- `20261025000001_knews_ad_rpc` (`ad_reservations/events`, `knews.reserve_ad`)
- `20261026000001_knews_news_admin` .. `20261027000001_knews_observability`

## Variaveis (.env / .env.local — sem segredos BLOGGER)

```
NEXT_PUBLIC_SUPABASE_URL=https://<STAGING_REF>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging anon>
SUPABASE_SERVICE_ROLE_KEY=<staging service_role>
CRON_SECRET=<openssl rand -hex 32>
NEXT_PUBLIC_APP_URL=http://localhost:3000
DEEPSEEK_API_KEY / OPENAI_API_KEY / META_*  — staging apenas
```

`portal24h.news` wildcard **nao** aponta DNS em staging; teste por `Host: guaruja.portal24h.news` ou `/etc/hosts`.

## Validacao em staging (sem dados BLOGGER)

### 1. RLS entre Guarujá e Santos

Criar 2 cidades (`guaruja`, `santos`) + 2 portais + `portal_domains` (`guaruja.portal24h.news`, `santos.portal24h.news`) + 2 usuários com `portal_members` distintos.

```sql
-- anon 0 linhas; authenticated sem portal_members 0 linhas em knews.articles do outro portal
set role anon; select count(*) from knews.articles; -- 0
set role authenticated; set request.jwt.claim.sub = '<user_guaruja>'; select * from knews.articles where portal_id = <id_santos>; -- 0
```

### 2. Jobs concorrentes, lease e DLQ

```sql
insert into knews.jobs(portal_id, job_type, payload, priority) values
  ('<p_guaruja>', 'rss_fetch', '{}', 100),
  ('<p_guaruja>', 'rss_fetch', '{}', 100);
-- 2 workers: SELECT knews.claim_jobs('worker-1',1,60) e claim_jobs('worker-2',1,60) → 0 sobreposição (SKIP LOCKED)
-- Lease expirado: update knews.jobs set lease_expires_at = now() - interval '1 minute' where id = <id> → próximo claim recupera para retrying
-- Worker interrompido: mesmo recovery; max_attempts → dead_letter
-- Idempotencia: unique(portal_id, idempotency_key) — segunda insert com mesma key retorna existente
```

### 3. Reserva transacional de publicidade

```sql
select knews.reserve_ad('<campaign_id>', 'slot_topo', 'idem-1', 300); -- reserva
select knews.reserve_ad('<campaign_id>', 'slot_topo', 'idem-1', 300); -- idempotente, mesma row
-- 2 reservas concorrentes com mesmo idempotency_key não duplicam (UNIQUE)
select knews.expire_stale_reservations(); -- expira reservas com expires_at < now(), estorna impressions_served
```

### 4. Pipeline editorial + evidências

Feed RSS → `fetchRssSafe` (timeout, maxBytes, redirect reval., SSRF) → `deduplicateByCanonical` → `persistentDedupKeys` (`knews.processed_canonicals`) → `classifyRiskFromContext` (independent hosts, `factCheckClaims`, stale, prompt injection) → `isAutoPublishable` só `low+strong` sem `unverifiedClaims`. Autopublicação real desabilitada até homologação.

### 5. Sitemap/robots e Storage

`GET /sitemap.xml` e `/robots.txt` com `Host: guaruja.portal24h.news` retorna URLs `https://guaruja.portal24h.news/...`; `Host: santos...` retorna isolado. Upload criativo `storage.objects` `knews-creative/<campaign_id>/<uuid>-<file>` com RLS.

### 6. Checks CI

```bash
npm ci && npm run typecheck && npm run lint && npm test && npm run build
# GitHub Actions .github/workflows/ci.yml idem
```

## Dados

Sem dados reais nem segredos do BLOGGER. Cidades/portais ficticios (`guaruja`, `santos`) e campanhas de teste com `ad_campaign_placements/geo_targets`.

## Vercel wildcard

`*.portal24h.news` em Vercel → Settings → Domains — apenas apos homologacao e autorizacao de DNS (`*.portal24h.news` → `cname.vercel-dns.com`). Sem DNS até aprovado.
