# Checklist de lançamento — Guarujá (K-NEWS)

> Estado em 2026-10-24. Nada aqui foi executado fora do ambiente local. Os itens marcados **[autorização]** exigem aprovação explícita da Kynovia (CLAUDE.md, "Autonomia e controles"). Os itens já cumpridos têm a evidência ao lado.

## 1. Já verificado localmente

- [x] 19 migrations aplicam do zero (`supabase db reset --local`) e no CI (job `db-integration`).
- [x] Isolamento K-NEWS × BLOGGER, RLS entre Guarujá e Santos, fila, ad server, editorial, social, parceiros e operação: testes de integração em Postgres real (`npm run test:integration`).
- [x] E2E no navegador contra o build de produção (`npm run test:e2e`, job `e2e` no CI): portal por hostname em desktop e celular, consentimento, anúncio dinâmico, SEO (canonical, sitemap, robots, ads.txt), aprovação e retirada de matéria, bloqueio do painel sem login, isolamento de portal e parceiro, health check.
- [x] Cabeçalhos de segurança (nosniff, frame-ancestors, Referrer-Policy, Permissions-Policy, HSTS) e `noindex` fora do portal (`next.config.ts`).
- [x] Kill switch editorial: despublicação cancela posts sociais pendentes e some do portal e do sitemap.
- [x] Painel `/automacoes`: fila, dead-letter, fontes falhando, contas sociais expiradas; reprocessar e descartar com auditoria.

## 2. Supabase compartilhado **[autorização]**

- [ ] Backup ou PITR confirmado antes de qualquer migration.
- [ ] Revisão das 19 migrations `knews_*`: só criam objetos no schema `knews`/`knews_public`, buckets `knews-*` e funções próprias. Conferir com `supabase db diff` que nada do BLOGGER (schema `public`, RLS, triggers) muda.
- [ ] `supabase db push` no projeto compartilhado, em janela combinada.
- [ ] Expor `knews` e `knews_public` na API (Settings → API → Exposed schemas), mantendo os schemas do BLOGGER.
- [ ] Agendamento pg_cron + pg_net chamando `POST /api/internal/jobs/run` a cada minuto com `Authorization: Bearer <CRON_SECRET>` (ADR-006). O segredo fica no Vault do projeto com nome `knews_cron_secret`, sem tocar segredos do BLOGGER.
- [ ] Criar o primeiro `super_admin` e os vínculos da equipe de Guarujá.

## 3. Vercel **[autorização para o deploy público]**

Variáveis por ambiente (Preview e Production separados; nenhuma com prefixo `NEXT_PUBLIC_` além das três públicas):

| Variável | Observação |
|---|---|
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Públicas |
| `SUPABASE_SERVICE_ROLE_KEY` | Só servidor; nunca em Preview aberto |
| `CRON_SECRET` | Aleatório, 32+ bytes; o mesmo no Vault do Supabase |
| `KNEWS_VISITOR_SALT` | Aleatório; trocar invalida contagem de frequência dos anúncios |
| `KNEWS_SOCIAL_TOKEN_KEY` | 32 bytes base64; perder a chave obriga a reconectar as contas |
| `KNEWS_SOCIAL_PUBLISHING` | Deixar vazio até a autorização de envio real |
| `KNEWS_AI_PROVIDER`, `DEEPSEEK_*`, `OPENAI_*` | Chaves dos provedores de IA |
| `META_APP_ID`, `META_APP_SECRET` | Após aprovação do app |

- [ ] Não definir `KNEWS_DEV_PORTAL_HOST` nem `KNEWS_ALLOW_PRIVATE_FEEDS` em produção.
- [ ] Preview com proteção de acesso (Vercel Authentication) e banco que não seja o de produção.
- [ ] Deploy de produção e smoke test: `/api/health`, portal de Guarujá, login no painel.

## 4. Domínios e DNS **[autorização]**

- [ ] Domínio do painel separado do portal (ex.: `painel.portal24h.news`). Hoje o portal responde em `/portal` do mesmo host; levar o portal para a raiz do domínio da cidade ainda está pendente (ver `docs/PORTAL-MULTIRREGIONAL.md`).
- [ ] `guaruja.portal24h.news` cadastrado em `knews.portal_domains` e no projeto Vercel; certificado emitido.
- [ ] Nenhuma alteração de DNS sem autorização.

## 5. Monetização **[autorização para campanhas pagas]**

- [ ] AdSense e MGID: contas aprovadas pelos provedores, IDs nos slots e linhas de `ads.txt` no painel. Ao ativar, ampliar a CSP com `script-src` dos provedores (hoje a CSP não restringe scripts).
- [ ] Política de privacidade e consentimento revisados para os provedores externos.
- [ ] Primeira campanha paga ativada só com contrato assinado.

## 6. Distribuição social **[autorização para posts reais]**

- [ ] App Meta aprovado (`pages_manage_posts`, `instagram_content_publish`, `pages_read_engagement`).
- [ ] Contas conectadas pela gestão; um post de teste conferido manualmente antes de `KNEWS_SOCIAL_PUBLISHING=enabled`.

## 7. Monitoramento

- [ ] Monitor de disponibilidade externo chamando `GET /api/internal/health` com `Authorization: Bearer <CRON_SECRET>`: 200 é saudável, 503 traz os alertas (fila atrasada > 15 min, leases vencidos, dead-letter, fontes falhando, posts aguardando conferência, contas expiradas). A escolha do monitor é um serviço novo e precisa de aprovação.
- [ ] `/api/health` (público) para o balanceador.
- [ ] Logs da Vercel sem segredos (os tokens sociais nunca são logados; a Graph API recebe o token só no cabeçalho).

## 8. Riscos aceitos e pendências conhecidas

- `npm audit`: o `postcss` embutido no Next 15 tem um aviso moderado que só afeta o build; a correção exige o Next 16. `fast-xml-parser` tem aviso no `XMLBuilder`, que o projeto não usa (só o parser de RSS).
- Feeds RSS externos e provedores de IA nunca foram testados com rede real nem chaves reais.
- Graph API testada só contra um servidor falso local.
- Pagamento de comissões a parceiros é registrado no painel, mas a transferência é feita fora do sistema.
- Medição de desempenho (Core Web Vitals) só pode ser feita no domínio real, após o deploy.
