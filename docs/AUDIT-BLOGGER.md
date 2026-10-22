# AUDIT-BLOGGER — Auditoria Somente Leitura (Fase 0)

> **Data:** 2026-10-21 (America/Sao_Paulo) · **Modo:** somente leitura · **Sem escrita no BLOGGER ou no Supabase de produção**
> **Executor:** Claude Code (K-NEWS Fase 0) · **Cidades-piloto K-NEWS:** Guarujá/SP

## 1. Objetivo e escopo

Auditar, sem modificar, o produto BLOGGER para extrair padrões auditados reutilizáveis no K-NEWS, mapear riscos de isolamento no Supabase compartilhado e registrar inacessibilidades sem inventar resultados. Toda reutilização futura será por adaptação independente com atribuição técnica, sem mesclar bancos, campanhas ou autorizações.

## 2. BLOGGER — repositório local

- **Caminho local:** `/Users/dempas/Documents/BLOG - MOTOR DE CONTEUDO/BLOGGER`
- **Remoto:** `https://github.com/kynoviabr/BLOGGER` (público, branch `main`)
- **Head em 2026-10-21:** `6199b44` (PR #20 — detecção de pautas duplicadas e cannibalization guard, merge em `origin/main`)
- **PRs relevantes já integrados:** #10 (segurança/cron), #11 (organizações), #12 (isolamento tenant/RLS), #13 (empresa ativa), #14 (convites), #15 (fila durável multi-tenant), #16 (worker Supabase), #17 (ativação fila/cron), #18 (geração de texto no worker), #19/#20 (ideias, calendário, anti-canibalização)
- **Estado local:** sincronizado, sem arquivos modificados pendentes além de artefatos de build (`.next`, `node_modules`) — conforme `docs/HANDOFF_COMPLETO_2026-10-20.md` do BLOGGER
- **Stack observada (`package.json`):**
  - `next 15.5.27`, `react 19`, `typescript 5.7`, `tailwindcss 3.4`, `lucide-react 0.475`
  - `@supabase/ssr 0.12.7`, `@supabase/supabase-js 2.49.1`
  - `@google/genai 2.24.0`, `sharp 0.35.5`, `zod 4.6.5`
  - `vitest 4.1.11`, `tsx 4.23.15` — testes e workers
- **Branches/hosts extras:** não investigados além de `main` nesta fase, por regra de não ampliar escopo sem autorização

## 3. Arquitetura observada (somente leitura)

### 3.1 Frontend e admin
- `app/` com rotas segmentadas: `blogs`, `calendar`, `content`, `ideas`, `media`, `monetization`, `settings`, `team`, `logs`, `auth`, `api/*`
- `app/layout.tsx` carrega `AppShell` + `getCurrentUser()` + `OrganizationService` + `BlogService`; cookie `selected_organization_id` / `selected_blog_id`
- `middleware.ts` valida `auth.getUser()` via `createServerClient` (Supabase SSR), redireciona não autenticado para `/login`, libera apenas `/api/cron` e `/auth/callback` sem sessão; exige `NEXT_PUBLIC_SUPABASE_URL` + `ANON_KEY`
- `next.config.ts` com `serverExternalPackages: ['sharp']` e tracing de `@img/*`

### 3.2 Design system
- `app/globals.css`: tokens HSL extensos (`--primary`, `--bg-navy`, `--sidebar-*`, `--shadow-*`, `--radius-*`), fontes `DM Sans` + `Inter`, helpers `.glass`, `.gradient-*`, `.shadow-*`, `.label-stripe`; `prefers-reduced-motion` tratado
- `tailwind.config.ts`: `colors` mapeadas a `hsl(var(--*))`, `fontFamily` via variáveis, `borderRadius`/`boxShadow` por tokens, `content` cobrindo `app/`, `components/`, `pages/`
- `components/ui/`: `button.tsx`, `card.tsx`, `badge.tsx`, `input.tsx`, `select.tsx`, `textarea.tsx`, `table.tsx`, `modal.tsx`, `tooltip.tsx` — base consistente para derivar `knews` sem copiar branding
- `components/layout/`: `app-shell.tsx`, `sidebar.tsx`, `topbar.tsx` — sidebar fixa navy à esquerda, navegação por `config/navigation.ts`

### 3.3 Domínio e validações
- `types/database.ts` — tipos `Database` com `organizations`, `organization_members`, `organization_invitations`, `blogs`, `blog_languages`, `categories`, `editorial_calendar`, `content_items`, etc.; enums `BackgroundJobType/Status`, `ContentStatus`, etc.
- `lib/validations/`: `blog.schema.ts`, `calendar.schema.ts`, `category-media.schema.ts`, `auth.schema.ts`, `monetization.schema.ts` — Zod com mensagens em pt-BR
- `lib/supabase/`: `server.ts` / `client.ts` / `auth.ts` (`getCurrentUser`, `requireAuth`, `requireOrganizationMembership`)
- `lib/`: `logger.ts`, `rate-limit.ts`, `image-optimizer.ts`, `errors/`, `constants/`

### 3.4 Serviços e workers
- `services/`: `blog.service.ts`, `calendar.service.ts`, `content.service.ts`, `pipeline.service.ts`, `research/`, `ai/`, `publisher/` (`wordpress-provider.ts`, `mock-publisher-provider.ts`), `editorial/`, `monetization/`, `scheduler/`, `publishing/`
- `workers/`: `content-worker.ts`, `image-worker.ts`, `publishing-worker.ts`, `index.ts` — orquestração de jobs
- `lib/supabase/auth.ts`: `ACTIVE_ORGANIZATION_COOKIE = 'selected_organization_id'`, `getCurrentUser` via `auth.getUser()` (validação server-side), helpers de membership por cookie

### 3.5 Config e env
- `.env.example`: `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `GEMINI_API_KEY`, `IMAGE_PROVIDER` (openai/pollinations/nanobanana/mock), `PUBLISHER_TYPE` (mock/wordpress/…), `DEEPSEEK_*`, `AI_PROVIDER`
- `.env.local` presente localmente (não lido integralmente; apenas chaves verificadas por prefixo — sem expor valores)
- `config/site.ts` + `config/navigation.ts` + `config/languages.ts`

## 4. Supabase compartilhado

### 4.1 Projeto
- **Project ref:** `pnhxvhjudtrzvwduuigj` (extraído de documentação BLOGGER e `.env.local` — não validado por chamada de rede nesta fase devido a restrição de sandbox)
- **Recursos em uso pelo BLOGGER:** Auth, Postgres, RLS, Storage, Vault, `pg_cron`, `pg_net`, Edge Functions
- **Status das migrations:** sem conexão direta ao Postgres nesta fase (sem `SUPABASE_SERVICE_ROLE_KEY` carregada para o K-NEWS e sem autorização para tocar produção). Inventário abaixo é por leitura de arquivos `supabase/migrations/*.sql`

### 4.2 Inventário de migrations (leitura de arquivos)
Total de arquivos em `supabase/migrations/`: **24** (contando `supabase/` e `supabase/migrations/` combinados). Principais em ordem:

| Arquivo | Papel |
|---|---|
| `00001_initial_schema.sql` | `blogs`, `blog_languages`, `categories`, `editorial_calendar`, `media_assets`, `content_items`, `content_sources`, `ai_runs`, `system_logs` |
| `00002_harden_rls_and_grants.sql` | Revoga `anon`, `ENABLE RLS` em 9 tabelas, policies `allow_authenticated_all_*` |
| `00003_add_autopilot_columns.sql` | Campos `autopilot_*` em `blogs` |
| `00004_create_monetization_offers.sql` | `monetization_offers` + seed Universo do Dinheiro |
| `00005_add_seo_focus_keyword_and_tags.sql` | SEO por conteúdo |
| `00006_setup_supabase_pg_cron_publishing.sql` | Cron Supabase para publicação |
| `20261018150608_phase0_secure_cron.sql` | Endurece cron |
| `20261018151638_phase1_security_advisor_fixes.sql` | Advisor fixes |
| `20261018152154_supabase_edge_publisher.sql` | Colunas de publicação em `content_items` |
| `20261019110900_harden_multiblog_publishing.sql` | Multi-blog publishing |
| `20261019112259_organizations_foundation.sql` | `organizations`, `organization_members`, `private` schema, `is_organization_member`, `current_organization_id` |
| `20261019132443_tenant_rls_isolation.sql` | `private.can_read/edit/admin_blog`, RLS por organização, Storage `blog-assets` por `blog_id` |
| `20261020010526_organization_invitations.sql` | Convites |
| `20261020110711_durable_background_jobs.sql` | `background_jobs`, `background_job_events`, `enqueue/claim/heartbeat/complete` |
| `20261020111428_activate_background_job_worker.sql` | Ativa worker |
| `20261020111507_background_job_healthcheck.sql` | `get_background_job_health()` |
| `20261020190338_organization_provider_credentials.sql` | Vault por organização |
| `20261020200000_wordpress_vault_per_blog.sql` | Vault por blog |
| `20261020201000_organization_quotas_and_fair_scheduling.sql` | Quotas e fair scheduling |
| `20261020210000_research_job_and_pipeline_state.sql` | Research + state |
| `20261021000000_ops_dashboard_rpc.sql` | RPCs de ops |
| `20261021010000_ops_timeline_webhooks_fallback.sql` | Timeline/webhooks |
| `20261021020000_backfill_wordpress_vault.sql` | Backfill Vault |

### 4.3 Fila durável (referência para K-NEWS, sem reutilizar tabelas)
- **Tabela:** `public.background_jobs` (`id uuid`, `organization_id`, `blog_id`, `job_type` enum, `status` enum `queued|running|retrying|completed|dead_letter|cancelled`, `payload jsonb`, `result jsonb`, `priority`, `attempts/max_attempts`, `idempotency_key`, `scheduled_at`, `claimed_at/by`, `lease_expires_at`, constraints de claim e FK `(blog_id, organization_id)`)
- **Eventos:** `background_job_events` com trigger `audit_background_job_transition`
- **Funções:** `enqueue_background_job`, `claim_background_jobs` (`FOR UPDATE SKIP LOCKED`, limite e `lease_seconds`), `heartbeat_background_job`, `complete_background_job`, `get_background_job_health`
- **Cron:** `supabase-process-background-jobs` `* * * * *` → Edge Function `process-jobs` (5 handlers) — conforme `HANDOFF_COMPLETO_2026-10-20.md`
- **Nota arquitetural:** K-NEWS criará sua própria fila em schema `knews` — não reutilizará estas tabelas

### 4.4 RLS e isolamento (estado pretendido)
- `private` schema + `is_organization_member`, `has_organization_role`, `can_read/edit/admin_blog` — políticas por `blog_id`/`organization_id`
- `system_logs.organization_id` com default `private.current_organization_id()`
- Storage `blog-assets` particionado por `blog_id` em `storage.objects.name`
- `REVOKE ALL ON pipeline_* FROM anon,authenticated` — apenas `service_role`
- **Risco para K-NEWS:** schema `knews` ainda não existe; nenhuma política foi avaliada por teste de acesso real nesta fase

### 4.5 Storage, Vault e Edge Functions
- **Storage:** bucket `blog-assets` (e outros por blog); políticas restritas por `can_edit_blog`
- **Vault:** `vault` extension + `organization_provider_credentials` + `wordpress_vault_per_blog` — chaves nunca no frontend
- **Edge Functions:** `process-jobs` e `publish-content` (`supabase/config.toml`, `verify_jwt = false`)
- **Vercel:** projeto `blogger` (`prj_5zXjggAk60S86wloYuE5rTaXUHRg`), produção `blogger-bice-three.vercel.app`, sem `crons` no `vercel.json`; rotas legadas `/api/cron/*` retornam `410 Gone`

## 5. Segurança e gaps observados

- **Pontos fortes:** RLS por organização, Storage por blog, Vault para segredos, fila durável com `SKIP LOCKED`/leases, validações Zod, `middleware` via `auth.getUser()`, `post-commit` com push/healthcheck automatizados
- **Gaps a endereçar no K-NEWS:** schema `knews` inexistente, RLS de `knews` não criada, buckets K-NEWS não criados, nenhuma migration K-NEWS aplicada, sem testes de isolamento BLOGGER↔K-NEWS, sem `ads.txt`/consentimento, sem auditoria de `pg_cron` compartilhado sob carga
- **Acessos não verificados nesta fase:** conexão direta ao Postgres, Storage real, Auth real, Vault real — propositalmente não exercitados sem autorização e sem credenciais isoladas para K-NEWS

## 6. Padrões reutilizáveis (com atribuição)

- `app/globals.css` + `tailwind.config.ts` → derivar `K-NEWS/app/globals.css` e `tailwind.config.ts` com tokens próprios, mantendo estrutura
- `components/ui/*` e `components/layout/app-shell` → adaptar para `K-NEWS/components/ui` e `K-NEWS/components/layout/app-shell`, com branding K-NEWS
- `middleware.ts` (Supabase SSR + `auth.getUser()`) → `K-NEWS/middleware.ts` com rotas K-NEWS
- `lib/supabase/server|client|auth` + `lib/validations` → `K-NEWS/lib/*`
- `supabase/migrations/20261020110711_durable_background_jobs.sql` **como referência de desenho** para `supabase/migrations/*_knews_jobs.sql` — sem reutilizar tabelas `public.background_jobs`

## 7. Inacessibilidades registradas (sem invenção)

- **Conexão Postgres/Storage/Auth/Vault de produção:** não exercitada — falta de credenciais isoladas para K-NEWS e proibição de tocar produção. Próximos passos requerem `SUPABASE_URL`/`ANON_KEY`/`SERVICE_ROLE` de ambiente isolado ou confirmação de uso do mesmo projeto com schema `knews` e revisão de `search_path`
- **GitHub API para `kynoviabr/K-NEWS`:** bloqueada pelo sandbox de rede (`api.github.com:443 user denied`). Verificação do repo remoto adiada; trabalho local segue sem depender dela
- **Vercel/Supabase dashboards:** não acessados nesta fase (somente leitura local)
- **BLOGGER como runtime:** não iniciado; nenhuma rota executada

## 8. Recomendações imediatas (sem executar)

1. Criar repo/branch K-NEWS, aplicar scaffold Next.js isolado e `supabase/migrations` para `knews.*` sem tocar `public.*`
2. Definir `search_path` e `GRANT` explícitos para `knews`; testar RLS com dois usuários/organizações/portais antes de qualquer feature
3. Provisionar buckets `knews-*` com políticas restritas e Vault por território quando necessário
4. Replicar padrão de fila durável em `knews.jobs` com `claim/heartbeat/complete` por território/porta
5. Agendar `pg_cron` K-NEWS separado, sem interferir no cron do BLOGGER

---
*Auditoria gerada em modo somente leitura. Nenhum arquivo do BLOGGER foi modificado. Nenhuma migration foi aplicada. Nenhum segredo foi exposto.*
