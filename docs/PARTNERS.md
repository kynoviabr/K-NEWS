# Parceiros regionais (P6)

> Estado em 2026-10-24, homologado só no Supabase local. Migration `20261101000001_knews_regional_partners.sql`. Decisão em ADR-016.

## Modelo

| Peça | Regra |
|---|---|
| Parceiro (`partners`) | Cadastro pela rede (`super_admin`). Ativo, suspenso ou encerrado |
| Território (`partner_territories`) | Uma cidade ou uma região inteira, com % de comissão. Exclusivo: cidade e a região que a contém não têm parceiros diferentes ativos. Encerrado não reabre |
| Pessoas (`partner_users`) | Conta própria de cada pessoa do parceiro, vinculada pela rede por e-mail (`add_partner_user`). Uma pessoa representa um parceiro só e não pode ter função interna no K-NEWS |
| Acesso | Gatilhos criam e removem vínculos `commercial_partner` (com `partner_id`) nos portais das cidades do território. Suspender o parceiro, encerrar o território ou remover a pessoa corta o acesso na mesma transação. Portal novo numa cidade do território entra sozinho |
| Contrato | Parceiro e comissão vêm do território do portal (`guard_contract_partner`). Só `super_admin` negocia outra comissão ou troca o parceiro |
| Receita | Só a gestão do portal (`regional_manager`) ou a rede confirma receita (`guard_revenue_confirmation`): quem ganha comissão não confirma a própria base |
| Comissão (`partner_commissions`) | Livro-razão gerado pela receita confirmada de contrato com parceiro (snapshot de base e %). Pendente → aprovada → paga (com comprovante), só pela rede (`set_commission_status`, com auditoria). Receita alterada depois de aprovada ou paga marca "revisar" em vez de mudar o valor |
| Indicadores | `partner_indicators(parceiro, de, até)`: por portal do território, contratos assinados, valor contratado, receita confirmada e estimada da carteira, campanhas no ar, impressões e CTR; comissões a aprovar, a pagar e pagas. Só a rede e o próprio parceiro |

Comercial (equipe ou parceiro) deixa de ler pauta da redação: só matéria publicada; fontes, itens coletados, decisões editoriais e afirmações ficam com a redação.

## Painel

- `/parceiros` (rede): cadastro, suspensão, territórios, pessoas, indicadores, aprovação e pagamento de comissões.
- `/parceiros` (parceiro): a própria carteira, territórios, indicadores e comissões, sem ações da rede.
- `/anunciantes` e `/comercial`: parceiro vende só nos portais do território; o campo de comissão aparece só para a rede; "Confirmar" receita só para a gestão. `/comercial` passa a mostrar o livro de comissões.

## Testes executados

- `tests/integration/partners.int.test.ts` (8): exclusividade de território; acesso pelo território (suspender, reativar, portal novo, encerrar); venda só no território e sem leitura de pauta; vínculo de pessoas só pela rede e nunca para quem tem função interna; comissão herdada do território e protegida; receita confirmada só pela gestão e comissão no livro; aprovação e pagamento só pela rede, com comprovante e auditoria; mudança depois do pagamento pede revisão; comissões e indicadores isolados por parceiro.
- Navegador local: rede cadastra parceiro, atribui Guarujá com 12% e vincula a pessoa (editora recusada); parceiro cadastra anunciante e contrato (comissão 12% herdada, sem campo para editar), lança receita só como estimada, não vê rascunho da redação; gerente confirma e a comissão de R$ 180,00 aparece; rede aprova e paga com comprovante; indicadores mostram contrato, valor e receita; encerrar o território deixa o parceiro sem portal.

## Fora do escopo

- Pagamento real de comissões (só registro do comprovante) e emissão de nota.
- Convite de pessoas por e-mail: a conta precisa existir no Auth antes do vínculo.
