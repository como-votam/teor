import { softwareVersion } from './citation';
import {
  data,
  tracks,
  modelName,
  slug,
  taskNames,
  modeNames,
  chamberNames,
  type Result,
} from '../../data';
import { ORGANIZATION_ID, REPOSITORY, SOURCES, urls } from './config';
import { breadcrumbs, modelPages, resultPath, overview, imagePath, type Page } from './registry';
import { faqs } from './content';
const ref = (id: string) => ({ '@id': id });
export const benchmarkId = urls.absolute('#benchmark');
export const datasetId = urls.absolute('dados/#dataset');
export const runId = (r: Result) =>
  urls.absolute(`modelos/${slug(r.model)}/#execucao-${encodeURIComponent(r.id)}`);
const date = (value: string) => (Number.isFinite(Date.parse(value)) ? value : undefined);
export function resultDataset(r: Result) {
  return {
    '@type': 'Dataset',
    '@id': runId(r),
    name: `Métricas de ${modelName(r.model)} — execução ${r.id}`,
    description: `Resultados da execução ${r.id} no benchmark Teor. As métricas são separadas por tarefa, casa, modo e divisão, com cobertura e incerteza. Verificação: ${r.verification}. Não há nota global.`,
    url: runId(r),
    identifier: [
      { '@type': 'PropertyValue', propertyID: 'run_id', value: r.id },
      { '@type': 'PropertyValue', propertyID: 'dataset_hash', value: r.dataset_hash },
      { '@type': 'PropertyValue', propertyID: 'protocol_hash', value: r.protocol_hash },
    ],
    inLanguage: 'pt-BR',
    dateCreated: date(r.created_at),
    publisher: ref(ORGANIZATION_ID),
    creator: ref(ORGANIZATION_ID),
    isAccessibleForFree: true,
    about: ref(benchmarkId),
    citation: urls.absolute('metodologia/'),
    isBasedOn: urls.absolute('dados/'),
    measurementTechnique:
      'Pontuação por tarefa segundo o protocolo do Teor. Intervalos de confiança por bootstrap de famílias factuais, sem agregação entre tarefas.',
    license: {
      '@type': 'CreativeWork',
      name: 'Condições de uso dos dados e resultados do Teor',
      url: urls.absolute('dados/'),
    },
    distribution: {
      '@type': 'DataDownload',
      name: `Métricas públicas da execução ${r.id}`,
      encodingFormat: 'application/json',
      contentUrl: urls.absolute(resultPath(r)),
    },
    variableMeasured: r.metrics.flatMap((m) => {
      const scope = [
        m.track,
        taskNames[m.task] || m.task,
        chamberNames[m.chamber || ''] || m.chamber,
        modeNames[m.mode || ''] || m.mode,
        m.split,
        m.temporal_quality,
      ]
        .filter(Boolean)
        .join(' · ');
      const values: Record<string, unknown>[] = [];
      if (m.score) {
        values.push(
          {
            '@type': 'PropertyValue',
            name: `Nota — ${scope}`,
            value: m.score.mean * 100,
            unitText: 'percentual',
          },
          {
            '@type': 'PropertyValue',
            name: `IC 95% inferior — ${scope}`,
            value: m.score.ci95[0] * 100,
            unitText: 'percentual',
          },
          {
            '@type': 'PropertyValue',
            name: `IC 95% superior — ${scope}`,
            value: m.score.ci95[1] * 100,
            unitText: 'percentual',
          },
        );
      }
      if (m.brier)
        values.push({ '@type': 'PropertyValue', name: `Brier — ${scope}`, value: m.brier.mean });
      if (m.citation_validity)
        values.push({
          '@type': 'PropertyValue',
          name: `Validade de citação — ${scope}`,
          value: m.citation_validity.mean * 100,
          unitText: 'percentual',
        });
      if (m.human_fidelity)
        values.push({
          '@type': 'PropertyValue',
          name: `Fidelidade humana — ${scope}`,
          value: m.human_fidelity.mean * 100,
          unitText: 'percentual',
        });
      if (m.mean !== undefined)
        values.push({
          '@type': 'PropertyValue',
          name: `Diferença pareada — ${scope}`,
          value: m.mean * 100,
          unitText: 'pontos percentuais',
        });
      return values;
    }),
  };
}
export function schemaGraph(p: Page) {
  const canonical = urls.absolute(p.path),
    pageId = `${canonical}#webpage`,
    websiteId = urls.absolute('#website');
  const graph: Record<string, unknown>[] = [
    {
      '@type': 'Organization',
      '@id': ORGANIZATION_ID,
      name: 'Como Votam',
      url: 'https://comovotam.com.br/',
      logo: { '@type': 'ImageObject', url: urls.absolute('brand.svg') },
      publishingPrinciples: urls.absolute('metodologia/'),
      correctionsPolicy: urls.absolute('erratas/'),
      actionableFeedbackPolicy: `${REPOSITORY}/issues/new/choose`,
    },
    {
      '@type': 'WebSite',
      '@id': websiteId,
      name: 'Teor',
      alternateName: 'Teor — benchmark legislativo do Como Votam',
      url: urls.absolute(),
      description: overview.summary,
      inLanguage: 'pt-BR',
      publisher: ref(ORGANIZATION_ID),
      about: ref(benchmarkId),
    },
    {
      '@type': 'SoftwareSourceCode',
      '@id': benchmarkId,
      name: 'Teor',
      description: overview.summary,
      codeRepository: REPOSITORY,
      version: softwareVersion,
      url: urls.absolute('sobre/'),
      programmingLanguage: ['Python', 'TypeScript'],
      license: 'https://www.apache.org/licenses/LICENSE-2.0',
      author: ref(ORGANIZATION_ID),
      publisher: ref(ORGANIZATION_ID),
      keywords: [
        'benchmark de IA',
        'modelos de linguagem',
        'processo legislativo brasileiro',
        'Câmara dos Deputados',
        'Senado Federal',
      ],
    },
    {
      '@type': p.kind,
      '@id': pageId,
      name: p.name,
      description: p.description,
      url: canonical,
      inLanguage: 'pt-BR',
      isPartOf: ref(websiteId),
      publisher: ref(ORGANIZATION_ID),
      about: ref(benchmarkId),
      ...(p.path ? { breadcrumb: ref(`${canonical}#breadcrumb`) } : {}),
      primaryImageOfPage: {
        '@type': 'ImageObject',
        url: urls.absolute(imagePath(p)),
        width: 1200,
        height: 630,
      },
    },
    ...(p.path
      ? [
          {
            '@type': 'BreadcrumbList',
            '@id': `${canonical}#breadcrumb`,
            itemListElement: breadcrumbs(p).map((item, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              name: item.name,
              item: urls.absolute(item.path),
            })),
          },
        ]
      : []),
  ];
  if (p.article) {
    graph.push({
      '@type': 'Article',
      '@id': `${canonical}#article`,
      headline: p.name,
      description: p.description,
      inLanguage: 'pt-BR',
      url: canonical,
      image: urls.absolute(imagePath(p)),
      author: ref(ORGANIZATION_ID),
      publisher: ref(ORGANIZATION_ID),
      mainEntityOfPage: ref(pageId),
      isBasedOn: urls.absolute('metodologia/'),
    });
    graph[3].mainEntity = ref(`${canonical}#article`);
  }
  if (p.path === '' || p.path === 'sobre/') {
    graph.push({
      '@type': 'Dataset',
      '@id': urls.absolute('#estado-publicacao'),
      name: 'Teor — estado dos artefatos públicos nesta publicação',
      description:
        overview.summary +
        ' Os totais se referem apenas aos artefatos disponíveis nesta publicação, não a toda a atividade legislativa.',
      url: urls.absolute(),
      inLanguage: 'pt-BR',
      creator: ref(ORGANIZATION_ID),
      publisher: ref(ORGANIZATION_ID),
      isBasedOn: urls.absolute('dados/'),
      measurementTechnique:
        'Contagem de trilhas do protocolo e dos modelos, baselines e itens presentes nos artefatos públicos do site.',
      license: {
        '@type': 'CreativeWork',
        name: 'Condições de reuso dos dados do Teor',
        url: urls.absolute('dados/'),
      },
      variableMeasured: overview.facts.map((f) => ({
        '@type': 'PropertyValue',
        name: f.label,
        value: f.value,
        unitText: f.unit,
      })),
    });
  }
  if (p.path === '') {
    graph.push({
      '@type': 'FAQPage',
      '@id': urls.absolute('#perguntas'),
      url: urls.absolute('#perguntas'),
      isPartOf: ref(pageId),
      mainEntity: faqs.map(([question, answer]) => ({
        '@type': 'Question',
        name: question,
        acceptedAnswer: { '@type': 'Answer', text: answer },
      })),
    });
  }
  if (p.path === '' || p.path === 'modelos/') {
    graph.push({
      '@type': 'ItemList',
      '@id': `${canonical}#modelos`,
      name: 'Referências e modelos com resultados publicados',
      itemListElement: modelPages.map((model, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: modelName(model.model!),
        url: urls.absolute(model.path),
      })),
    });
  }
  if (p.path === 'trilhas/') {
    graph.push({
      '@type': 'ItemList',
      '@id': `${canonical}#trilhas`,
      name: 'Trilhas do Teor',
      itemListElement: tracks.map(([id, name], i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: `${id} · ${name}`,
        url: urls.absolute(`trilhas/${id.toLowerCase()}/`),
      })),
    });
  }
  if (p.model) {
    const results = data.results.filter((r) => r.model === p.model);
    graph.push(...results.map(resultDataset));
    graph[3].mainEntity = results.map((r) => ref(runId(r)));
  }
  if (p.path === 'dados/' && data.count > 0 && data.dataset_hash) {
    graph.push({
      '@type': 'Dataset',
      '@id': datasetId,
      name: `Teor — itens da exportação pública ${data.dataset_hash.slice(0, 12)}`,
      description:
        'Itens públicos em português do benchmark Teor, derivados de registros oficiais da Câmara e do Senado. Cada item inclui contexto, gabarito e evidência. A exportação não representa toda a atividade legislativa.',
      url: canonical,
      identifier: data.dataset_hash,
      creator: ref(ORGANIZATION_ID),
      publisher: ref(ORGANIZATION_ID),
      inLanguage: 'pt-BR',
      isAccessibleForFree: true,
      isBasedOn: SOURCES.map((s) => s.url),
      spatialCoverage: { '@type': 'Place', name: 'Brasil' },
      license: {
        '@type': 'CreativeWork',
        name: 'Termos das fontes e condições de reuso; licença derivada ainda condicionada à confirmação',
        url: canonical,
      },
      variableMeasured: [
        {
          '@type': 'PropertyValue',
          name: 'Itens na exportação pública',
          value: data.count,
          unitText: 'itens',
        },
      ],
      distribution: data.partitions.map((partition) => ({
        '@type': 'DataDownload',
        encodingFormat: 'application/vnd.apache.parquet',
        contentUrl: urls.absolute(partition.url.replace(/^\//, '')),
      })),
    });
    graph[3].mainEntity = ref(datasetId);
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}
