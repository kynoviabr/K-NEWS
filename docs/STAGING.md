# Staging — Ambiente de homologacao SEPARADO do BLOGGER

> **Nao aplicar migrations em pnhxvhjudtrzvwduuigj (BLOGGER) em nenhuma hipotese.** Todas as migrations em `supabase/migrations/` usam `knews.*` e exigem projeto de **staging novo e isolado**.

## Correcao critica

- **Projeto `pnhxvhjudtrzvwduuigj` (BLOGGER) é proibido para staging K-NEWS.** Não execute `supabase db push`, `supabase link --project-ref pnhxvhjudtrzvwduuigj` ou qualquer alteração nesse projeto.
- **Staging K-NEWS:** crie um **projeto Supabase novo e vazio** (dashboard → New project) exclusivamente para K-NEWS. Anote `STAGING_REF`.

## Preparacao (somente no staging autorizado)

```bash
supabase link --project-ref <STAGING_REF>   # NAO usar pnhxvhjudtrzvwduuigj
supabase db push --linked --dry-run         # audite as 12 migrations knews em ordem
supabase db push --linked                   # so apos aprovar dry-run
supabase functions deploy knews-jobs knews-publish
```

12 migrations `knews` em ordem (não tocam `public.*`):
- `20261021000001_knews_foundation` (`knews` schema, `knews.jobs`, `knews.articles`, `knews.portals`, `can_read/edit_portal`)
- `20261022000002` / `20261023000001` / `20261023000003` (editorial + ads hardening)
- `20261024000001` (`knews.sources` / `fetch_logs`), `20261024000002` (`job_events`, `claim_jobs` SKIP LOCKED), `20261024000003` (`knews-creative` bucket + `ad_creatives`)
- `20261025000001` (`ad_reservations/events`, `knews.reserve_ad`)
- `20261026000001` .. `20261027000001` (news admin / publication / social-partners / observability)

## Variaveis (.env — staging isolado, sem segredos BLOGGER)

```
NEXT_PUBLIC_SUPABASE_URL=https://<STAGING_REF>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging anon>
SUPABASE_SERVICE_ROLE_KEY=<staging service_role>
CRON_SECRET=<openssl rand -hex 32>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Sem `portal24h.news` DNS; teste por `Host: guaruja.localhost`.

## Validacao em staging (sem dados BLOGGER)

### 1. RLS entre Guarujá e Santos

2 cidades (`guaruja`, `santos`) + 2 portais + `portal_domains` ficticios + 2 usuários com `portal_members` distintos.

```sql
set role anon; select count(*) from knews.articles; -- 0
set role authenticated; set request.jwt.claim.sub = '<user_guaruja>'; select * from knews.articles where portal_id = <id_santos>; -- 0
```

### 2. Jobs concorrentes, lease e DLQ

2 workers `claim_jobs('worker-1',1,60)` vs `worker-2` → 0 sobreposição (SKIP LOCKED); lease expirado + `max_attempts → dead_letter`; idempotência `unique(portal_id, idempotency_key)`.

### 3. Reserva transacional

`knews.reserve_ad` idempotente (`campaign_id+idempotency_key` único), `FOR UPDATE` lock, `expire_stale_reservations`.

### 4. Pipeline editorial + evidências

Feed RSS → `fetchRssSafe` (SSRF) → `deduplicateByCanonical` → `persistentDedupKeys` (`knews.processed_canonicals`) → `classifyRiskFromContext` → `isAutoPublishable` só `low+strong`.

### 5. Storage e sitemap

Upload `storage.objects` `knews-creative/<campaign_id>/<uuid>-<file>`; `sitemap.xml`/`robots.txt` por `Host`.

### 6. Checks CI

```bash
npm ci && npm run typecheck && npm run lint && npm test && npm run build
```

## Auditoria de migrations

Sem operações destrutivas sobre `public.*` ou `auth.*` compartilhados; `knews.claim_jobs`, `knews.reserve_ad` são `security definer`, `search_path=''`.

## Vercel wildcard

`*.portal24h.news` → `cname.vercel-dns.com` só após homologação autorizada. Sem DNS até aprovado.
