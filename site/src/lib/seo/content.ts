export const faqs = [
  [
    'Por que não existe uma nota geral?',
    'Porque ela misturaria resultados que não se compensam. Um modelo pode acertar quase todas as siglas de proposição com o texto no prompt e nenhuma sem ele. A média dessas duas fatias não descreve nenhum uso real. Cada tarefa, casa e modo tem a sua nota e o seu intervalo de confiança.',
  ],
  [
    'O que são as referências?',
    'Três respondedores sem modelo de linguagem: escolha aleatória, a classe mais frequente no conjunto de desenvolvimento e recuperação por BM25. Elas formam o piso. Uma nota de modelo só diz algo quando o intervalo inteiro fica acima da melhor referência daquela fatia.',
  ],
  [
    'Por que alguns intervalos são enormes ou viram um ponto?',
    'O bootstrap reamostra famílias, não perguntas: variantes do mesmo fato e votos da mesma votação ficam juntos. Uma fatia com uma única família tem intervalo sem informação. O site marca essas células para que ninguém leia precisão onde ela não existe.',
  ],
  [
    'Qual a diferença entre com contexto e sem contexto?',
    'Com contexto, o registro oficial vai no prompt e medimos leitura. Sem contexto, vai só o identificador do registro, o que funciona como sonda de memória e de possível contaminação. Os dois modos não se comparam entre si.',
  ],
  [
    'De onde vêm os gabaritos?',
    'Das APIs de dados abertos da Câmara dos Deputados e do Senado Federal e do texto da Constituição. Cada item aponta o registro que o sustenta. Correções entram na página de erratas com versão e hash, sem reescrever resultados anteriores.',
  ],
  [
    'Posso treinar um modelo com estes itens?',
    'Não. Os arquivos carregam a string canária TEOR-BENCHMARK-NOT-FOR-TRAINING-2026 para que contaminação possa ser detectada. Leitura, pesquisa e citação seguem as condições da política de dados.',
  ],
  [
    'Como avalio o meu modelo?',
    'Clone o repositório, instale com uv e rode teor run sobre o split público. O comando checa o formato das respostas antes do run completo. Depois, teor score gera o JSON de métricas que acompanha o pull request.',
  ],
  [
    'Um resultado publicado aqui foi verificado?',
    'Só quando o selo diz isso. Submissões externas ficam como autodeclaradas até que o mantenedor reproduza a execução ou a supervisione.',
  ],
  [
    'O desafio guarda minhas respostas?',
    'Não. As respostas ficam na página aberta e somem ao recarregar. Nada vai para servidor nem para o armazenamento do navegador.',
  ],
];

export const limits = [
  'Notas de tarefas diferentes não formam uma nota global.',
  'Compare tarefa, casa, modo, divisão, qualidade temporal, hash do conjunto e hash do protocolo iguais.',
  'Baselines determinísticos não são avaliações de modelos de linguagem.',
  'Um intervalo de confiança descreve incerteza no recorte avaliado; não garante desempenho fora dele.',
  'Previsões retrospectivas não demonstram previsão prospectiva.',
  'Citação localizada automaticamente não comprova fidelidade semântica; a trilha F exige revisão humana.',
  'Resultados autodeclarados não equivalem a resultados verificados.',
  'A licença Apache 2.0 cobre o código. Os termos dos dados e da marca são separados.',
];

export const trackDetails: Record<
  string,
  { question: string; method: string; limitation: string }
> = {
  A: {
    question:
      'O modelo reconhece o tipo de proposição, sua autoria e referências explícitas no texto?',
    method:
      'Exact match para respostas textuais e F1 para conjuntos. A ausência de informação também é avaliada em tarefas específicas.',
    limitation:
      'Uma referência a uma lei não prova que a proposição a altera. Pertinência temática é experimental e fica fora das métricas principais.',
  },
  B: {
    question: 'O modelo aplica a regra legislativa e o quórum corretos ao caso apresentado?',
    method:
      'Exact match com gabarito apoiado em fonte e vigência documentadas. A regra e o contexto precisam corresponder ao caso.',
    limitation:
      'Regras variam conforme procedimento, casa e vigência. Uma resposta plausível sem a regra aplicável não sustenta o gabarito.',
  },
  C: {
    question: 'O modelo conta votos e identifica o resultado do registro oficial?',
    method:
      'Exact match inteiro ou textual para contagens, distribuição, placar e resultado oficial.',
    limitation:
      'Nem toda votação publica votos individuais. Votações secretas podem fornecer placar sem permitir atribuir voto a um parlamentar.',
  },
  D: {
    question: 'O modelo reconstrói órgãos, sequências e mudanças no histórico fornecido?',
    method:
      'Exact match para sequências e F1 para conjuntos de órgãos. Ordem e repetições são preservadas quando a tarefa exige uma sequência.',
    limitation:
      'O histórico disponível delimita a resposta. A última etapa publicada não permite supor etapas futuras ou registros ausentes.',
  },
  E: {
    question: 'O modelo estima a probabilidade de aprovação ou de voto individual sim?',
    method:
      'Probabilidades entre zero e um, Brier, acurácia com corte 0,5 e ganhos elegíveis contra referências documentadas.',
    limitation:
      'Os exemplos retrospectivos são identificados como tais. Um snapshot coletado depois do evento não comprova a disponibilidade anterior dos campos.',
  },
  F: {
    question: 'A afirmação tem uma citação e essa citação sustenta seu significado?',
    method:
      'Verificação automática de trecho literal, seguida de fidelidade humana por dois revisores independentes. Divergências exigem adjudicação.',
    limitation:
      'Localizar um trecho não demonstra suporte semântico. Sem revisão humana, a fidelidade semântica permanece sem nota.',
  },
  G: {
    question: 'O modelo consulta a API congelada e usa os dados retornados para responder?',
    method:
      'Exact match, número de chamadas e consumo. O ambiente de ferramentas e o snapshot são fixados pelo experimento.',
    limitation:
      'Consultar uma API atual mudaria o experimento e poderia trazer informação posterior ao corte. Compare execuções no mesmo ambiente.',
  },
  H: {
    question: 'A resposta muda entre cenários contrafactuais pareados?',
    method:
      'Diferenças de desempenho e intervalos de confiança para pares que mantêm a pergunta e os votos necessários à resposta.',
    limitation:
      'A diferença pareada não demonstra parcialidade causal. Correções precisam preservar todos os membros do par e a invariância do gabarito.',
  },
};
