# Homologação em PostgreSQL local (Supabase Docker)

> **Data:** 2026-10-24 · **Base auditada:** `origin/main` `980451e` · **Ambiente:** Supabase CLI 2.122.0, Postgres 17 em Docker, sem conexão com o projeto remoto.

## Como rodar

```bash
npx supabase start          # sobe Supabase local e aplica supabase/migrations
npm run test:integration    # testes reais de RLS/isolamento contra o banco local
npx supabase db reset --local   # recria o banco local do zero (somente local)
```

O helper `tests/integration/db.ts` recusa qualquer host que não seja local.
`supabase/config.toml` agora contém a configuração completa do ambiente local
(schema `knews` exposto apenas na API local; studio/realtime/analytics desligados).
Nunca usar `supabase link`/`db push` contra `pnhxvhjudtrzvwduuigj` sem autorização.

Observação de ambiente: em sandboxes cujo proxy bloqueia o CDN do `public.ecr.aws`,
use `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io npx supabase start`.

## Achados e correções

| # | Achado | Gravidade | Correção |
|---|---|---|---|
| 1 | `20261023000003_knews_ads_hardening.sql` não aplicava: `unique(...coalesce(...))` não é SQL válido em constraint de tabela. As migrations nunca tinham rodado em Postgres real. | Bloqueante | Índice único por expressão no mesmo arquivo (migration nunca aplicada em lugar nenhum). |
| 2 | `knews.advertisers` com política `using (true)`: qualquer usuário autenticado, inclusive clientes do BLOGGER no Auth compartilhado, lia e alterava anunciantes. | Crítica | `20261024000002_knews_rls_hardening.sql`: somente `super_admin`. |
| 3 | `knews.regions` legível por qualquer autenticado (vazamento para usuários do BLOGGER). | Baixa | Leitura só para membros K-NEWS (`knews.is_member()`). |
| 4 | `cities`, `neighborhoods`, `portal_domains`, `portal_members` com RLS mas sem política: painel não conseguiria ler nada. | Funcional | Políticas de leitura por vínculo; usuário lê os próprios vínculos. |
| 5 | `knews.update_updated_at_column()` executável por `anon`. | Baixa | `revoke` de `public/anon/authenticated`. |
| 6 | Edge Function `knews-jobs`: qualquer `Authorization: Bearer <qualquer coisa>` ou GET sem cabeçalho passava e usava a service role. | Alta | Exige `CRON_SECRET`. |

## Testes de integração reais (12)

`tests/integration/rls-isolation.int.test.ts`, com dados sintéticos de Guarujá e Santos:
anon sem acesso ao schema e às funções; editor de Guarujá não lê, altera, apaga nem cria
conteúdo de Santos; parceiro comercial não edita conteúdo editorial; usuário sem vínculo
K-NEWS não vê nada; anunciantes restritos a `super_admin`. Rodam também no CI (job `db-integration`).

## Estado dos módulos no GitHub (`main` 980451e)

| Módulo | Classificação |
|---|---|
| Fundação (Next.js, auth SSR, middleware, design system, CI) | Implementado com testes simulados (typecheck, lint, build ok) |
| Schema `knews` + RLS de portais/artigos | Concluído e testado em integração real (após as correções acima) |
| Jobs duráveis | Parcialmente implementado: tabela existe; não há `claim_jobs`, `enqueue`, `job_events`, lease ou dead-letter no `main` |
| News Intelligence | Parcialmente implementado: normalização de URL e dedup em memória (`services/rss.ts`), motor editorial (`lib/editorial.ts`); sem coleta real, IA, rascunhos ou fila |
| Portal público | Parcialmente implementado: páginas usam dados demonstrativos fixos; sem leitura do banco nem resolução por hostname em uso |
| Ad Management | Parcialmente implementado: elegibilidade em TS com testes simulados; sem `reserve_ad`, impressões, cliques ou CRUD |
| Social (Meta) | Não implementado (apenas página stub) |
| Parceiros regionais | Não implementado (apenas página stub e papéis em `portal_members`) |

Itens do handover ausentes do GitHub (provavelmente só nos commits locais `7ca0149`/`3bd0224`):
`services/rss-fetch.ts`, `services/ai-provider.ts`, `lib/news-pipeline.ts`, `lib/claim-extractor.ts`,
`lib/geo.ts`, `lib/domains.ts`, `knews.reserve_ad`, `claim_jobs`, ~7 migrations, `docs/STAGING.md`,
`docs/LAUNCH-CHECKLIST.md`.
