# K-NEWS — Development Blueprint

**Versão:** 1.0 · **Proprietária:** Kynovia · **Executor principal:** Claude Code · **Cidade piloto:** Guarujá/SP

## 1. Visão e produtos
K-NEWS é uma rede de portais jornalísticos locais/regionais da Kynovia, inicialmente Guarujá e futuramente Santos, Baixada Santista, Litoral Norte, Litoral Sul e localidades com parceiros. A plataforma é única e multiportal, com marca, domínio e fontes configuráveis por região. K-NEWS não é SaaS. BLOGGER é outro produto, potencial SaaS, a ser preservado totalmente independente.

**Regras:** dois repositórios, dois deploys e operações separadas; mesmo projeto Supabase por decisão de negócio, com schema, storage e autorização separadas. Reutilizar só bibliotecas/componentes auditados — não mesclar bancos, campanhas, usuários autorizados ou workflows.

## 2. Stack e responsabilidades
| Camada | Tecnologia | Função |
|---|---|---|
| Portal público | Next.js / React / Tailwind | Notícias, cidade, bairro, SEO, anúncios |
| Admin | Next.js / React | Operação editorial, regional, parceiros, monetização |
| Backend | TypeScript / rotas seguras / Edge Functions | APIs e lógica de negócio |
| Dados/Auth | Supabase PostgreSQL / Auth | Conteúdos, campanhas, trilhas, RLS |
| Storage | Buckets K-NEWS | Fotos, criativos, assets sociais |
| Jobs | Postgres durável + Supabase Cron | Captura e processos recuperáveis |
| IA | DeepSeek e OpenAI | Extração, classificação, redação, avaliação |
| Distribuição | Meta Graph API | Facebook / Instagram |
| Hospedagem | Vercel | Site, painel e APIs leves |

Sem n8n, sem Railway no MVP. Processamento pesado futuro pode justificar infraestrutura separada, por decisão documentada.

## 3. Estrutura inicial sugerida
```
K-NEWS/
├── CLAUDE.md
├── docs/
│   ├── K-NEWS-DEVELOPMENT-BLUEPRINT.md
│   ├── AUDIT-BLOGGER.md                 # a gerar
│   ├── ARCHITECTURE.md                 # a gerar
│   ├── DATABASE-ISOLATION.md           # a gerar
│   ├── IMPLEMENTATION-ROADMAP.md       # a gerar
│   └── DECISIONS.md                    # a gerar
├── app/
│   ├── (public)/
│   ├── (admin)/
│   └── api/
├── components/{ui,news,advertising,dashboard}/
├── modules/{regions,partners,news,editorial,social,ads,affiliates,analytics}/
├── services/{ai,rss,meta,jobs}/
├── lib/{auth,supabase,security}/
├── supabase/{migrations,functions,tests}/
└── tests/
```

## 4. UX/UI
**Admin:** padrão SaaS do BLOGGER: sidebar fixa à esquerda, conteúdo principal à direita, dashboard, tabelas, filtros, formulários, responsividade e acessibilidade. Auditar tokens CSS e Tailwind de BLOGGER antes de reutilizar; manter identidade de marca independente.

**Portal:** visual jornalístico original e mobile-first; manchetes, categorias, notícias relacionadas, filtros por localidade, busca, transparência editorial, contato, histórico de atualização e blocos de publicidade com baixa interferência no conteúdo. Implantar dados estruturados NewsArticle, sitemap, metadata, canonical e boa performance/Core Web Vitals.

## 5. Multiportal e parceiros
Entidades: regions, cities, neighborhoods, portals, portal_domains, portal_localities, partners, partner_territories, partner_commissions, portal_social_accounts. Notícias podem pertencer a várias localidades sem duplicação. Anunciantes podem contratar bairro/cidade/região/rede inteira. Separar escopo editorial e território comercial.

RBAC: super admin, gestor regional, editor regional, parceiro comercial, operador técnico e anunciante. Permissões por portal/território; comercial não ganha acesso editorial; parceiros não acessam dados confidenciais de outras regiões.

## 6. Supabase compartilhado e proteção BLOGGER
Auditar schemas, migrations, tabelas `public`, storage, funções, políticas e Auth do BLOGGER **somente em leitura**. Criar plano para schema `knews`, acesso por funções/APIs controladas e RLS explícita. Não pressupor RLS funcionando automaticamente em schema novo nem expor schema via API sem análise.

Buckets K-NEWS separados; políticas restritivas; credenciais não compartilhadas no frontend. Migrações revisadas antes de aplicar. Backups e restauração testados, considerando que o mesmo projeto possui riscos e limites compartilhados.

## 7. News Intelligence Engine
Fontes: RSS do Google News (descoberta), fontes municipais oficiais, diários oficiais, RSS regionais autorizados, APIs licenciadas, eventos e serviços. Registrar licença/termos, consultas e falhas por fonte.

Pipeline: consultar feeds → normalizar dados → deduplicar por URL/canonical/evento → classificar município/bairro/editoria → consultar evidências permitidas → verificar consistência temporal → gerar rascunho original IA → auditoria de claims → aplicar regras editoriais → publicar conteúdos elegíveis → distribuir nas redes → medir desempenho.

Não tratar reprodução de veículos como direito adquirido. Não fabricar informações, falas ou imagens de fatos. Manter URLs das fontes, snapshots/evidências permitidas, decisões automáticas, correções e retirada. Assuntos de alto risco permanecem bloqueados para autopublicação. Metas de quantidade jamais forçam publicação.

## 8. Orquestração robusta
Jobs em Postgres com status (`queued`, `running`, `retrying`, `completed`, `dead_letter`, `cancelled`), idempotency_key, prioridade, attempts, lease_expiration, claimed_by, scheduled_at, logs e métricas. Worker usa claims atômicos, timeout, heartbeat quando necessário e recuperação de lease. Decompor tarefas longas; reconciliar side effects quando confirmação externa for ambígua. Supabase Cron acorda a fila; Edge Functions executam passos curtos. Kill switch de publicação.

Examinar a migração `BLOGGER/supabase/migrations/20261020110711_durable_background_jobs.sql` apenas como referência — **não reutilizar suas tabelas diretamente**.

## 9. Social Publishing Engine
Meta Graph API com permissões oficiais e tokens armazenados com segurança. Vincular contas às localidades/portais; criar copy e criativos por formato; programar publicação, registrar IDs e evitar duplicidade no retry; capturar métricas disponíveis. Suportar inicialmente Facebook Posts e Instagram Feed conforme aprovações; demais formatos após validar limitações da API. Imagens reais devem ser licenciadas ou produzidas com conteúdo claramente não documental.

## 10. Ad Management & Revenue Center — obrigatório desde o MVP
Não exigir alterar páginas ou HTML de artigos para anúncios vendidos. Cadastro central e serving dinâmico.

### Entidades
- advertisers, advertiser_contacts, ad_contracts, commercial_packages
- ad_campaigns, campaign_targets, campaign_allocations
- ad_creatives, ad_slots, ad_slot_sizes, ad_inventory
- ad_decisions, ad_impressions (agregadas com método auditável), ad_clicks, ad_reports
- products, affiliate_networks, affiliate_offers, outbound_links, affiliate_conversions
- ad_providers, ad_provider_settings, revenue_entries, partner_commissions

### Fluxo da campanha
Cadastrar anunciante → vender contrato → cadastrar campanha e valor → subir criativos → escolher slots, categorias e territórios → validar conflito de inventário → ativar em data definida → servir rotativamente respeitando contrato e pacing → medir impressões/cliques → finalizar automaticamente → relatório e receita.

### Regras de entrega
Elegibilidade por status, data, inventário, território, página, categoria, dispositivo e formatos. Prioridade contratual e regras de rotação. Limites de exposição diária, pacing, frequência quando viável e fallback. Anti-fraude razoável para métricas. Suspensão imediata. Publicidade claramente rotulada.

### Produtos e afiliados
Catálogo de produtos próprios, imagens, páginas de venda e checkout; links afiliados e de redirecionamento seguros, com parâmetros autorizados, atribuição de campanhas, logs agregados e declarações de afiliação. Não contabilizar conversões sem dados fornecidos pela rede/checkout.

### AdSense + MGID
Criar slots parametrizados por provider, integrar scripts oficiais após aprovação, consentimento/privacidade, `ads.txt`, controles de exibição e desempenho. Não assumir receita garantida ou intercambialidade automática de leilões. Registrar receitas confirmadas versus estimadas.

### Financeiro e parceiros
Contratos, pacotes, campanhas, valores vendidos/faturados/recebidos, vencimentos, comissões por território e relatórios para anunciantes. Alterações de preço/contratos auditadas e RBAC específico.

## 11. Painel administrativo
Menus: Visão Geral; Notícias; Fontes; Editorias; Localidades/Portais; Redes Sociais; Ad Management; Anunciantes; Produtos/Afiliados; Comercial/Receita; Parceiros; Automações; Analytics; Usuários/Permissões; Configurações.

KPI: notícias captadas/publicadas/bloqueadas, jobs e falhas, tráfego por portal, campanhas ativas/expirando, impressões/cliques, receitas por tipo e comissões.

## 12. Testes e qualidade
TypeScript strict; Zod/validação; RBAC/RLS; secrets somente no backend; logs sem credenciais; lint/typecheck/build e testes CI. Testar deduplicação, cron/worker crash recovery, concorrência, idempotência, acesso cruzado entre produtos/regiões, campanhas expiradas, pacing, downloads e uploads seguros, redirecionamentos, controle de consentimento, publicação Meta e estados de falha. Usar staging/mocks quando necessário, sem reportar testes simulados como integrações reais.

## 13. Fases e entregáveis
**Fase 0 — Auditoria sem escrita:** inspecionar BLOGGER, design system, Supabase, jobs, riscos; produzir AUDIT-BLOGGER, ARCHITECTURE, DATABASE-ISOLATION, IMPLEMENTATION-ROADMAP, DECISIONS.

**Fase 1 — Fundação:** repo K-NEWS, Next.js, design system, admin shell, autenticação/autorização, isolamento e CI.

**Fase 2 — Portal:** páginas jornalísticas, portal/domínios/cidades/bairros, SEO, conteúdo demo e layouts de slots publicitários.

**Fase 3 — Notícias:** catálogo de fontes, RSS, jobs, IA, evidências e guardrails de publicação.

**Fase 4 — Monetização:** anunciantes, contratos, criativos, ad server, campanhas dinâmicas, afiliados/produtos, AdSense/MGID pronto para habilitar, analytics.

**Fase 5 — Social:** Meta API, templates, agendamento, deduplicação e métricas.

**Fase 6 — Parceiros:** territórios, gestão comercial, comissões e delegação segura.

**Fase 7 — Homologação:** segurança, correção editorial, desempenho, carga, operação de falhas, checklist jurídico/comercial e lançamento Guarujá.

## 14. Critérios de aceite do MVP
- Portal público mobile/desktop e painel admin.
- Isolamento seguro de BLOGGER e de territórios.
- Cadastro de cidades/portais e parceiros preparado para expansão.
- Captura e publicação automática **apenas quando elegível** e rastreável.
- Filas e retentativas com testes de falhas.
- Campanhas cadastradas uma vez, entregues e encerradas dinamicamente sem editar artigos.
- Upload de criativos, produtos próprios e afiliados administráveis.
- AdSense/MGID integráveis condicionados à aprovação.
- Publicações Meta suportadas após configuração de conta/permissões.
- Logs, relatórios, controle de receitas, correções editoriais e kill switch.
- Nenhuma mudança destrutiva ao BLOGGER ou produção sem autorização.

**Próxima ação do Claude Code:** executar Fase 0, em leitura, e iniciar scaffolding seguro sem alterações de produção.
