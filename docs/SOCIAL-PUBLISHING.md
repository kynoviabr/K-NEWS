# Distribuição social (P5)

> Estado em 2026-10-24, homologado só no Supabase local e contra uma Graph API falsa. Migration `20261031000001_knews_social_publishing.sql`. Decisão em ADR-015.

## Fluxo

1. **Gestão do portal** conecta a página do Facebook e a conta profissional do Instagram em `/social` (ID numérico + token de acesso da página). O servidor cifra o token (AES-256-GCM, chave `KNEWS_SOCIAL_TOKEN_KEY`) e grava por `knews.save_social_account`. O painel nunca mais lê o token (privilégio por coluna).
2. **Redação** agenda o post de uma matéria **publicada** do próprio portal: texto, redes, horário e imagem. O link é a URL canônica da matéria no domínio do portal. Instagram exige imagem https com direito de uso confirmado.
3. O worker (`/api/internal/jobs/run`) enfileira os posts vencidos (`enqueue_due_social_posts`) e envia: Facebook `POST /{page}/feed`; Instagram `POST /{ig}/media` + `POST /{ig}/media_publish`.
4. Métricas a cada 6 horas por 14 dias (`enqueue_due_social_metrics`): reações, comentários e compartilhamentos; no Instagram também alcance quando a permissão de insights existir.

## Regras garantidas pelo banco

| Regra | Onde |
|---|---|
| Um post por matéria e rede | `idempotency_key = article:<id>:<rede>` forçada em `guard_social_post`, única por portal |
| Só matéria publicada do mesmo portal; conta ativa do portal | `guard_social_post` |
| Pessoas só agendam, editam enquanto agendado, cancelam e reagendam | `guard_social_post` + privilégio por coluna |
| Despublicar a matéria cancela o que estava agendado | `cancel_social_on_unpublish` |
| Envio no máximo uma vez | `begin_social_publish` trava a linha e marca `publishing`; reencontrar `publishing` vira `needs_check` |
| Limite diário por conta (padrão 25) | `begin_social_publish` adia 1 hora |
| Funções da fila só com `service_role` | grants |

## Erros da Graph API

| Resposta | Resultado |
|---|---|
| 5xx, `is_transient`, código 1/2, limite (4, 17, 32, 613, 429) | volta para `scheduled`, a fila repete com backoff; na última tentativa, `failed` |
| Token inválido/expirado (190, 102) | conta `expired`, post `failed` |
| Sem resposta num envio | `needs_check`: a equipe confere na rede e usa "Conferi, reenviar" |
| Outros (permissão, parâmetro) | `failed` com a mensagem, sem token |

Post publicado de matéria que saiu do ar aparece em alerta no painel: a API do Instagram não remove posts, então a retirada é manual.

## Configuração

- `KNEWS_SOCIAL_TOKEN_KEY`: 32 bytes em base64 (`openssl rand -base64 32`). Trocar a chave exige reconectar as contas.
- `KNEWS_SOCIAL_PUBLISHING=enabled`: sem isso o worker não enfileira nem envia; os posts ficam agendados.
- `META_GRAPH_BASE_URL`: opcional, padrão `https://graph.facebook.com/v24.0`. Confirmar a versão vigente antes de ativar.

## Testes executados

- `tests/integration/social-publishing.int.test.ts` (10), no Supabase local com Graph API falsa: token ilegível pelo painel e só gestor conecta; regras de agendamento; cancelamento ao despublicar; Facebook envia uma vez com token só no cabeçalho; Instagram repete reaproveitando o container; sem resposta e job interrompido não reenviam; token expirado; limite diário; métricas e resumo isolado por portal; envio desativado não chama a Meta.
- `tests/social.unit.test.ts` (4): cifra e AAD, classificação de erros, limpeza de token em mensagens, texto do Instagram.
- Navegador local (Graph API falsa): gestora conecta Facebook e Instagram (token curto recusado); editora não vê a conexão; Instagram sem imagem recusado; agendamento das duas redes; segundo agendamento recusado como duplicado; worker publica e coleta métricas; histórico e resumo mostram links e números; comercial não agenda.

## Bloqueios externos

- App da Meta com revisão aprovada (`pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`, opcional `instagram_manage_insights`) e token de página real. Sem isso não há teste com a Meta.
- Publicar post real depende de autorização explícita.
- Login OAuth da Meta no painel (em vez de colar token) depende do app aprovado.
