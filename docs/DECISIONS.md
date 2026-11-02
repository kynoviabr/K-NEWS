# DECISIONS — K-NEWS (ADRs)

> **Formato:** ADR leve. Cada decisão registra contexto → decisão → consequências → alternativas rejeitadas. Sem “decidido em reunião” inventada.

## ADR-001 — Mesmo projeto Supabase com schema `knews`

- **Data:** 2026-10-21 · **Status:** Aceita (Fase 0)
- **Contexto:** Blueprint §6 exige mesmo projeto Supabase que o BLOGGER, com isolamento lógico (schema `knews`, buckets e RLS separados); `auth.users` permanece compartilhado fisicamente
- **Decisão:** Criar `knews.*` em projeto `pnhxvhjudtrzvwduuigj`, sem tocar `public.*`; `knews` com `search_path = ''` em todas as funções e `GRANT` explícitos
- **Consequências:** sem custo de projeto extra; exige disciplina de migrations e testes de isolamento cruzado; limites físicos (`pg_cron`, Storage, conexões) compartilhados
- **Alternativas rejeitadas:** projeto Supabase separado (contraria decisão de negócio); `public` compartilhado com prefixo `knews_` (RLS mais frágil e nomes colidentes)

## ADR-002 — Não reutilizar `public.background_jobs` do BLOGGER

- **Decisão:** K-NEWS terá `knews.jobs` + `knews.job_events` + funções `knews.enqueue/claim/heartbeat/complete` próprias, desenhadas a partir de `20261020110711_durable_background_jobs.sql` apenas como referência
- **Consequências:** evolução independente, sem risco de quebrar cron do BLOGGER; duplica padrão testado
- **Rejeitada:** reusar tabela `public.background_jobs` com `portal_id` nullable (acoplamento e políticas cruzadas)

## ADR-003 — Fila durável em Postgres, sem Inngest/Redis/n8n no MVP

- **Decisão:** Fila Postgres com `FOR UPDATE SKIP LOCKED`, `lease_expires_at`, `idempotency_key`, `retry/backoff`, `dead_letter`, `pg_cron` + Edge Functions — conforme Blueprint §8 e BLOGGER Fase 4A
- **Consequências:** sem dependência externa no MVP; requer `heartbeat` e reconciliação de side effects
- **Rejeitadas:** Inngest/Redis/n8n/Railway no MVP (vedados pelo CLAUDE.md sem aprovação arquitetural)

## ADR-004 — Auth via Supabase SSR + `auth.getUser()` no middleware

- **Decisão:** `lib/supabase/{server,client,auth}` + `middleware.ts` validando `auth.getUser()` (não só JWT local), como no BLOGGER; cookies `selected_portal_id`/`selected_organization_id`
- **Consequências:** validação server-side confiável; exige `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` no ambiente
- **Rejeitada:** JWT local sem validação (risco de sessão falsificada)

## ADR-005 — Design system derivado, branding independente

- **Decisão:** Derivar `app/globals.css` + `tailwind.config.ts` + `components/ui/*` do BLOGGER com tokens HSL próprios e sem copiar logotipo/cores de marca; admin com sidebar esquerda, portal com identidade jornalística própria
- **Consequências:** consistência sem contaminação de marca
- **Rejeitada:** cópia literal do CSS do BLOGGER (mistura de branding e dívida de manutenção)

## ADR-006 — Hosting Vercel, sem cron na Vercel

- **Decisão:** Vercel para portal/painel/rotas curtas; agendamentos exclusivamente em `pg_cron` → Edge Functions (`knews-process-jobs`); rotas `/api/cron/*` na Vercel, se existirem, retornam `410 Gone` como no BLOGGER
- **Consequências:** um único scheduler (Supabase), sem dupla execução
- **Rejeitada:** `vercel.json` `crons` (contraria direção aprovada do BLOGGER P2)

## ADR-007 — Segredos em Supabase Vault, nunca no frontend

- **Decisão:** `vault` + `knews.provider_credentials` / `knews.portal_social_accounts` para DeepSeek/OpenAI/Meta; credenciais só via `service_role`/Edge Functions
- **Consequências:** rotação e auditoria centralizadas; sem vazamento em logs/bundles
- **Rejeitada:** `.env` por portal no repo ou `NEXT_PUBLIC_*` com chaves

## ADR-008 — Ad server dinâmico, sem banner no HTML do artigo

- **Decisão:** Campanhas cadastradas uma vez, servidas por `knews.ad_decisions` em tempo de render; `ad_impressions` agregadas com método auditável; `ads.txt` e consentimento antes de AdSense/MGID
- **Consequências:** inventário, targeting, pacing e relatórios testáveis; sem reedição de artigos para vender mídia
- **Rejeitada:** HTML de artigo com `<img>`/`<iframe>` fixo de anunciante

## ADR-009 — Alto risco nunca autopublicável

- **Decisão:** `articles.risk_level = 'blocked'` (acusações, crimes com identificados, tragédias em desenvolvimento) permanece em fila humana; nota de confiança da IA não decide sozinha
- **Consequências:** menos volume automático, mais segurança jurídica
- **Rejeitada:** autopublicação por threshold de confiança IA

## ADR-010 — Cron K-NEWS com nome distinto

- **Decisão:** `knews-process-jobs` separado de `supabase-process-background-jobs` do BLOGGER; verificação via `cron.job`/`cron.job_run_details` e `knews.get_job_health()`
- **Consequências:** sem colisão de agendamento; observabilidade isolada
- **Rejeitada:** reusar o mesmo job `pg_cron` com `OR` em `job_type`

## ADR-011 — Domínio principal portal24h.news e multidomínio por subdomínio

- **Data:** 2026-10-23 · **Status:** Aceita
- **Contexto:** Rede precisa operar N portais municipais sem republicar código, com SEO/sitemap/ads isolados por cidade e administração central sem deploy.
- **Decisão:** Domínio principal `portal24h.news`, portais em `*.portal24h.news` (`guaruja.portal24h.news`, `santos.portal24h.news` etc.). Mesma aplicação Next.js com resolução dinâmica por `host` via `lib/domains.ts` (`extractCitySlugFromHost`, `buildPortalHost`, `isPortal24hHost`) e `lib/portal.ts` (`resolvePortalFromHost` + fallback `*.portal24h.news` + `canonicalUrl(citySlug)`). `middleware.ts` expõe `x-knews-city`/`x-knews-host`; `app/portal/page.tsx` e `app/portal/noticia/[slug]/page.tsx` consomem `headers()`; `app/sitemap.ts` e `app/robots.ts` são por-host. Vercel com wildcard `*.portal24h.news` (CNAME `*.portal24h.news` → `cname.vercel-dns.com`) — preparação sem publicar DNS sem autorização. Dados/permissões isolados por `portal_id`/`city_id` em `knews` (RLS `can_read/edit_portal`).
- **Consequências:** Cadastro de nova cidade é só `knews.cities` + `knews.portals` + `knews.portal_domains` + fontes/editorias/ads — sem alteração de código. SEO e inventário publicitário por subdomínio. Requer DNS wildcard e Vercel Domains configurados antes de produção.
- **Alternativas rejeitadas:** Um domínio por cidade com deploys separados (custo/operacional inviável); path-based `/cidade` (pior SEO local e compartilhamento); reuso de `knews.example.com`.

---
*Próximas ADRs serão acrescentadas por fase (ex.: escolha de provedor de pesquisa, estratégia de CDN, retenção de logs).*
