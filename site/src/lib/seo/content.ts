export const faqs = [
  [
    'O Teor dá uma nota geral para cada modelo?',
    'Não. Compreender um texto, prever um voto e buscar uma fonte são tarefas diferentes. Cada uma tem sua própria métrica e seu próprio intervalo de confiança.',
  ],
  [
    'O que são os baselines publicados?',
    'São referências determinísticas: escolha aleatória, classe majoritária estimada no conjunto de desenvolvimento e busca por BM25. Eles ajudam a interpretar avaliações futuras, mas não são modelos de linguagem.',
  ],
  [
    'Posso comparar quaisquer dois resultados?',
    'Compare a mesma tarefa, casa, modo, divisão, qualidade temporal, conjunto e protocolo. Os filtros iniciais selecionam um recorte comparável; ao ampliá-lo, leia cada linha separadamente.',
  ],
  [
    'De onde vêm os gabaritos?',
    'De registros e documentos oficiais da Câmara dos Deputados e do Senado Federal. As evidências e os limites de uso são documentados na política de dados.',
  ],
  [
    'O quiz guarda minhas respostas?',
    'Não. As respostas e a pontuação ficam apenas na página aberta. A comparação com modelos exige que eles tenham respondido exatamente aos mesmos itens.',
  ],
  [
    'Como publico uma avaliação?',
    'Execute o protocolo, preserve as previsões e prepare um pacote de submissão reproduzível. A página de contribuição explica os arquivos e a verificação necessária.',
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
