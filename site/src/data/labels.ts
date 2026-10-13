export const taskNames: Record<string, string> = {
  type: 'Tipo de proposição',
  authors: 'Autoria',
  references: 'Referências normativas',
  unknown_author: 'Informação insuficiente',
  thematic_relevance: 'Pertinência temática (experimental)',
  rule: 'Regra legislativa',
  threshold: 'Aplicação de quórum',
  sequence: 'Sequência de órgãos',
  last_body: 'Último órgão',
  bodies: 'Órgãos do histórico',
  body_changes: 'Mudanças de órgão',
  yes_count: 'Contagem de votos sim',
  party_yes: 'Votos sim por partido',
  vote_distribution: 'Distribuição de votos',
  official_tally: 'Placar oficial',
  result: 'Resultado oficial',
  approval: 'Probabilidade de aprovação',
  individual_yes: 'Probabilidade de voto sim',
  claims: 'Afirmações e citações',
  counterfactual_count: 'Contagem contrafactual',
  paired_gap: 'Diferença pareada',
};
export const modeNames: Record<string, string> = {
  with_context: 'Com contexto',
  closed_book: 'Sem contexto',
  tools: 'Com ferramentas',
};
export const chamberNames: Record<string, string> = { camara: 'Câmara', senado: 'Senado' };

const baselineNames: Record<string, string> = {
  'baseline/bm25': 'BM25',
  'baseline/majority': 'Classe majoritária',
  'baseline/random': 'Aleatório',
};
export const modelName = (value: string) => baselineNames[value] || value;
