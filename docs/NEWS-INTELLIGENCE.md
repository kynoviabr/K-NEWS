# News Intelligence — fluxo ponta a ponta

> **Estado:** concluído e testado em integração real no Supabase local (Docker). Nada roda no projeto remoto compartilhado sem autorização.

## Fluxo

1. **Fonte** (`/fontes`): o editor do portal cadastra um feed RSS/Atom com licença/termos e intervalo. RLS: só editores do próprio portal; fontes de rede (sem portal) só `super_admin`.
2. **Agendamento**: `knews.enqueue_due_source_fetches()` enfileira uma coleta por fonte vencida (idempotente por janela). Acionado por `POST /api/internal/jobs/run` com `Authorization: Bearer $CRON_SECRET` (pg_cron + pg_net no Supabase, ADR-012), ou "Coletar agora" no painel.
3. **Coleta** (`rss_fetch`): `fetchRssSafe` valida protocolo, credenciais na URL, **IP resolvido via DNS** (bloqueia rede interna v4/v6), redirecionamentos, `Content-Type`, timeout e tamanho em streaming. `parseFeed` lê RSS 2.0/Atom e recusa `DOCTYPE`.
4. **Deduplicação persistente**: `knews.ingest_source_items` grava no ledger `knews.processed_canonicals` (URL canônica sem `utm_*`, `www`, barra final) e marca como duplicata o mesmo título normalizado em 72 h (outro veículo republicando).
5. **Rascunho** (`draft`): classificação territorial pelo cadastro de cidades/bairros (itens fora do território são descartados com motivo); rascunho por DeepSeek ou OpenAI (`services/ai-provider.ts`, JSON mode, custo em `knews.ai_costs`). Sem chave, o rascunho vem marcado "sem IA" e o banco recusa publicá-lo até ser reescrito.
6. **Checagens determinísticas** (`lib/news-intelligence/draft-guard.ts`): número ou citação ausente da fonte vira afirmação "sem respaldo" (bloqueia publicação); cópia de 15+ palavras seguidas é sinalizada. Coincidência de palavras não é tratada como prova: ela só manda para revisão.
7. **Revisão humana** (`/noticias`): fila com risco, motivos, evidências e afirmações; editor reescreve (afirmações são reextraídas e reconferidas a cada salvamento), confirma ou marca afirmações, aprova com nota, devolve ou rejeita (`knews.review_article`).
8. **Publicação**: trigger `knews.guard_article_publication` vale para qualquer caminho (RPC, update direto, service_role) e exige: pessoa autenticada, portal com publicação habilitada (kill switch `portals.publishing_enabled`), risco diferente de `blocked`, ao menos uma evidência, nenhuma afirmação pendente, texto ≥ 200 caracteres e sem marcador "sem IA". Reduzir risco exige gestor regional. Cada decisão gera `editorial_decisions`, `article_versions` e `audit_logs`.
9. **Portal**: `/portal` e `/portal/noticia/[slug]` resolvem o portal pelo hostname (`portal_domains` ou `<slug>.portal24h.news`) e leem só o publicado via schema `knews_public` (ADR-011). Fontes e correções aparecem na matéria; JSON-LD `NewsArticle`, canonical e sitemap por portal.
10. **Retirada**: `knews.unpublish_article` exige motivo, tira do ar e registra correção pública.

## Rodar localmente

```bash
npx supabase start                 # aplica migrations + supabase/seed.sql (Guarujá e Santos sintéticos)
npx supabase status -o env         # copie API_URL/ANON_KEY/SERVICE_ROLE_KEY para .env.local (veja .env.example)
npm run dev                        # painel em localhost:3000, portal em guaruja.localhost:3000/portal
npx tsx scripts/run-worker.ts      # roda a fila uma vez (ou POST /api/internal/jobs/run)
npm run test:integration           # 30 testes reais, inclusive o fluxo completo
```

Crie o usuário editor no Auth local (Studio desligado: use `POST /auth/v1/admin/users` com a service key local) e vincule em `knews.portal_members`.

## Pendências conhecidas

- Coleta de feeds reais não foi exercitada neste ambiente (a rede do sandbox bloqueia sites externos); os testes usam um servidor RSS local.
- Integração real com DeepSeek/OpenAI depende de chaves; o cliente foi testado com respostas simuladas.
- Agendamento pg_cron → rota interna ainda não criado (exige URL pública do deploy e autorização).
- Afirmações "a verificar" são confirmadas pelo editor; não há verificação automática contra fontes oficiais.
