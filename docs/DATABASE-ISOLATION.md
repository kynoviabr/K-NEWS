# DATABASE-ISOLATION — Isolamento Supabase BLOGGER ↔ K-NEWS

> **Data:** 2026-10-21 · **Projeto Supabase compartilhado (ref `pnhxvhjudtrzvwduuigj` — leitura local, sem conexão nesta fase)** · **Schema K-NEWS:** `knews`

## 1. Princípio

BLOGGER e K-NEWS compartilham o mesmo projeto Supabase por decisão de negócio, mas **não compartilham** tabelas, buckets, RLS, funções ou dados de negócio. `auth.users` e recursos físicos (Postgres, Storage, Vault, `pg_cron`, `pg_net`, Edge Functions) são compartilhados fisicamente — portanto o isolamento é **lógico e testável**, não físico.

## 2. Fronteiras

| Recurso | BLOGGER | K-NEWS | Compartilhado |
|---|---|---|---|
| Schema | `public` | `knews` | `auth`, `storage`, `vault`, `cron` |
| Tabelas | `public.blogs`, `public.content_items`, `public.background_jobs`, … | `knews.regions`, `knews.portals`, `knews.articles`, `knews.jobs`, … | — |
| Buckets | `blog-assets` | `knews-creative`, `knews-editorial`, `knews-social` | Infra Storage |
| RLS/policies | `private.can_read_blog` etc. | `knews.can_read_portal` etc. | `auth.users`, `storage.objects` |
| Vault | por organização/blog | por portal/território | `vault` extension |
| Cron | `supabase-process-background-jobs` (`* * * * *`) | `knews-process-jobs` (nome distinto) | `cron` schema |
| Edge Functions | `process-jobs`, `publish-content` | `knews-jobs`, `knews-publish` | runtime |

**Proibido:** `knews.*` referenciar `public.*` e vice-versa; `public.background_jobs` ser usada pelo K-NEWS; qualquer `GRANT` cruzado implícito; `search_path` implícito.

## 3. Criação do schema `knews` (planejada, não aplicada)

```sql
create schema if not exists knews;
revoke all on schema knews from public, anon;
grant usage on schema knews to authenticated, service_role;

-- Toda função knews será SECURITY DEFINER com SET search_path = ''
-- e GRANT EXECUTE explícito apenas para authenticated/service_role
```

- `search_path` de cada função `knews.*` fixado em `''`; tabelas sempre qualificadas (`knews.jobs`, `knews.articles`)
- `anon` revogado em `knews.*`; `authenticated` só via RLS; `service_role` bypassa RLS mas com funções próprias

## 4. Modelo `knews` (Fase 1 — núcleo multiportal)

```sql
-- Localidades e portais
create table knews.regions        (id uuid primary key default gen_random_uuid(), name text not null, slug text unique not null, status text not null default 'active');
create table knews.cities         (id uuid primary key default gen_random_uuid(), region_id uuid not null references knews.regions(id), name text not null, slug text not null, unique(region_id, slug));
create table knews.neighborhoods  (id uuid primary key default gen_random_uuid(), city_id uuid not null references knews.cities(id), name text not null, slug text not null, unique(city_id, slug));
create table knews.portals        (id uuid primary key default gen_random_uuid(), city_id uuid not null references knews.cities(id), name text not null, slug text unique not null, status text not null default 'active', seo jsonb not null default '{}'::jsonb);
create table knews.portal_domains (id uuid primary key default gen_random_uuid(), portal_id uuid not null references knews.portals(id) on delete cascade, domain text unique not null, primary boolean not null default false);
create table knews.portal_localities (portal_id uuid not null references knews.portals(id) on delete cascade, city_id uuid references knews.cities(id), neighborhood_id uuid references knews.neighborhoods(id), primary key (portal_id, coalesce(city_id::text,'-'), coalesce(neighborhood_id::text,'-')));

-- Parcerias e RBAC regional
create table knews.partners            (id uuid primary key default gen_random_uuid(), name text not null, document text, status text not null default 'active');
create table knews.partner_territories (partner_id uuid not null references knews.partners(id) on delete cascade, city_id uuid references knews.cities(id), neighborhood_id uuid references knews.neighborhoods(id), primary key (partner_id, coalesce(city_id::text,'-'), coalesce(neighborhood_id::text,'-')));
create table knews.portal_members      (portal_id uuid not null references knews.portals(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade, role text not null check (role in ('super_admin','regional_manager','regional_editor','commercial_partner','technical_operator','advertiser')), status text not null default 'active', primary key (portal_id, user_id));

-- Jornalismo (evolui nas Fases 3–4)
create table knews.sources   (id uuid primary key default gen_random_uuid(), portal_id uuid references knews.portals(id), url text not null, kind text not null, license text, status text not null default 'active');
create table knews.articles  (id uuid primary key default gen_random_uuid(), portal_id uuid not null references knews.portals(id), slug text not null, title text not null, excerpt text, body text not null default '', status text not null default 'draft', risk_level text not null default 'low', published_at timestamptz, unique(portal_id, slug));
-- Fases 3–4 adicionam evidences, claims, ad_* etc. sem tocar public.*
```

Índices, triggers `updated_at` e `enable row level security` por tabela seguem o padrão BLOGGER (`update_updated_at_column()` duplicada em `knews` ou reutilizada com `search_path` qualificado — decisão em `DECISIONS.md`).

## 5. RLS — padrão K-NEWS

```sql
-- Exemplo: apenas membros do portal leem/escrevem
create or replace function knews.can_read_portal(target_portal_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from knews.portal_members m
    where m.portal_id = target_portal_id and m.user_id = auth.uid() and m.status = 'active'
  );
$$;
revoke all on function knews.can_read_portal(uuid) from public, anon;
grant execute on function knews.can_read_portal(uuid) to authenticated, service_role;

-- Políticas por tabela (padrão: select para member, insert/update para editor+, delete para admin+)
-- Tabelas ligadas a portal: USING (knews.can_read_portal(portal_id))
-- Tabelas ligadas a artigo: via knews.can_read_portal(articles.portal_id)
```

- Políticas sempre `TO authenticated` (nunca `TO public`); `service_role` bypassa mas com funções próprias auditadas
- `knews.articles` com `CHECK (risk_level in ('low','medium','high','blocked'))` e `status` com `blocked` não autopublicável — validação determinística, não só IA

## 6. Storage

```sql
-- Buckets K-NEWS (criação via dashboard/migration — não reutilizar blog-assets)
-- storage.objects.name prefixado por portal:  knews-creative/<portal_id>/...
create policy "knews_creative_insert" on storage.objects for insert to authenticated
  with check (bucket_id in ('knews-creative','knews-editorial','knews-social')
              and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
              and knews.can_edit_portal(((storage.foldername(name))[1])::uuid));
-- update/delete análogos; select público apenas para objetos de artigos published (quando houver CDN)
```

- Antivírus/mime/size validados no backend; `alt_text` obrigatório para imagens editoriais

## 7. Fila durável K-NEWS (`knews.jobs`)

Espelho seguro de `public.background_jobs`, sem reusar a tabela:

```sql
create table knews.jobs (
  id uuid primary key default gen_random_uuid(),
  portal_id uuid references knews.portals(id) on delete cascade,
  job_type text not null check (job_type in ('rss_fetch','normalize','classify','draft','publish','social_publish','ad_serve','affiliate_sync','research')),
  status text not null default 'queued' check (status in ('queued','running','retrying','completed','dead_letter','cancelled')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  result jsonb, priority smallint not null default 100 check (priority between 0 and 1000),
  attempts smallint not null default 0, max_attempts smallint not null default 5 check (max_attempts between 1 and 20),
  idempotency_key text check (idempotency_key is null or length(idempotency_key) between 1 and 200),
  scheduled_at timestamptz not null default now(), claimed_at timestamptz, claimed_by text, lease_expires_at timestamptz,
  completed_at timestamptz, failed_at timestamptz, last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint knews_jobs_claim_consistency check (
    (status='running' and claimed_at is not null and claimed_by is not null and lease_expires_at is not null)
    or (status<>'running' and claimed_at is null and claimed_by is null and lease_expires_at is null)
  )
);
create unique index uq_knews_jobs_idempotency on knews.jobs(portal_id, idempotency_key) where idempotency_key is not null;
create index idx_knews_jobs_claimable on knews.jobs(priority, scheduled_at, created_at) where status in ('queued','retrying');
```

- Funções `knews.enqueue_job`, `knews.claim_jobs`, `knews.heartbeat_job`, `knews.complete_job`, `knews.cancel_job`, `knews.get_job_health` — `SECURITY DEFINER`, `search_path = ''`, `GRANT EXECUTE` explícito
- `knews.job_events` com trigger de transição; `pg_cron` job `knews-process-jobs` separado

## 8. Operação e observabilidade

- `knews.system_logs(portal_id, level, service, message, metadata jsonb)` — `portal_id` obrigatório para logs visíveis; `null` reservado a diagnósticos `service_role`
- Healthcheck: `knews.get_job_health()` retorna `cron_active`, `job_counts`, `latest_run` (espelho de `public.get_background_job_health`)
- Kill switch: `knews.cancel_jobs(portal_id, job_type)` + `articles.status = 'blocked'` para alto risco

## 9. Matriz de verificação (antes de qualquer feature)

| Teste | Esperado |
|---|---|
| `anon` SELECT em `knews.*` | 0 linhas (RLS + REVOKE) |
| `authenticated` sem `portal_members` | 0 linhas em `knews.articles` do portal |
| `authenticated` com `viewer` | SELECT ok, INSERT/UPDATE bloqueado |
| `service_role` via função `knews.enqueue_job` | ok; via tabela direta sem função | bloqueado por RLS se sem bypass (esperado) |
| `storage.objects` com `bucket_id='blog-assets'` e path `knews-*` | bloqueado (bucket errado) |
| `claim_jobs` concorrente (2 workers) | 0 sobreposição (`SKIP LOCKED`) |
| Lease expirado | `running` → `retrying`/`dead_letter` no próximo `claim` |
| `idempotency_key` duplicada | 1 linha (upsert conflita e retorna existente) |

## 10. Riscos e mitigação

- **Mesmo projeto físico:** limites de `pg_cron`, `pg_net`, conexões e Storage são compartilhados — monitorar `cron.job_run_details` e quotas; isolar por nome e prioridade
- **Drift de migrations:** nunca aplicar `public.*` e `knews.*` na mesma migration; revisões cruzadas obrigatórias
- **Vault compartilhado:** segregar `vault` secrets por `portal_id`/`provider` com naming `knews/<portal_id>/<provider>`

---
*Isolamento lógico, não físico. Testes reais de RLS/Storage/Vault só após autorização e credenciais isoladas.*
