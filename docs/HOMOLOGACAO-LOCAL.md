# Homologação em PostgreSQL local (Supabase Docker)

> **Data:** 2026-10-24 · **Base auditada:** `origin/main` `980451e` + `feat/homologacao-final` `3bd0224` (commits recuperados do clone local) · **Ambiente:** Supabase CLI 2.122.0, Postgres 17 em Docker, sem conexão com o projeto remoto.

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
| 7 | `20261026000001_knews_news_admin.sql` recriava `knews.article_evidences` e a política `knews_evidences_select`: a migration falhava; com `if not exists` as colunas `source_type`/`content_snippet` nunca seriam criadas. | Bloqueante | Corrigido no próprio arquivo com `alter table ... add column if not exists`. |
| 8 | `20261026000003_knews_social_partners.sql` com o mesmo `unique(... coalesce ...)` inválido. | Bloqueante | Índice único por expressão. |
| 9 | `claim_jobs`, `complete_job`, `fail_job`, `heartbeat_job`, `expire_stale_reservations`, `get_job_health` (SECURITY DEFINER) executáveis por PUBLIC; `reserve_ad` por qualquer autenticado. Qualquer usuário logado, inclusive do BLOGGER, podia manipular a fila e consumir orçamento de campanhas. | Crítica | Somente `service_role`. A rota `/api/ads/reserve` passa a usar o cliente de servidor com `schema("knews")` (antes chamava `public.reserve_ad`) e limita por IP. |
| 10 | Storage `knews-creative`: qualquer autenticado lia e enviava qualquer criativo. | Alta | Caminho `<campaign_id>/<arquivo>` e política via `knews.can_edit_campaign()`. |
| 11 | `knews.partners` com `using (true)` e `partner_territories` (comissões) legíveis por qualquer autenticado. | Alta | Somente `super_admin` até o RBAC de parceiros. |

## Testes de integração reais (21)

Rodam no CI (job `db-integration`) contra um Supabase efêmero, com dados sintéticos de Guarujá e Santos:

- `rls-isolation.int.test.ts`: anon sem acesso ao schema e às funções; funções da fila e do ad server só com `service_role`; editor de Guarujá não lê, altera, apaga nem cria conteúdo de Santos; parceiro comercial não edita conteúdo editorial; usuário sem vínculo K-NEWS não vê nada; anunciantes restritos a `super_admin`.
- `jobs-queue.int.test.ts`: 4 conexões concorrentes em `claim_jobs` sem sobreposição; recuperação de lease vencido (queda do worker); backoff, dead-letter e `job_events`; idempotência.
- `ad-reserve.int.test.ts`: 60 reservas simultâneas com cap 25 entregam exatamente 25; mesma chave de idempotência consome uma vez.

## Estado dos módulos (após conciliação com `feat/homologacao-final`)

| Módulo | Classificação |
|---|---|
| Fundação (Next.js, auth SSR, middleware, design system, CI) | Implementado com testes simulados (typecheck, lint, build ok) |
| Schema `knews` + RLS de portais/artigos/anunciantes/parceiros | Concluído e testado em integração real |
| Jobs duráveis (claim, lease, retry, DLQ) | Funções SQL testadas em integração real; falta worker conectado aos handlers e agendamento |
| Reserva de anúncio (`reserve_ad`) | SQL testado em integração real sob concorrência; rota de decisão (`/api/ads/decision`) ainda consulta o schema `public` e não funciona |
| News Intelligence | Parcialmente implementado: fetch seguro, dedup, claims e IA com testes simulados; sem coleta conectada ao banco nem fila de revisão |
| Portal público | Parcialmente implementado: ainda usa dados demonstrativos; o middleware grava a cidade em cabeçalho de resposta, que os Server Components não leem |
| Social (Meta) e parceiros | Tabelas criadas; sem integração nem CRUD |

`docs/STAGING.md` (dos commits recuperados) descrevia "12 migrations com validação completa", mas duas delas não aplicavam; a contagem atual é 13 e a validação real é a descrita aqui.
