import { softwareVersion } from './citation';
import fs from 'node:fs';
import path from 'node:path';
import {
  data,
  tracks,
  taskNames,
  modeNames,
  chamberNames,
  modelName,
  type Result,
} from '../../data';
import { urls, REPOSITORY, SOURCES } from './config';
import { pages, overview, markdownPath, resultPath, type Page } from './registry';
import { faqs, limits, trackDetails } from './content';
import { schemaGraph } from './schema';
const link = (name: string, relative: string) => `[${name}](${urls.absolute(relative)})`;
const cell = (value: unknown) =>
  String(value ?? '—')
    .replaceAll('|', '\\|')
    .replace(/[\r\n]+/g, ' ');
export function metricMarkdown(r: Result) {
  const lines = r.metrics.map((m) =>
    [
      m.track,
      taskNames[m.task] || m.task,
      chamberNames[m.chamber || ''] || m.chamber,
      modeNames[m.mode || ''] || m.mode,
      m.split,
      m.temporal_quality,
      m.score
        ? `${(m.score.mean * 100).toFixed(1)}% (IC 95%: ${m.score.ci95.map((n) => (n * 100).toFixed(1)).join(' a ')}%)`
        : m.mean !== undefined
          ? `${m.first} − ${m.second}: ${(m.mean * 100).toFixed(1)} pp`
          : 'Métrica específica',
      m.brier
        ? `Brier: ${m.brier.mean}`
        : m.citation_validity
          ? `Validade de citação: ${m.citation_validity.mean}`
          : m.semantic_fidelity || '',
      m.human_fidelity ? `Fidelidade humana: ${m.human_fidelity.mean}` : '',
    ]
      .map(cell)
      .join(' | '),
  );
  return `## Execução ${r.id}\n\n- Modelo: ${r.model}\n- Data da execução: ${r.created_at}\n- Hash do conjunto: ${r.dataset_hash}\n- Hash do protocolo: ${r.protocol_hash}\n- Verificação: ${r.verification}\n- Execução completa: ${r.complete ? 'sim' : 'não'}\n- Cobertura: ${(r.usage.coverage * 100).toFixed(1)}%\n- Custo: ${r.usage.cost_usd === null ? 'não informado' : `US$ ${r.usage.cost_usd}`}\n- Latência média: ${r.usage.latency_mean_seconds === null ? 'não informada' : `${r.usage.latency_mean_seconds} segundos`}\n- ${link('Métricas públicas em JSON', resultPath(r))}\n\n| Trilha | Tarefa | Casa | Modo | Divisão | Qualidade temporal | Resultado | Métrica adicional | Revisão humana |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${lines.map((l) => `| ${l} |`).join('\n')}\n`;
}
export function pageBody(p: Page): string {
  if (p.doc) {
    const raw = fs.readFileSync(path.resolve('../docs', `${p.doc}.md`), 'utf8');
    return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  }
  if (p.model)
    return `# ${modelName(p.model)}: resultados no Teor\n\n${p.description}\n\n${p.model.startsWith('baseline/') ? 'Esta referência é um baseline determinístico, não um modelo de linguagem.' : ''}\n\n${data.results
      .filter((r) => r.model === p.model)
      .map(metricMarkdown)
      .join('\n')}\n## Limites de comparação\n\n${limits.map((l) => `- ${l}`).join('\n')}`;
  if (p.track) {
    const track = tracks.find((t) => t[0] === p.track)!;
    const d = trackDetails[p.track];
    return `# Trilha ${p.track}: ${track[1]}\n\n${track[2]}\n\n## Pergunta de avaliação\n\n${d.question}\n\n## Como é medida\n\n${d.method}\n\n## Limites de interpretação\n\n${d.limitation}\n\n${link('Protocolo completo', 'metodologia/')} · ${link('Explorar itens desta trilha', `explorador/?track=${p.track}`)}`;
  }
  switch (p.path) {
    case '':
      return `# Teor: benchmark de IA para o Legislativo brasileiro\n\n${overview.summary}\n\n## Situação desta publicação\n\n${overview.facts.map((f) => `- ${f.label}: ${f.value} ${f.unit}`).join('\n')}\n\n${data.count ? 'Os itens desta exportação são públicos.' : 'Não há conjunto de itens exportado nesta publicação. O total zero não significa que o projeto não tenha dados em outros artefatos.'}\n\n## Referências e modelos publicados\n\n${
        pages
          .filter((p) => p.model)
          .map((p) => `- ${link(modelName(p.model!), p.path)}`)
          .join('\n') || 'Nenhum resultado publicado.'
      }\n\n## Trilhas\n\n${tracks.map(([id, name, description]) => `- ${link(`${id} · ${name}`, `trilhas/${id.toLowerCase()}/`)}: ${description}`).join('\n')}\n\n## Limites de interpretação\n\n${limits.map((l) => `- ${l}`).join('\n')}\n\n## Perguntas frequentes\n\n${faqs.map(([q, a]) => `### ${q}\n\n${a}`).join('\n\n')}`;
    case 'analises/':
      return `# Análises do Teor\n\n${p.description}\n\n- ${link('Como interpretar uma nota', 'analises/interpretacao/')}\n- [Notebooks reprodutíveis](${REPOSITORY}/tree/main/analyses)`;
    case 'explorador/':
      return `# Explorar itens do Teor\n\n${p.description}\n\nItens na exportação pública: ${data.count}. Partições publicadas: ${data.partitions.length}.\n\nO explorador consulta Parquet no navegador. A busca considera apenas partições carregadas. As perguntas trazem contexto, gabarito e evidência.\n\n${data.partitions.map((partition, i) => `- ${link(`Partição ${i + 1}: ${partition.count} itens`, partition.url.replace(/^\//, ''))}`).join('\n') || 'Nenhuma partição pública foi exportada nesta publicação.'}\n\n${link('Política de dados e fontes', 'dados/')}`;
    case 'quiz/':
      return `# Teste suas respostas no quiz do Teor\n\n${p.description}\n\nPerguntas nesta exportação: ${data.quiz.length}.\n\n${data.quiz.length ? 'Responda com o contexto fornecido. O gabarito e a fonte aparecem depois de conferir a resposta.' : 'O quiz aguarda um conjunto público exportado.'}\n\nO quiz não guarda respostas no armazenamento do navegador. Comparações com modelos exigem os mesmos itens e a mesma execução. O resultado pessoal não é uma classificação geral de modelos.\n\n${link('Abrir o quiz', 'quiz/')}`;
    case 'rodadas/':
      return `# Rodadas do Teor\n\n${p.description}\n\nUma rodada congela os itens, recebe previsões até o fechamento e divulga o gabarito depois.\n\n${data.rounds.length ? data.rounds.map((r) => `## ${r.id}\n\n- Estado: ${r.state}\n- Abertura: ${r.opens_at}\n- Fechamento: ${r.closes_at}\n- Divulgação: ${r.published_at}`).join('\n\n') : 'Nenhuma rodada publicada nesta exportação.'}\n\n${link('Como contribuir', 'contribuir/')}`;
    case 'sobre/':
      return `# Sobre o Teor\n\n${overview.summary}\n\nO Como Votam mantém o projeto. Adriano Coelho é o mantenedor identificado no README público. Não há validação institucional ou parceria acadêmica presumida.\n\nO Como Votam utiliza LLMs no produto; isso não altera o protocolo do Teor. O benchmark não utiliza prompts ou dados privados do produto.\n\n## Código e licenças\n\n[Código público](${REPOSITORY}). Código sob Apache 2.0. Os termos dos itens derivados e da marca são separados; a licença proposta para os dados depende de confirmação das fontes.\n\n## Fontes\n\n${SOURCES.map((s) => `- [${s.name}](${s.url})`).join('\n')}\n\n${link('Metodologia', 'metodologia/')} · ${link('Erratas', 'erratas/')} · ${link('Como citar', 'como-citar/')}`;
    case 'como-citar/':
      return `# Como citar o Teor\n\nCite o software separadamente dos resultados. A versão do software não substitui os hashes do conjunto e do protocolo usados no experimento.\n\n## Software\n\nComo Votam. Teor: benchmark aberto do processo legislativo brasileiro. Versão ${softwareVersion}. ${urls.absolute()}\n\n${link('Referência em CFF', 'CITATION.cff')} · ${link('Referência em BibTeX', 'citation.bib')}\n\n## Uma avaliação\n\nInforme modelo, identificação e data da execução, tarefa, casa, modo, divisão, qualidade temporal, hashes completos de conjunto e protocolo, nota e intervalo de confiança, cobertura e verificação. Não chame um baseline de LLM nem uma submissão autodeclarada de verificada.\n\n${pages
        .filter((p) => p.model)
        .map((p) => `- ${link(`Resultados de ${modelName(p.model!)}`, p.path)}`)
        .join(
          '\n',
        )}\n\n## Fontes primárias\n\n${SOURCES.map((s) => `- [${s.name}](${s.url})`).join('\n')}\n\n${link('Condições de reuso', 'dados/')} · ${link('Correções e versões', 'erratas/')}`;
    case 'trilhas/':
      return `# Oito trilhas de avaliação do Teor\n\n${overview.summary}\n\n${tracks.map(([id, name, description]) => `## ${link(`${id} · ${name}`, `trilhas/${id.toLowerCase()}/`)}\n\n${description}\n\n${trackDetails[id].method}\n\n${trackDetails[id].limitation}`).join('\n\n')}`;
    case 'modelos/':
      return `# Referências e modelos publicados\n\n${p.description}\n\n${
        pages
          .filter((p) => p.model)
          .map((p) => `- ${link(modelName(p.model!), p.path)}`)
          .join('\n') || 'Nenhum resultado publicado.'
      }`;
    default:
      throw new Error(`Página sem representação Markdown: ${p.path}`);
  }
}
export function markdownDocument(p: Page, includeSchema = true) {
  const header = `---\ntitle: ${JSON.stringify(p.title)}\ndescription: ${JSON.stringify(p.description)}\ncanonical: ${JSON.stringify(urls.absolute(p.path))}\nlanguage: pt-BR\n---\n\n`;
  return `${header}${pageBody(p)}\n\n## Proveniência e citação\n\nPágina HTML: ${urls.absolute(p.path)}\n\nPublicação: Como Votam. Protocolo: ${urls.absolute('metodologia/')}\n\nPolítica de dados: ${urls.absolute('dados/')}\n\nCorreções: ${urls.absolute('erratas/')}\n${includeSchema ? `\n## Dados estruturados da página\n\n\`\`\`json\n${JSON.stringify(schemaGraph(p), null, 2)}\n\`\`\`\n` : ''}`;
}
export function llmsIndex() {
  return `# Teor\n\n> ${overview.summary}\n\n## Leitura e citação\n\nAs URLs HTML são canônicas. As representações Markdown abaixo contêm o conteúdo público e o mesmo JSON-LD da página. Use as URLs explícitas; este site estático não negocia a representação pelo cabeçalho Accept.\n\nNão agregue tarefas em uma nota geral. Cite hashes, tarefa, casa, modo, divisão, qualidade temporal, cobertura e verificação. Baselines não são LLMs.\n\n## Páginas\n\n${pages
    .filter((p) => p.index)
    .map((p) => `- [${p.name}](${urls.absolute(markdownPath(p))}): ${p.description}`)
    .join(
      '\n',
    )}\n\n## Leitura completa e descoberta\n\n- ${link('Documentação pública completa', 'llms-full.txt')}\n- ${link('Sitemap XML', 'sitemap.xml')}\n- ${link('Catálogo de métricas públicas', 'resultados/index.json')}\n- ${link('Como citar', 'como-citar/')}\n\n## Condições de uso\n\nCódigo sob Apache 2.0. Dados e marca têm termos separados. Os artefatos do benchmark não são destinados a treinamento; leitura para pesquisa e citação não atribui uma licença de treinamento. ${urls.absolute('dados/')}\n\n## Fontes oficiais\n\n${SOURCES.map((s) => `- [${s.name}](${s.url})`).join('\n')}\n`;
}
