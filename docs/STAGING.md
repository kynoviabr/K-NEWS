# Staging — Homologacao no mesmo Supabase (sem custo extra)

> **Decisao definitiva:** K-NEWS usa exclusivamente o projeto Supabase do BLOGGER `pnhxvhjudtrzvwduuigj` — nao criar outro projeto. Todas as migrations em `supabase/migrations/` usam `knews.*` isolado de `public.*` e tem header `NAO APLICAR EM PRODUCAO SEM AUTORIZACAO`. Desenvolvimento e testes locais via `supabase start` (Docker).

## Desenvolvimento local (Docker, sem BLOGGER, sem novo projeto pago)

```bash
supabase start          # sobe Postgres + Auth + Storage local via Docker
supabase db reset       # aplica as 13 migrations knews em ordem (validadas em docs/HOMOLOGACAO-LOCAL.md) (--debug para auditar)
supabase functions serve knews-jobs knews-publish
```

## Implantacao controlada no projeto compartilhado `pnhxvhjudtrzvwduuigj`

**Não usar `supabase db push` nem `supabase migration repair` neste projeto.** O histórico do CLI (`supabase_migrations.schema_migrations`) é do BLOGGER: o push recusa porque as versões do BLOGGER não estão neste repositório, e o `repair` que o CLI sugere apagaria esse histórico. As migrations do K-NEWS são aplicadas por `scripts/knews-migrate.mjs` (ADR-019), que guarda o próprio histórico em `knews_migrations.applied` e não lê nem altera o do BLOGGER.

O script:
- só conecta se a URL for do projeto `pnhxvhjudtrzvwduuigj` (ou local) e nunca imprime a URL;
- recusa migrations que citem `public.`, `supabase_migrations`, roles, banco ou privilégios padrão;
- para se já existir schema `knews`/`knews_public` ou bucket `knews-*` sem histórico (estado parcial), ou se uma migration aplicada mudou (checksum);
- sem `--apply` só lista o que seria aplicado; com `--apply` roda cada migration numa transação própria, com trava contra execução simultânea.

Passos (Mac, pasta do repositório já linkada com `supabase link --project-ref pnhxvhjudtrzvwduuigj`):

1. Confirmar no Dashboard (Database → Backups) que há backup recente.
2. `npm ci`
3. `npm run db:knews`: o script lê o endereço do pooler gravado pelo `supabase link` (`supabase/.temp/pooler-url`, porta 5432), pede a senha do banco sem eco e lista o projeto e as pendências. Senha com `@`, `#`, `/` ou `%` funciona. `KNEWS_DATABASE_URL` substitui o endereço, se preciso.
4. Conferir a saída.
5. `npm run db:knews -- --apply`
6. Depois: expor `knews` e `knews_public` na API (Settings → API → Exposed schemas, mantendo os do BLOGGER) e criar o agendamento do worker (`docs/LAUNCH-CHECKLIST.md`).

Testado localmente: num Supabase vazio com um histórico falso do BLOGGER, aplicou as 20 migrations, deixou o histórico do BLOGGER intacto, a segunda execução não teve pendências e os 80 testes de integração passaram sobre o banco migrado pelo script.

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
