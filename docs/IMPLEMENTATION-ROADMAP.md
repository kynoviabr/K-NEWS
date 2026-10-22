# IMPLEMENTATION-ROADMAP — K-NEWS

> **Data:** 2026-10-21 · **Piloto:** Guarujá/SP · **Hospedagem:** Vercel · **Dados:** Supabase `knews` · **Sem n8n/Railway no MVP**

## 0. Estado atual (Fase 0 concluída)

- Auditoria somente leitura do BLOGGER concluída (`AUDIT-BLOGGER.md`)
- `ARCHITECTURE.md` e `DATABASE-ISOLATION.md` fechados
- K-NEWS ainda sem scaffold, sem schema `knews`, sem buckets, sem CI — este roadmap é o plano até o MVP aceito

## 1. Milestones e critérios de aceite

| Fase | Nome | Entregável verificável | Critério de aceite |
|---|---|---|---|
| 0 | Auditoria | 5 docs + scaffold | `typecheck`/`build` verdes, sem tocar BLOGGER/produção |
| 1 | Fundação | Repo + admin shell + auth + RLS `knews` + CI | Isolamento BLOGGER/K-NEWS testado com 2 usuários/portais |
| 2 | Portal | Portal público + SEO + domínios/localidades | Lighthouse/CWV ok, `NewsArticle`/`sitemap` válidos, slots de anúncios renderizam |
| 3 | Notícias | Fontes + RSS + jobs + IA + guardrails | Captura→evidências→bloqueio de alto risco testado; autopublicação só quando elegível |
| 4 | Monetização | Ad server + criativos + afiliados + AdSense/MGID pronto | Campanha ativa respeita datas/inventário/targeting/pacing; encerra sozinha; relatório fecha |
| 5 | Social | Meta Graph API + agendamento + métricas | Post idempotente, retry não duplica, métricas capturadas |
| 6 | Parceiros | Territórios + comissões + delegação | Parceiro vê só seu território; comercial não acessa editorial alheio |
| 7 | Homologação | Segurança, editorial, performance, juridiquez | Checklist de lançamento Guarujá assinado; kill switch e despublicação testados |

Critério MVP (Blueprint §14) só é “done” com todos os itens de 1–5 acima mais `ads.txt`/consentimento e logs/receitas.

## 2. Fase 1 — Fundação (próxima)

**Objetivo:** base segura e testável sem tocar BLOGGER.

- **Repo:** `git init` K-NEWS, `next 15`, `typescript strict`, `tailwind`, `eslint`, `zod`, `@supabase/ssr`, `vitest`
- **Design system:** `app/globals.css` + `tailwind.config.ts` derivados do BLOGGER (`AUDIT-BLOGGER.md §3.2`) com tokens K-NEWS e sem branding BLOGGER
- **Admin shell:** `components/layout/app-shell` + `sidebar` + `topbar` por `config/navigation.ts`; rotas `(admin)/*`
- **Auth/RBAC:** `lib/supabase/{server,client,auth}`, `middleware.ts` com `auth.getUser()`, cookies `selected_portal_id`
- **Supabase:** migrations `knews` (regions/cities/neighborhoods/portals/domains/portal_members), RLS `knews.can_*`, buckets `knews-*`, Vault naming `knews/<portal_id>/<provider>`
- **CI:** `typecheck` + `lint` + `test` + `build` em GitHub Actions

**Saída:** `supabase/migrations/*_knews_foundation.sql` não aplicada em produção sem autorização; testes de isolamento verdes localmente.

## 3. Fase 2 — Portal público

- Rotas `(public)`: home, categoria, localidade, artigo, busca, páginas institucionais
- SEO: `NewsArticle` JSON-LD, `sitemap.xml`, `robots.txt`, `canonical`, `openGraph`, `ads.txt` placeholder
- Multiportal: `portal_domains` + `portal_localities` + seleção por host
- Slots publicitários: `ad_slots` + `ad_slot_sizes` + `ad_inventory` (estrutura, sem lógica de leilão)
- Conteúdo demo com evidências visíveis; paginação e filtros por cidade/bairro

## 4. Fase 3 — News Intelligence

- `knews.sources` com `license/terms`, `knews.fetch_logs`, `knews.evidences`, `knews.articles` com `risk_level`
- Jobs `knews.jobs` (`rss_fetch`, `normalize`, `classify`, `draft`, `publish`) com `claim/heartbeat/complete`, `job_events`, `pg_cron knews-process-jobs`
- Provedores IA via `knews.provider_credentials` (Vault); `research` com SSRF/sanitização como no BLOGGER
- Guardrails determinísticos + nota de confiança IA (não decisória)

## 5. Fase 4 — Ad Management & Revenue Center (MVP obrigatório)

- `advertisers`, `ad_contracts`, `commercial_packages`, `ad_campaigns`, `campaign_targets/allocations`, `ad_creatives` (Storage `knews-creative`), `ad_slots/sizes/inventory`, `ad_decisions`, `ad_impressions/clicks`, `ad_reports`, `products`, `affiliate_*`, `outbound_links`, `ad_providers/settings`, `revenue_entries`, `partner_commissions`
- Fluxo: `anunciante → contrato → campanha → criativos → slots/territórios → validação de inventário → pacing → impressões/cliques → encerramento → relatório`
- `AdSense`/`MGID` como `ad_providers` com `ads.txt`/consentimento condicionados à aprovação

## 6. Fase 5 — Social Publishing

- `knews.portal_social_accounts` com tokens Vault, `knews.social_posts` com `external_post_id`
- Templates por formato, agendamento, idempotência, métricas; Facebook/Instagram no MVP

## 7. Fase 6 — Parceiros

- `partners`, `partner_territories`, `partner_commissions` com escopo comercial separado do editorial; RBAC por território

## 8. Fase 7 — Homologação

- Testes: isolamento, RBAC regional, RLS, deduplicação, cron/worker crash recovery, concorrência, idempotência, expiração de campanhas, pacing, uploads, redirecionamentos, consentimento, publicação Meta, estados de falha
- Performance/CWV, carga, jurídico/comercial, operação de falhas, correção/suspensão/despublicação

## 9. Backlog priorizado (Fase 1)

1. `git init` + `next init` + `globals.css`/`tailwind`/`components/ui` + `app-shell`
2. `lib/supabase` + `middleware` + `config/navigation` + `app/(admin)` esqueleto
3. `supabase/migrations/*_knews_foundation.sql` (não aplicar em prod)
4. `tests/isolation.knews.test.ts` + CI

## 10. Dependências e bloqueios

- **Bloqueado até autorização:** `supabase db push`, `storage bucket create`, `vault secret create`, `pg_cron` em produção, Vercel deploy público, publicação real, campanhas pagas
- **Requer definição:** domínios piloto Guarujá, provedores IA preferidos (DeepSeek/OpenAI), buckets finais, política de retenção de logs

## 11. Riscos

- Supabase compartilhado: contenção de `pg_cron`/`pg_net` e confusão de `search_path` — mitigado por nomes distintos e testes de concorrência
- Vazamento de branding BLOGGER — mitigado por design tokens independentes
- Promessas de receita AdSense/MGID — mitigado por receitas `estimada` vs `confirmada` e `ads.txt` bloqueante

---
*Roadmap vivo. Cada fase fecha com PR, `typecheck`/`build` e nota de verificação honesta.*
