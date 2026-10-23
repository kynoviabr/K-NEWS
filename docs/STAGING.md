# Staging — Homologacao no mesmo Supabase (sem dados BLOGGER)

> **Nao aplicar migrations sem revisar.** Todas as migrations em `supabase/migrations/` usam schema `knews` isolado de `public.*` (BLOGGER: `pnhxvhjudtrzvwduuigj`) e tem header `NAO APLICAR EM PRODUCAO SEM APROVACAO`.

## Estratégia aprovada: mesmo projeto Supabase do BLOGGER

- **Homologacao no projeto existente** `pnhxvhjudtrzvwduuigj` — sem novo projeto, sem custo, sem segredos novos.
- **Isolamento por `knews`:** as 12 migrations só tocam `knews.*` e `storage.objects` bucket `knews-creative`; `public.*` do BLOGGER não é tocado.
- **Sem URL final agora:** sem `portal24h.news` DNS; teste por `Host: guaruja.localhost` ou `http://localhost:3000` com header `Host`.
- **Variaveis:** reutilize `.env` do projeto existente (`NEXT_PUBLIC_SUPABASE_URL` de `pnhxvhjudtrzvwduuigj`); não exponha `SUPABASE_SERVICE_ROLE_KEY` no frontend.

```bash
supabase link --project-ref pnhxvhjudtrzvwduuigj
supabase db push --linked   # 12 migrations knews em ordem — revisar diff antes
supabase functions deploy knews-jobs knews-publish
```

## Validacao (sem dados BLOGGER)

### 1. RLS entre Guarujá e Santos

Criar 2 cidades (`guaruja`, `santos`) + 2 portais + `portal_domains` ficticios + 2 usuários com `portal_members` distintos.

```sql
set role anon; select count(*) from knews.articles; -- 0
set role authenticated; set request.jwt.claim.sub = '<user_guaruja>'; select * from knews.articles where portal_id = <id_santos>; -- 0
```

### 2. Jobs concorrentes, lease e DLQ

```sql
insert into knews.jobs(portal_id, job_type, payload, priority) values
  ('<p_guaruja>', 'rss_fetch', '{}', 100),
  ('<p_guaruja>', 'rss_fetch', '{}', 100);
-- 2 workers claim_jobs('worker-1',1,60) vs worker-2 → 0 sobreposição (SKIP LOCKED)
-- Lease expirado: update lease_expires_at = now() - interval '1 minute' → próximo claim recupera retrying
-- max_attempts → dead_letter; unique(portal_id, idempotency_key) sem duplicar
```

### 3. Reserva transacional de publicidade

```sql
select knews.reserve_ad('<campaign_id>', 'slot_topo', 'idem-1', 300);
select knews.reserve_ad('<campaign_id>', 'slot_topo', 'idem-1', 300); -- idempotente
select knews.expire_stale_reservations();
```

### 4. Pipeline editorial + evidências

RSS → `fetchRssSafe` (timeout, maxBytes, SSRF) → `deduplicateByCanonical` → `persistentDedupKeys` (`knews.processed_canonicals`) → `classifyRiskFromContext` (independent hosts, `factCheckClaims`, stale, prompt injection) → `isAutoPublishable` só `low+strong`. Autopublicação real desabilitada até homologação.

### 5. Sitemap/robots e Storage

`GET /sitemap.xml` com `Host: guaruja.localhost` retorna URLs isoladas; `Host: santos.localhost` isolado. Upload `storage.objects` `knews-creative/<campaign_id>/<uuid>-<file>`.

### 6. Checks CI

```bash
npm ci && npm run typecheck && npm run lint && npm test && npm run build
```

## Vercel

Sem `portal24h.news` agora; usar `localhost` ou preview sem domínio final. Wildcard `*.portal24h.news` → `cname.vercel-dns.com` só após homologação autorizada.
