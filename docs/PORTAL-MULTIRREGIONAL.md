# Portal multirregional (P3)

> Estado em 2026-10-24, homologado só no Supabase local. Migrations `20261030000001_knews_multiportal.sql` e `20261103000001_knews_portal_assets.sql` (logotipo e favicon). Decisão sobre hosts em ADR-018.

## Cadastro (painel `/localidades`)

| Quem | Pode |
|---|---|
| `super_admin` | Regiões, cidades, portais (`knews.create_portal`), domínios, ativar/desativar portal |
| `regional_manager` do portal | Nome, identidade (cores, nome no cabeçalho, slogan, logotipo e favicon), descrição SEO, bairros da cidade do portal |
| Redação do portal | Editorias; editoria e bairro de cada matéria |

- `create_portal` cria numa transação: portal **inativo**, domínio principal, vínculo `super_admin` do criador, 8 editorias padrão e registro em `audit_logs`.
- Slug e cidade do portal não mudam pelo painel (privilégio por coluna): mudariam URLs e o isolamento territorial.
- Tema validado no banco (`valid_portal_theme`: só `primary`, `accent`, `tagline`, `logo_text`; cores `#RRGGBB`) e no painel (contraste AA de texto branco sobre a cor principal). Só valores validados viram variáveis CSS.
- Logotipo (até 512 KB) e favicon (até 128 KB): PNG, JPEG ou WebP, com assinatura do arquivo conferida no servidor. Bucket público `knews-portal-assets`, caminho `<portal_id>/<logo|icon>-<uuid>.<ext>`; só a gestão do portal grava ou apaga (política do Storage). Sem SVG, que pode carregar script. O tema guarda só o caminho, que o banco exige ser do próprio portal (`knews_portals_assets_own`); o arquivo anterior é apagado na troca.
- Domínio: formato validado, único, um principal por portal. DNS fica fora do painel e exige autorização.
- Editoria e bairro de uma matéria precisam ser do portal e da cidade dela (trigger `guard_article_taxonomy`).

## Portal público

- Moldura por hostname com identidade da cidade, menu de editorias (as que têm matéria), busca e bairros no rodapé.
- Rotas na raiz do domínio da cidade: `/`, `/editoria/<slug>`, `/bairro/<slug>`, `/busca?q=` (noindex), `/noticia/<slug>`; paginação por `?pagina=`.
- Hosts: `localhost`, `*.vercel.app` e os listados em `KNEWS_PANEL_HOSTS` (ex.: `painel.portal24h.news`) são painel; qualquer outro host é portal. No host do portal o middleware reescreve as rotas para `app/portal`, redireciona `/portal/...` antigo (308) para a raiz, não serve painel nem login (404) e não abre sessão do Supabase. No painel, o portal continua visível em `/portal` como prévia (com `KNEWS_DEV_PORTAL_HOST` em desenvolvimento).
- `X-Robots-Tag: noindex` no painel, nas APIs e em `/r/`, aplicado pelo middleware (que sabe qual é o host).
- Busca textual em português sem acento (`knews.fold_text` + `tsvector` gerado e índice GIN), sem a extensão `unaccent`, para não mexer em recurso compartilhado do projeto Supabase.
- Canonical e sitemap usam o domínio principal do portal (ou `<slug>.portal24h.news`); o sitemap inclui editorias e bairros com matérias.
- Leitura só por funções de `knews_public` (`portal_by_host`, `portal_sections`, `search_articles`); portal inativo some do público.

## Testes executados

- `tests/integration/multiportal.int.test.ts` (7): busca sem acento isolada por portal, filtros, seções, portal inativo, taxonomia, criação de portal só por `super_admin`, permissões do gerente (tema inválido, status, slug, outro portal, domínio, bairro de outra cidade), editor sem acesso à identidade.
- `tests/theme.unit.test.ts` (3), `tests/hosts.unit.test.ts` (4), `tests/portal-assets.unit.test.ts` (3).
- `tests/integration/portal-assets.int.test.ts` (3): bucket público sem SVG e com limite; gestão grava, redação, comercial, outro portal, anônimo e nomes fora do padrão não; tema recusa caminho de outro portal ou URL externa.
- E2E (`tests/e2e/portal.spec.ts`, `identity.spec.ts`): portal na raiz de `guaruja.localhost`, redirecionamento 308 de `/portal/...`, painel 404 no host da cidade, prévia em `localhost/portal`; envio de logotipo e favicon pelo painel (arquivo falso recusado), exibição só em Guarujá, remoção apaga o arquivo do Storage.
- Navegador (local): menu e cor do tema de Guarujá; busca "pereque" acha só a matéria de Guarujá (e em Santos, só a de Santos); editoria, bairro e canonical; bairro de Santos dá 404 em Guarujá; sitemap com seções; gerente recusado com cor clara e aplicando nova cor e slogan; admin cria região, cidade e portal Bertioga, que só responde depois de ativado; editora define editoria e bairro de um rascunho.

## Pendências

- Matérias reais no banco local dependem de feeds externos (bloqueados no sandbox); a homologação usou matérias sintéticas marcadas "fixture local".
