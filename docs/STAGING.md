# Staging — Homologacao no mesmo Supabase (sem custo extra)

> **Decisao definitiva:** K-NEWS usa exclusivamente o projeto Supabase do BLOGGER `pnhxvhjudtrzvwduuigj` — nao criar outro projeto. Todas as migrations em `supabase/migrations/` usam `knews.*` isolado de `public.*` e tem header `NAO APLICAR EM PRODUCAO SEM AUTORIZACAO`. Desenvolvimento e testes locais via `supabase start` (Docker).

## Desenvolvimento local (Docker, sem BLOGGER, sem novo projeto pago)

```bash
supabase start          # sobe Postgres + Auth + Storage local via Docker
supabase db reset       # aplica as 13 migrations knews em ordem (validadas em docs/HOMOLOGACAO-LOCAL.md) (--debug para auditar)
supabase functions serve knews-jobs knews-publish
```

## Implantacao controlada no projeto compartilhado `pnhxvhjudtrzvwduuigj`

Antes de qualquer `supabase db push`:

1. Revisar as 13 migrations em ordem (sem `public.*`, sem `DROP public`, `knews.*` com `search_path=''`, `SECURITY DEFINER` auditado).
2. Verificar que `knews` não referencia `public.*` e vice-versa.
3. Auditar RLS (`can_read/edit_portal`), Storage bucket `knews-creative`, Vault por `portal_id`.
4. Verificar que `cron` K-NEWS (`knews-process-jobs`) é distinto de `supabase-process-background-jobs` do BLOGGER.
5. Garantir backup/PITR do projeto `pnhxvhjudtrzvwduuigj`.
6. Produzir relatório do SQL e operações previstas (dry-run `supabase db push --linked --dry-run`).
7. Solicitar autorização explícita — **não executar push automaticamente**.

```bash
supabase link --project-ref pnhxvhjudtrzvwduuigj
supabase db push --linked --dry-run   # revisar diff
# apos autorizacao:
supabase db push --linked
supabase functions deploy knews-jobs knews-publish
```

13 migrations `knews` em ordem (não tocam `public.*`; `20261027000002` endurece RLS e grants):
- `20261021000001_knews_foundation` (`knews` schema, `knews.jobs`, `knews.articles`, `knews.portals`, `can_read/edit_portal`)
- `20261022000002` / `20261023000001` / `20261023000003` (editorial + ads hardening)
- `20261024000001` (`knews.sources` / `fetch_logs`), `20261024000002` (`job_events`, `claim_jobs` SKIP LOCKED), `20261024000003` (`knews-creative` bucket + `ad_creatives`)
- `20261025000001` (`ad_reservations/events`, `knews.reserve_ad`)
- `20261026000001` .. `20261027000001` (news admin / publication / social-partners / observability)

## Validacao (sem BLOGGER, sem DNS final)

### 1. RLS entre Guarujá e Santos

Criar 2 cidades (`guaruja`, `santos`) + 2 portais + `portal_domains` ficticios + 2 usuários com `portal_members` distintos.

```sql
set role anon; select count(*) from knews.articles; -- 0
set role authenticated; set request.jwt.claim.sub = '<user_guaruja>'; select * from knews.articles where portal_id = <id_santos>; -- 0
```

### 2. Jobs concorrentes, lease e DLQ

2 workers `claim_jobs('worker-1',1,60)` vs `worker-2` → 0 sobreposição (SKIP LOCKED); lease expirado + `max_attempts → dead_letter`; idempotência `unique(portal_id, idempotency_key)`.

### 3. Reserva transacional

`knews.reserve_ad` idempotente (`campaign_id+idempotency_key` único), `FOR UPDATE` lock, `expire_stale_reservations`.

### 4. Pipeline editorial + evidências

RSS → `fetchRssSafe` (SSRF, timeout, maxBytes) → `deduplicateByCanonical` → `persistentDedupKeys` (`knews.processed_canonicals`) → `classifyRiskFromContext` → `isAutoPublishable` só `low+strong`. Autopublicação real desabilitada até homologação.

### 5. Sitemap/robots e Storage

`GET /sitemap.xml` com `Host: guaruja.localhost` isolado; upload `storage.objects` `knews-creative/<campaign_id>/<uuid>-<file>`.

### 6. Checks CI

```bash
npm ci && npm run typecheck && npm run lint && npm test && npm run build
```

## Sem custos ate homologacao

Sem novo projeto Supabase ate necessidade comprovada; staging via `supabase start` local. `portal24h.news` wildcard sem DNS agora (`Host: guaruja.localhost`).
