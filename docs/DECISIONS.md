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

## ADR-011 — Leitura pública do portal via schema `knews_public`

- **Data:** 2026-10-24 · **Status:** Aceita
- **Contexto:** o portal é lido por visitantes anônimos, mas `anon` não tem acesso ao schema `knews` (isolamento do BLOGGER). Usar a service role no render público ampliaria o impacto de qualquer falha.
- **Decisão:** schema `knews_public` exposto ao `anon` contendo apenas funções `SECURITY DEFINER` que devolvem conteúdo publicado (`portal_by_host`, `published_articles`, `published_article`). `knews` continua fechado ao `anon`.
- **Consequências:** exige adicionar `knews_public` aos schemas expostos da API no projeto remoto quando houver autorização de deploy.

## ADR-012 — Worker da fila em rota interna da aplicação

- **Data:** 2026-10-24 · **Status:** Aceita
- **Contexto:** o worker usa o mesmo código TypeScript do app (parser, IA, guardas). Reescrever em Deno para a Edge Function duplicaria a lógica.
- **Decisão:** `POST /api/internal/jobs/run` (CRON_SECRET, comparação em tempo constante) executa `enqueue_due_source_fetches` + `runWorker`. O agendamento continua no Supabase (pg_cron + pg_net), coerente com ADR-006 (sem cron da Vercel). Jobs curtos, lease de 120 s.
- **Consequências:** a Edge Function `knews-jobs` fica só para health; revisar se o volume exigir execução fora da Vercel.

## ADR-013 — Publicação sempre humana no MVP

- **Data:** 2026-10-24 · **Status:** Aceita
- **Decisão:** o trigger de publicação exige `auth.uid()`; nenhum processo automático (service_role) publica. Autopublicação só será reavaliada após homologação, com evidências oficiais independentes.

## ADR-014 — Motor de anúncios no banco, servido no render do portal

- **Data:** 2026-10-24 · **Status:** Aceita
- **Contexto:** a decisão de anúncio em TypeScript (`lib/ad-inventory.ts`) não tinha trava nem contabilidade, e a rota `/api/ads/decision` lia o schema errado. Inventário vendido precisa de garantia transacional contra excesso de entrega.
- **Decisão:** `knews.serve_ad` (service_role) decide e reserva numa única transação, com `FOR UPDATE` na campanha e rechecagem do cap. O portal chama o motor no servidor para cada slot; o HTML guarda só um token opaco. Impressão confirmada por beacon de visibilidade (50% por 1 s); clique por redirecionador que conta uma vez. Ordem de preenchimento: campanha paga → provedor programático aprovado (AdSense/MGID) → campanha da casa. Área comercial separada da redação (`can_sell_portal`: super_admin, regional_manager, commercial_partner). Identificador de visitante só com consentimento e gravado como hash com sal do servidor.
- **Consequências:** páginas do portal ficam dinâmicas (já eram, por hostname). `lib/ad-inventory.ts`/`lib/ad-eligibility.ts` ficam como referência de regras em memória; a fonte da verdade é o banco. Exige `KNEWS_VISITOR_SALT` em produção.
- **Alternativas rejeitadas:** decisão no cliente via API pública (permitiria esgotar inventário com chamadas forjadas); Redis para contadores (serviço novo sem aprovação).

## ADR-015 — Distribuição social com envio no máximo uma vez

- **Data:** 2026-10-24 · **Status:** Aceita
- **Contexto:** reenviar um post após timeout duplica a publicação na página da cidade, e a Graph API não tem chave de idempotência. Tokens de página dão poder de publicar em nome do portal.
- **Decisão:** um post por matéria e rede (chave forçada pelo banco). `knews.begin_social_publish` trava a linha e marca `publishing` antes da chamada; só respostas da Meta que dizem que nada foi criado (5xx, limite de taxa) voltam para a fila. Sem resposta, ou job retomado que encontra `publishing`, vira `needs_check` e espera a equipe conferir. No Instagram o container (sem efeito público) é guardado e reaproveitado. Token cifrado com AES-256-GCM no servidor (`KNEWS_SOCIAL_TOKEN_KEY`, AAD portal+rede), nunca legível pelo painel, enviado só no cabeçalho `Authorization`. Envio real exige `KNEWS_SOCIAL_PUBLISHING=enabled`.
- **Consequências:** uma falha de rede pode deixar um post sem envio automático até alguém conferir; preferimos isso à duplicação. Conexão por token colado no painel até haver app Meta aprovado com login OAuth.
- **Alternativas rejeitadas:** Supabase Vault para os tokens (recurso compartilhado com o BLOGGER no mesmo projeto); repetir às cegas com backoff (duplica posts); ferramenta externa de agendamento (serviço novo sem aprovação).

---
*Próximas ADRs serão acrescentadas por fase (ex.: escolha de provedor de pesquisa, estratégia de CDN, retenção de logs).*
