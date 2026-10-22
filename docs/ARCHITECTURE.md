# ARCHITECTURE — K-NEWS

> **Versão:** 1.0 · **Data:** 2026-10-21 · **Cidade piloto:** Guarujá/SP · **Status:** Fase 0 → fundação

## 1. Princípios

- **Isolamento BLOGGER/K-NEWS:** repositórios, deploys e dados distintos; mesmo projeto Supabase apenas por decisão de negócio, com isolamento lógico obrigatório (schema `knews`, buckets próprios, funções/RLS próprias, `search_path` explícito)
- **Segurança por padrão:** TypeScript strict, Zod nas bordas, RLS + autorização server-side, mínimo privilégio, segredos só no backend/Vault, sem `service-role` no browser
- **Confiabilidade editorial:** toda afirmação rastreável, evidências com origem/data, alto risco nunca autopublicável, nota de IA não substitui validação determinística, correção/suspensão/despublicação disponíveis
- **Monetização desde o MVP:** ad server dinâmico (sem banner gravado no HTML do artigo), inventário, targeting, pacing e relatórios
- **Automação durável:** fila Postgres com claims atômicos, leases, retries/backoff, dead-letter, cancelamento e observabilidade
- **Sem n8n/Railway/Payload/Inngest/Redis no MVP** sem decisão documentada

## 2. Visão de produtos

- **K-NEWS:** rede de portais hiperlocais/regionais (Guarujá → Santos/Baixada/Litoral com parceiros), multiportal por região/cidade/bairro/domínio/edição, RBAC regional, News Intelligence e Social Publishing
- **BLOGGER:** SaaS independente, repositório `kynoviabr/BLOGGER`, roadmap próprio — **não modificar**; consultar só em leitura e adaptar padrões com atribuição

## 3. Stack

| Camada | Tecnologia | Papel |
|---|---|---|
| Portal público | Next.js 15 / React 19 / Tailwind 3.4 | Notícias, SEO, localidades, slots de anúncios |
| Admin | Next.js / React | Operação editorial, comercial e regional |
| Backend | TypeScript + rotas seguras + Edge Functions | APIs, RLS, orquestração curta |
| Dados/Auth | Supabase Postgres + Auth | `knews.*`, RLS, `auth.users` compartilhado |
| Storage | Buckets `knews-*` | Fotos, criativos, assets sociais |
| Jobs | Postgres durável + Supabase Cron | Captura, IA, publicação, ad serving |
| IA | DeepSeek + OpenAI (via interfaces de provedor) | Extração, classificação, redação, avaliação |
| Social | Meta Graph API | Facebook/Instagram oficiais |
| Hospedagem | Vercel | Portal, painel e rotas curtas |

## 4. Estrutura de repositório

```
K-NEWS/
├── CLAUDE.md
├── docs/{K-NEWS-DEVELOPMENT-BLUEPRINT, AUDIT-BLOGGER, ARCHITECTURE, DATABASE-ISOLATION, IMPLEMENTATION-ROADMAP, DECISIONS}.md
├── app/
│   ├── (public)/         # portal público
│   ├── (admin)/          # painel com sidebar
│   └── api/              # rotas seguras, webhooks, crons leves
├── components/{ui, layout, news, advertising, dashboard}/
├── modules/{regions, portals, partners, news, editorial, social, ads, affiliates, analytics}/
├── services/{ai, rss, meta, jobs}/
├── lib/{auth, supabase, security, validations}/
├── supabase/{migrations, functions, tests}/
├── config/
└── tests/
```

- Admin segue padrão SaaS do BLOGGER (sidebar esquerda, área central) com identidade própria; portal é jornalístico, mobile-first, com SEO e posições publicitárias previstas
- Design tokens derivados de `BLOGGER/app/globals.css` + `tailwind.config.ts` sem copiar branding

## 5. Modelo multiportal e parceiros

**Entidades (schema `knews`):** `regions`, `cities`, `neighborhoods`, `portals`, `portal_domains`, `portal_localities`, `partners`, `partner_territories`, `partner_commissions`, `portal_social_accounts`, `portal_members` (RBAC por portal/território)

- Notícia pertence a N localidades sem duplicação; anunciante contrata por bairro/cidade/região/rede
- RBAC: `super_admin`, `regional_manager`, `regional_editor`, `commercial_partner`, `technical_operator`, `advertiser` — comercial não acessa editorial alheio; parceiro não acessa dados de outra região
- Domínios/edições configuráveis por portal; parceiros com território comercial e comissões isoladas

## 6. Supabase compartilhado — isolamento

- **Schema:** `knews` dedicado; `public` permanece do BLOGGER; `auth` compartilhado fisicamente
- **RLS:** políticas explícitas por `portal_id`/`territory_id`/`organization_id` equivalente K-NEWS; `service_role` bypassa, `authenticated` nunca acessa cruzado; `anon` revogado em `knews.*`
- **Storage:** buckets `knews-creative`, `knews-editorial`, `knews-social` com `storage.objects.name` particionado por portal; policies via funções `knews.can_*`
- **Funções:** `knews.*` em `search_path = ''`; sem `search_path` implícito; `GRANT` explícitos
- **Migrations:** versionadas, reversíveis quando viável; nunca destrutivas em produção sem autorização
- **Cron:** `pg_cron` K-NEWS dedicado (nome distinto do BLOGGER) → Edge Function `knews-jobs`

Detalhes em `DATABASE-ISOLATION.md`.

## 7. News Intelligence Engine

**Fontes:** Google News RSS (descoberta), fontes municipais oficiais, diários oficiais, RSS regionais autorizados, APIs licenciadas — cada consulta/falha/termo registrado

**Pipeline:** `fetch feeds → normalize → deduplicate (URL/canonical/evento) → classify (município/bairro/editoria) → collect evidences → temporal check → draft IA → claim audit → editorial guardrails → publish if eligible → distribute → measure`

- Alto risco (acusações, crimes com identificados, tragédias em desenvolvimento) → **bloqueado para autopublicação**, fila humana
- Nota de confiança da IA não decide sozinha; validações determinísticas são obrigatórias

## 8. Orquestração robusta

**Tabela `knews.jobs`:** `id`, `portal_id`, `job_type` (`rss_fetch`, `normalize`, `classify`, `draft`, `publish`, `social_publish`, `ad_serve`, `affiliate_sync`), `status` (`queued|running|retrying|completed|dead_letter|cancelled`), `payload jsonb`, `result jsonb`, `priority`, `attempts/max_attempts`, `idempotency_key`, `scheduled_at`, `claimed_at/by`, `lease_expires_at`, `created_by`

- Claims `FOR UPDATE SKIP LOCKED`, `lease` com `heartbeat`, `retry` com backoff, `dead_letter` após `max_attempts`, `cancelled` por kill switch
- `knews.job_events` para auditoria; `get_knews_job_health()` para cron/worker
- Supabase Cron acorda a fila; Edge Functions executam passos curtos; worker externo opcional com `claim_background_jobs`-like

Referência: `BLOGGER/supabase/migrations/20261020110711_durable_background_jobs.sql` **apenas como desenho**.

## 9. Social Publishing Engine

- Meta Graph API com permissões oficiais; tokens em Vault/`knews.portal_social_accounts` (nunca no browser)
- Copy/criativos por formato, agendamento, idempotência por `external_post_id`, captura de métricas e limites
- `Facebook Posts` e `Instagram Feed` no MVP; demais formatos após validar limites da API

## 10. Ad Management & Revenue Center (MVP obrigatório)

**Entidades:** `advertisers`, `advertiser_contacts`, `ad_contracts`, `commercial_packages`, `ad_campaigns`, `campaign_targets`, `campaign_allocations`, `ad_creatives`, `ad_slots`, `ad_slot_sizes`, `ad_inventory`, `ad_decisions`, `ad_impressions` (agregadas auditáveis), `ad_clicks`, `ad_reports`, `products`, `affiliate_networks`, `affiliate_offers`, `outbound_links`, `affiliate_conversions`, `ad_providers`, `ad_provider_settings`, `revenue_entries`, `partner_commissions`

**Fluxo:** `anunciante → contrato → campanha/valor → criativos (Storage) → slots/territórios → validação de inventário → ativa em data → serving rotativo com pacing → impressões/cliques → encerra automático → relatório/receita`

**Entrega:** elegibilidade por status/data/inventário/território/página/categoria/dispositivo/formato; prioridades contratuais, rotação, cap diário, frequência e fallback; anti-fraude razoável; suspensão imediata; rotulagem de publicidade

**AdSense/MGID:** slots parametrizados, scripts oficiais após aprovação, `ads.txt`, consentimento/privacidade, receitas `estimada` vs `confirmada`

## 11. Portal público

- Manchetes, categorias, relacionadas, filtros por localidade, busca, transparência editorial, correções, contato
- SEO: `NewsArticle` JSON-LD, `sitemap.xml`, `robots.txt`, `canonical`, `openGraph`, Core Web Vitals
- Slots publicitários por posição, sem interferir no conteúdo; lazy e `ads.txt` quando aplicável

## 12. Painel administrativo

Menus: Visão Geral · Notícias · Fontes · Editorias · Localidades/Portais · Redes Sociais · Ad Management · Anunciantes · Produtos/Afiliados · Comercial/Receita · Parceiros · Automações · Analytics · Usuários/Permissões · Configurações

KPIs: captadas/publicadas/bloqueadas, jobs/falhas, tráfego por portal, campanhas ativas/expirando, impressões/cliques, receita por tipo, comissões

## 13. Segurança

- `middleware.ts` via `supabase.auth.getUser()`; cookies `selected_portal_id` / `selected_organization_id`
- `anon` sem acesso a `knews.*`; `authenticated` só via RLS; `service_role` para workers
- `rate-limit.ts`, `image-optimizer.ts`, Zod nas bordas, logs sem credenciais, auditoria por `job_events`/`system_logs`
- `ads.txt` e consentimento antes de AdSense/MGID; `rel` e divulgação de afiliação validados

## 14. Observabilidade

- `knews.job_events` + `knews.system_logs` + `knews.ad_decisions` com `portal_id` e `created_at`
- Healthcheck: `knews.get_job_health()` + `cron.job` + `cron.job_run_details`
- Kill switch de publicação por portal; reconciliação de side effects ambíguos

## 15. Testes e qualidade

- `typecheck` + `lint` + `build` + `vitest` em CI; testes de isolamento BLOGGER/K-NEWS, RBAC regional, RLS, deduplicação, concorrência de claims, idempotência, expiração de campanhas, pacing, uploads, redirecionamentos, consentimento e publicação Meta

---
*Este documento consolida decisões da Fase 0. Implementação segue `IMPLEMENTATION-ROADMAP.md`.*
