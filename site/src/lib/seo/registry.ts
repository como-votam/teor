import { data, tracks, slug, modelName, type Result } from '../../data';
import { urls, indexable } from './config';
export interface Page {
  path: string;
  title: string;
  name: string;
  description: string;
  kind: 'WebPage' | 'CollectionPage' | 'AboutPage';
  index: boolean;
  doc?: string;
  article?: boolean;
  model?: string;
  track?: string;
  parent?: string;
}
const page = (
  path: string,
  title: string,
  description: string,
  options: Partial<Page> = {},
): Page => ({
  path,
  title,
  name: title.split(' | ')[0],
  description,
  kind: 'WebPage',
  index: indexable,
  ...options,
});
export const staticPages: Page[] = [
  page(
    '',
    'Teor | Benchmark de IA para o Legislativo brasileiro',
    'Benchmark aberto do Como Votam para avaliar IA sobre Câmara e Senado. Compare resultados por tarefa, fontes, cobertura e intervalos de confiança.',
    { kind: 'CollectionPage' },
  ),
  page(
    'modelos/',
    'Modelos e baselines com resultados publicados | Teor',
    'Consulte as referências e os modelos com avaliações publicadas no Teor. Abra cada perfil para comparar tarefas, condições e métricas.',
    { kind: 'CollectionPage' },
  ),
  page(
    'explorador/',
    'Explorar perguntas e fontes oficiais | Teor',
    'Consulte perguntas do benchmark legislativo, contexto, gabaritos públicos e fontes oficiais. Filtre itens por trilha no explorador do Teor.',
    { kind: 'CollectionPage' },
  ),
  page(
    'quiz/',
    'Quiz do Legislativo: teste suas respostas | Teor',
    'Responda às perguntas públicas do Teor e confira gabaritos e fontes. A pontuação fica na página, sem guardar suas respostas.',
  ),
  page(
    'analises/',
    'Análises de resultados e limites do benchmark | Teor',
    'Entenda cobertura, incerteza e limites das avaliações de IA do Teor. Consulte a interpretação das métricas e os notebooks reprodutíveis.',
    { kind: 'CollectionPage' },
  ),
  page(
    'analises/interpretacao/',
    'Como interpretar notas de um benchmark de IA | Teor',
    'Entenda por que tarefa, contexto, intervalo de confiança, corte temporal e revisão humana mudam a leitura de uma avaliação de IA.',
    { article: true, parent: 'analises/', doc: 'interpretacao' },
  ),
  page(
    'rodadas/',
    'Rodadas de avaliação e divulgação de gabaritos | Teor',
    'Acompanhe as rodadas do Teor: lotes congelados, prazos de submissão e publicação de gabaritos após o fechamento.',
    { kind: 'CollectionPage' },
  ),
  page(
    'metodologia/',
    'Metodologia do benchmark legislativo de IA | Teor',
    'Leia as oito trilhas, modos, divisões, métricas, bootstrap por família, cortes temporais e critérios de verificação do benchmark Teor.',
    { doc: 'metodologia', article: true },
  ),
  page(
    'dados/',
    'Dataset legislativo: fontes, cobertura e reuso | Teor',
    'Conheça as fontes oficiais, o formato dos itens, os limites de cobertura e as condições de reuso dos dados legislativos do Teor.',
    { doc: 'dataset-card' },
  ),
  page(
    'contribuir/',
    'Como submeter avaliações e contribuir | Teor',
    'Saiba como executar o protocolo, validar submissões e contribuir com gabaritos, fontes e avaliações reproduzíveis no Teor.',
    { doc: 'contribuir' },
  ),
  page(
    'revisar/',
    'Revisão humana de perguntas e evidências | Teor',
    'Revise contexto, gabaritos e fidelidade das afirmações do Teor. Conheça a revisão independente, evidências e adjudicação.',
    { doc: 'revisar' },
  ),
  page(
    'erratas/',
    'Erratas e correções versionadas do benchmark | Teor',
    'Consulte a política de erratas do Teor: correções com fonte, versão e hash, sem sobrescrever snapshots ou resultados anteriores.',
    { doc: 'erratas' },
  ),
  page(
    'sobre/',
    'Sobre o Teor e o Como Votam | Teor',
    'Conheça o benchmark aberto do Como Votam, sua manutenção, código, fontes oficiais e critérios de transparência na avaliação de IA.',
    { kind: 'AboutPage' },
  ),
  page(
    'como-citar/',
    'Como citar o benchmark e seus resultados | Teor',
    'Cite o Teor com modelo, execução, tarefa, hashes do conjunto e protocolo. Baixe a referência do software e as métricas publicadas.',
  ),
  page(
    'trilhas/',
    'Oito trilhas de avaliação de IA legislativa | Teor',
    'Explore as trilhas do Teor: texto, regras, votações, tramitação, previsão, citações, ferramentas e cenários contrafactuais.',
    { kind: 'CollectionPage' },
  ),
];
export const modelPages = [...new Set(data.results.map((r) => r.model))]
  .sort()
  .map((model) =>
    page(
      `modelos/${slug(model)}/`,
      `${modelName(model)}: resultados por tarefa | Teor`,
      `Consulte resultados de ${modelName(model)} no Teor, com tarefas, intervalos de confiança, cobertura, hashes e parâmetros de cada execução.`,
      { kind: 'CollectionPage', model, parent: 'modelos/' },
    ),
  );
export const trackPages = tracks.map(([id, name, description]) =>
  page(
    `trilhas/${id.toLowerCase()}/`,
    `${name}: trilha ${id} do benchmark de IA | Teor`,
    `Entenda a trilha ${id} do Teor. ${description} Consulte a pergunta de avaliação, as métricas e os limites de interpretação.`,
    { track: id, article: true, parent: 'trilhas/' },
  ),
);
export const pages = [...staticPages, ...trackPages, ...modelPages];
export function findPage(pathname: string) {
  const relative = urls.relative(pathname);
  return pages.find((p) => p.path === relative);
}
export function markdownPath(p: Page) {
  return `agent-markdown/${p.path ? p.path.replace(/\/$/, '') : 'index'}.md`;
}
export function resultPath(r: Pick<Result, 'id'>) {
  return `resultados/${slug(r.id)}.json`;
}
export function publicResult(r: Result) {
  return {
    id: r.id,
    model: r.model,
    dataset_hash: r.dataset_hash,
    protocol_hash: r.protocol_hash,
    verification: r.verification,
    complete: r.complete,
    created_at: r.created_at,
    metrics: r.metrics,
    usage: r.usage,
  };
}
export const overview = {
  summary: `O Teor é um benchmark aberto do Como Votam para avaliar modelos de linguagem sobre o processo legislativo brasileiro. O protocolo separa oito trilhas e duas casas legislativas; não produz uma nota global.`,
  facts: [
    { label: 'Trilhas de avaliação', value: tracks.length, unit: 'trilhas' },
    { label: 'Casas legislativas', value: 2, unit: 'casas' },
    {
      label: 'Baselines publicados',
      value: new Set(
        data.results.filter((r) => r.model.startsWith('baseline/')).map((r) => r.model),
      ).size,
      unit: 'baselines',
    },
    {
      label: 'Modelos de linguagem com resultados publicados',
      value: new Set(
        data.results.filter((r) => !r.model.startsWith('baseline/')).map((r) => r.model),
      ).size,
      unit: 'modelos',
    },
    { label: 'Itens nesta exportação pública', value: data.count, unit: 'itens' },
  ],
};
export function breadcrumbs(p: Page) {
  const parents = p.parent ? [pages.find((parent) => parent.path === p.parent)!] : [];
  return p.path ? [pages[0], ...parents, p] : [p];
}

export function imagePath(p: Page) {
  return `og/${p.path ? p.path.replace(/\/$/, '').replaceAll('/', '__') : 'teor'}.png`;
}
