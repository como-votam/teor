# Metodologia

O Teor avalia respostas verificáveis sobre Câmara e Senado. Cada execução identifica o snapshot, os itens, o modelo e os parâmetros. Alterar qualquer um deles produz outro experimento.

## Trilhas

| Trilha | Tarefa | Métrica |
|---|---|---|
| A | Tipo, autoria e referências textuais | Exact match e F1 de conjunto |
| B | Regras com fonte e vigência | Exact match |
| C | Contagens e resultado oficial | Exact match inteiro ou textual |
| D | Órgãos e sequência do histórico fornecido | Exact match e F1 |
| E | Aprovação e voto individual sim | Acurácia, Brier e ganho elegível |
| F | Resumo com afirmações e trechos | Validade de citação; fidelidade humana |
| G | Resposta com consultas ao snapshot | Exact match, chamadas e consumo |
| H | Cenários contrafactuais pareados | Diferença de desempenho e IC |

Pertinência temática é experimental. Referenciar uma lei não prova que a proposição a altera. O resultado de uma votação vem do registro oficial, não de uma regra genérica aplicada ao placar.

## Modos e divisões

Com contexto mede compreensão dos dados fornecidos. Closed-book apresenta a pergunta e o identificador sem os dados. É uma sonda de conhecimento e possível contaminação; não tem nota comparável ao modo com contexto. Ferramentas usam apenas a API congelada.

Proposições ligadas à mesma votação ficam na mesma família. A família é atribuída inteira a dev, test-public ou test-private. Variantes e pares não são divididos. Test-lite é um subconjunto público; não é um teste independente. Os limites de tamanho são tetos, não metas preenchidas artificialmente.

Os templates produzem três prompts. O build ordena os registros, fixa a seed e grava hashes de conteúdo. Canary identifica arquivos do benchmark sem alterar documentos oficiais.

## Correção

Respostas usam JSON com `value` e `abstain`. Texto passa por NFKC, casefold e normalização de espaços. Não removemos acentos, pontuação ou palavras arbitrariamente. Inteiros são exatos; conjuntos usam F1. Sequências exigem ordem e repetições corretas. Resposta inválida ou erro do modelo recebe zero. Erro de infraestrutura não vira erro factual: é excluído da nota, e a execução fica incompleta.

Itens sem resposta são construídos retirando informação necessária do contexto, não supondo que a fonte pública inteira seja desconhecida. A abstenção correta conta; nas respondíveis ela recebe zero.

Bootstrap de 95% usa 2.000 reamostragens por família factual. Variantes e votos da mesma votação permanecem juntos. Reportamos médias por tarefa, casa, modo e divisão, além da variância entre prompts. Não há nota global.

## Previsão

Aprovação e voto individual são duas tarefas. A probabilidade deve estar entre zero e um. Brier mede qualidade probabilística, e acurácia usa corte 0,5.

Ganhos de Brier usam probabilidade 0,5 como baseline sem informação e prevalência estimada somente em dev, separada por casa e tarefa. A orientação permanece indisponível sem comprovação temporal. Votações secretas podem fornecer placares oficiais, mas a presença de um parlamentar não comprova seu voto; não geramos alvos individuais a partir dela.

Um snapshot obtido depois da votação não demonstra disponibilidade anterior dos campos. Os geradores atuais classificam esses exemplos como retrospectivos e retiram placar, orientações e metadados sem evidência histórica. Orientação só pode virar baseline quando tiver disponibilidade comprovada anterior ao corte. Campo ausente não é orientação zero.

## Fidelidade e paridade

Na F, a automação verifica que um trecho literal existe no documento referenciado. Isso não prova suporte semântico. Dois revisores independentes julgam cada afirmação; divergências exigem adjudicação. Não usamos LLM-juiz.

Na H, trocar o partido pertence a um cenário marcado como contrafactual. A pergunta e os votos necessários para a resposta não mudam. A diferença pareada não prova parcialidade causal do modelo e não deve ser descrita dessa forma.

## Resultados e neutralidade

Submissões externas são autodeclaradas. Verificação exige responsável e evidência de reprodução ou execução supervisionada. Resultados só são comparáveis dentro do mesmo hash de conjunto e protocolo.

O Como Votam usa LLMs no produto. O Teor não utiliza os prompts ou dados privados desse produto e não altera regras para beneficiar um modelo.
