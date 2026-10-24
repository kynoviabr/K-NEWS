# Ad Management & Revenue Center

> Estado em 2026-10-24, homologado só no Supabase local (Docker). Nada foi aplicado no projeto remoto.
> Migration: `supabase/migrations/20261029000001_knews_ad_management.sql` · Decisão: ADR-014.

## Fluxo

1. **Anunciante** (`/anunciantes`): cadastrado no portal ativo.
2. **Contrato**: vigência, valor, comissão de parceiro. Rascunho → assinado.
3. **Campanha** (`/ads`): nasce como rascunho. Tipo paga (exige contrato) ou da casa (fallback, produtos próprios).
4. **Posições, bairros e criativos** (`/ads/campanhas/<id>`): imagem enviada ao bucket privado `knews-creative/<campaign_id>/…` (PNG/JPEG/WebP/GIF, até 2 MB) ou anúncio de texto; destino só `https`. Criativo precisa ser aprovado; trocar o destino de um aprovado volta para revisão.
5. **Ativação**: o banco recusa sem contrato assinado do mesmo anunciante e portal, fora da vigência, sem posição ou sem criativo aprovado. Toda mudança de situação vai para `audit_logs`.
6. **Entrega**: `AdSlot` (servidor) chama `knews.serve_ad` a cada página. O HTML só leva um token; nada de banner gravado no artigo.
7. **Impressão** confirmada pelo beacon (50% visível por 1 s) em `/api/ads/impression`. **Clique** em `/api/ads/click/<token>` conta uma vez e redireciona (302, `noindex`).
8. **Encerramento**: pausa vale na próxima página. A rota do worker roda `expire_stale_reservations` (devolve inventário de reservas abandonadas) e `close_finished_campaigns` (vencidas ou cap entregue).

## Regras do motor (`knews.serve_ad`)

- Elegível: ativa, dentro da janela, slot contratado, portal da campanha (ou rede), cap total, orçamento CPM/CPC, dispositivo, editoria, bairro/cidade/portal, frequência por visitante/dia, cap diário, pacing uniforme, criativo aprovado.
- Ordem: prioridade do placement, prioridade da campanha, menor entrega do dia (rodízio), aleatório. Criativos por peso.
- Preenchimento: paga → provedor programático **aprovado e ligado** → campanha da casa → nada.
- Concorrência: trava a linha da campanha e rechecagem do cap. Teste: 40 decisões simultâneas com cap 10 entregam exatamente 10.
- CPM/CPC: gasto calculado sobre impressões/cliques **confirmados**; esgotado o orçamento, a entrega para.

## Links afiliados e produtos próprios (`/produtos`)

`/r/<código>` resolve pelo portal do domínio, conta o clique e redireciona. `rel` sempre contém `sponsored`; aviso de divulgação obrigatório. Trocar o destino no painel vale para todas as matérias. **Clique não é venda**: receita afiliada só entra por lançamento.

## Receitas e comissões (`/comercial`)

Lançamentos estimados/confirmados/pagos por origem (direta, AdSense, MGID, afiliados, produtos próprios). Venda direta exige contrato. Comissão = receita confirmada/paga × % do contrato com parceiro. Relatório de entrega por campanha (servidas, impressões, cliques, CTR) e cliques em links.

## Privacidade (LGPD)

Banner de consentimento no portal. Sem aceite: sem identificador de visitante, sem limite de frequência por pessoa, sem scripts de AdSense/MGID; anúncios diretos continuam. Com aceite: cookie `kn_vid` aleatório, gravado só como SHA-256 com `KNEWS_VISITOR_SALT`.

## Permissões

- Área comercial: `super_admin`, `regional_manager`, `commercial_partner` do portal (`knews.can_sell_portal`). A redação (`regional_editor`) não cria nem aprova anúncios.
- Contadores de entrega e cliques não são editáveis pelo painel (privilégio por coluna).
- Provedores programáticos: só `super_admin` liga, e só com `approved_at`.
- `serve_ad`, `record_ad_impression`, `record_ad_click`, `record_link_click`: só `service_role`.

## AdSense e MGID

Slots `portal-topo`/`artigo-topo` (AdSense) e `portal-meio`/`artigo-rodape` (MGID) como reserva. Configurar em `knews.portal_ad_providers` (publisher, `slot_map`, linha do `ads.txt`) **depois** da aprovação do provedor. `/ads.txt` é gerado por domínio. O formato do bloco MGID segue o padrão público do widget e deve ser conferido na aprovação.

## Testes executados

- `tests/integration/ad-serving.int.test.ts` (20) e `ad-reserve.int.test.ts` (2) no Postgres local.
- `tests/ads-revenue.unit.test.ts` (9).
- Navegador (Playwright, local): comercial cadastra anunciante e contrato, cria campanha, envia imagem, aprova, tentativas de ativação recusadas pelo banco, ativa; visitante mobile vê o anúncio em Guarujá e no artigo do Perequê, não vê em Santos; clique redireciona; pausa tira do ar; link afiliado redireciona só no portal dono; receita lançada; editora é barrada na área comercial; `ads.txt` por domínio; bloco AdSense só com consentimento.

## Pendências

- Contas AdSense/MGID aprovadas (dependem do provedor e de domínio público).
- Cadastro de parceiros pelo painel (hoje só `super_admin` via banco) para comissões.
- Exportação CSV de relatórios e fatura.
- Rate limit em memória por instância: em produção, considerar limite no edge da Vercel.
