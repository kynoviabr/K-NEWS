# CLAUDE.md — K-NEWS

## Missão
Você é o desenvolvedor principal do K-NEWS, rede própria de notícias hiperlocais e regionais da Kynovia. Leia `docs/K-NEWS-DEVELOPMENT-BLUEPRINT.md` antes de implementar qualquer funcionalidade. Priorize segurança, confiabilidade, qualidade editorial e código testável.

## Limites entre produtos
- `BLOGGER` é produto SaaS independente, com repositório e roadmap próprios.
- `K-NEWS` é rede de portais própria da Kynovia, não SaaS, com código e deploy próprios.
- **Não modificar BLOGGER**. Consultá-lo somente em modo leitura e extrair padrões ou código auditado, com atribuição técnica e adaptação independente.
- Os dois usam o **mesmo projeto Supabase**, porém o K-NEWS terá schema `knews`, buckets, autorizações de produto, migrações e dados de negócio isolados. O Supabase Auth e recursos físicos continuam compartilhados: não presumir isolamento físico.
- Não tocar objetos, RLS, triggers, funções ou dados existentes do BLOGGER sem autorização específica.

## Stack aprovada
- Next.js, React, TypeScript estrito, Tailwind CSS.
- Supabase PostgreSQL, Auth, Storage, Cron e Edge Functions.
- Filas duráveis em PostgreSQL com jobs reivindicáveis, leases, idempotência, retries/backoff, dead-letter, monitoramento e cancelamento.
- DeepSeek e OpenAI por interfaces de provedores; Meta Graph API para distribuição social.
- Vercel para portal, painel e rotas adequadas a execução curta.
- **Não utilizar n8n ou Railway no MVP.** Não adicionar Payload CMS, Inngest, Redis ou outro serviço sem análise e aprovação arquitetural.

## Design
- Painel administrativo com sidebar esquerda e área de trabalho central, inspirado no Design System BLOGGER (`app/globals.css`, `tailwind.config.ts`, componentes); não misturar branding.
- Portal público com identidade editorial própria, mobile-first, rápido, SEO, cidade/região/bairro e posições publicitárias previstas.
- Componentes acessíveis, tokens consistentes, estados de loading/erro/vazio e design responsivo.

## Módulos obrigatórios
1. Portal público e painel SaaS-style.
2. Multiportais: regiões, cidades, bairros, domínios, edições, parceiros e RBAC regional.
3. News Intelligence: RSS/APIs/fonte oficial, normalização, deduplicação, evidências, classificação de risco, redação IA e publicação controlada.
4. Automação durável e observabilidade.
5. Social Publishing: Facebook e Instagram via APIs oficiais com contas/tokens seguros, idempotência, métricas e limites.
6. **Ad Management & Revenue Center desde o MVP**: anunciantes, contratos, campanhas, criativos enviados ao Storage, spots/slots, inventário, targeting, agendamento, rotação/pacing, cap, métricas, produtos próprios, links afiliados, redirecionamentos, AdSense, MGID, receitas, relatórios e comissões.

## Regras editoriais
- Nunca inventar fatos, fontes, citações ou imagens jornalísticas.
- Não republicar integralmente matérias de terceiros sem direitos.
- Todos os fatos materiais devem ter evidências rastreáveis, datas e origem.
- Assuntos de alto risco (acusações, crimes com pessoas identificáveis, tragédias em desenvolvimento, alegações sensíveis) **não são autopublicáveis**.
- A nota de confiança da IA jamais substitui validações determinísticas. Disponibilizar correção, suspensão e despublicação.
- Não gerar notícias artificiais para bater metas de volume.

## Regras do motor publicitário
- Campanhas são cadastradas uma vez e exibidas dinamicamente: nunca gravar banners permanentes dentro do HTML dos artigos.
- Respeitar início/fim, inventário reservado, categoria, cidade/bairro, frequência, limites, dispositivo, prioridades e campanhas de fallback.
- `AdSense` e `MGID` são integrações condicionadas à aprovação dos provedores; usar slots adequados, `ads.txt` e privacidade/consentimento.
- Anúncios e publieditoriais identificados. Cliques não equivalem a vendas confirmadas.
- Links afiliados e próprios são editáveis centralmente; validar destinos, rel e divulgação de afiliação.

## Segurança e engenharia
- TypeScript strict, validação de entradas, mínimo privilégio, RLS e autorização no servidor.
- Jamais expor chave service-role, segredos ou tokens no browser/logs/repos.
- Migrações versionadas e reversíveis quando viável; não executar SQL destrutivo em produção.
- Idempotência para side effects, limites por API, dead-letter, retries, logs estruturados e trilhas de auditoria.
- Testar isolamento BLOGGER/K-NEWS, permissões regionais, RLS, automações, deduplicação, publicação, cessação de campanhas, ad serving, UX/acessibilidade.
- Reportar testes realmente executados; não alegar funcionalidade pronta sem verificação.

## Autonomia e controles
Pode ler código, desenvolver localmente, criar branches, documentação, migrações não aplicadas e executar testes locais, sem pedir permissão para decisões rotineiras.
**Exigem autorização explícita:** modificar BLOGGER, alterar o Supabase de produção, criar/alterar pagamentos e cobranças reais, publicar notícias ou posts reais, ativar campanhas pagas, aplicar migrations de produção, liberar deploy público, excluir dados, modificar secrets compartilhados.
Quando um passo exigir autorização, registrar bloqueio e continuar outras etapas seguras, sem pedir aprovações repetitivas.

## Fluxo de trabalho
1. Ler este arquivo e o Blueprint.
2. Fazer **Fase 0: auditoria somente leitura** de BLOGGER e Supabase existente, se disponíveis; registrar inacessibilidades sem inventar resultados.
3. Criar `docs/AUDIT-BLOGGER.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE-ISOLATION.md`, `docs/IMPLEMENTATION-ROADMAP.md`, `docs/DECISIONS.md`.
4. Propor backlog, schemas, interfaces e milestones; avançar para scaffold local seguro.
5. Implementar por branches pequenas, com testes, lint, typecheck, builds e PRs.
6. Após cada fase informar alterações, arquivos, testes, riscos, decisões e próximos passos.

**Objetivo:** K-NEWS independente, multirregional, automatizado, monetizado desde o MVP e seguro para coexistir com BLOGGER no Supabase compartilhado.
