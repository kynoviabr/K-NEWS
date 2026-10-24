# Portal multirregional (P3)

> Estado em 2026-10-24, homologado só no Supabase local. Migration `20261030000001_knews_multiportal.sql`.

## Cadastro (painel `/localidades`)

| Quem | Pode |
|---|---|
| `super_admin` | Regiões, cidades, portais (`knews.create_portal`), domínios, ativar/desativar portal |
| `regional_manager` do portal | Nome, identidade (cores, nome no cabeçalho, slogan), descrição SEO, bairros da cidade do portal |
| Redação do portal | Editorias; editoria e bairro de cada matéria |

- `create_portal` cria numa transação: portal **inativo**, domínio principal, vínculo `super_admin` do criador, 8 editorias padrão e registro em `audit_logs`.
- Slug e cidade do portal não mudam pelo painel (privilégio por coluna): mudariam URLs e o isolamento territorial.
- Tema validado no banco (`valid_portal_theme`: só `primary`, `accent`, `tagline`, `logo_text`; cores `#RRGGBB`) e no painel (contraste AA de texto branco sobre a cor principal). Só valores validados viram variáveis CSS.
- Domínio: formato validado, único, um principal por portal. DNS fica fora do painel e exige autorização.
- Editoria e bairro de uma matéria precisam ser do portal e da cidade dela (trigger `guard_article_taxonomy`).

## Portal público

- Moldura por hostname com identidade da cidade, menu de editorias (as que têm matéria), busca e bairros no rodapé.
- Rotas: `/portal`, `/portal/editoria/<slug>`, `/portal/bairro/<slug>`, `/portal/busca?q=` (noindex), `/portal/noticia/<slug>`; paginação por `?pagina=`.
- Busca textual em português sem acento (`knews.fold_text` + `tsvector` gerado e índice GIN), sem a extensão `unaccent`, para não mexer em recurso compartilhado do projeto Supabase.
- Canonical e sitemap usam o domínio principal do portal (ou `<slug>.portal24h.news`); o sitemap inclui editorias e bairros com matérias.
- Leitura só por funções de `knews_public` (`portal_by_host`, `portal_sections`, `search_articles`); portal inativo some do público.

## Testes executados

- `tests/integration/multiportal.int.test.ts` (7): busca sem acento isolada por portal, filtros, seções, portal inativo, taxonomia, criação de portal só por `super_admin`, permissões do gerente (tema inválido, status, slug, outro portal, domínio, bairro de outra cidade), editor sem acesso à identidade.
- `tests/theme.unit.test.ts` (3).
- Navegador (local): menu e cor do tema de Guarujá; busca "pereque" acha só a matéria de Guarujá (e em Santos, só a de Santos); editoria, bairro e canonical; bairro de Santos dá 404 em Guarujá; sitemap com seções; gerente recusado com cor clara e aplicando nova cor e slogan; admin cria região, cidade e portal Bertioga, que só responde depois de ativado; editora define editoria e bairro de um rascunho.

## Pendências

- Portal na raiz do domínio (`/`) em vez de `/portal`: depende de separar o host do painel (ex.: `painel.portal24h.news`) no middleware, decisão de deploy.
- Logotipo em imagem e favicon por portal.
- Matérias reais no banco local dependem de feeds externos (bloqueados no sandbox); a homologação usou matérias sintéticas marcadas "fixture local".
