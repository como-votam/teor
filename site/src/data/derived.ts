// Projeções de leitura sobre generated.json, calculadas uma vez no build.
// Nada aqui soma tarefas diferentes: cada fatia (tarefa × casa × modo) fica isolada.
import fs from 'node:fs';
import path from 'node:path';
import { parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { data, tracks, modelSlug, type Item, type Result } from './index';
import { taskNames, modeNames, chamberNames, modelName } from './labels';

export type RunKind = 'baseline' | 'model';

export interface Run {
  id: string;
  model: string;
  slug: string;
  label: string;
  org: string;
  kind: RunKind;
  provider: string;
  weights: string;
  openWeights: boolean | null;
  date: string;
  coverage: number;
  complete: boolean;
  cost: number | null;
  latency: number | null;
  tokensIn: number;
  tokensOut: number;
  toolCalls: number;
  calls: number;
  invalid: number;
  verification: string;
  reproduction: string;
  split: string;
  datasetHash: string;
  protocolHash: string;
  /** Slot de cor categórica (0..3) para modelos; null para referências, que ficam em cinza. */
  color: number | null;
}

export interface Cell {
  mean: number;
  low: number;
  high: number;
  n: number;
  families: number;
  variants: number[];
}

export interface Slice {
  key: string;
  track: string;
  task: string;
  chamber: string;
  mode: string;
  /** Métrica exibida: nota da tarefa, abstenção correta ou trechos localizados. */
  metric: 'score' | 'abstention' | 'citation';
  experimental: boolean;
  temporal: string;
  cells: Record<string, Cell>;
  /** Maior média entre as referências determinísticas desta fatia. */
  floor: number | null;
  floorRun: string | null;
  minFamilies: number;
}

const runsRaw: Result[] = data.results;

function org(model: string) {
  const parts = model.split('/').filter(Boolean);
  return parts.length > 2 ? parts[parts.length - 2].replace(/^@/, '') : parts[0] || '';
}
function shortName(model: string) {
  if (model.startsWith('baseline/')) return modelName(model);
  const parts = model.split('/');
  return parts[parts.length - 1];
}

let slot = 0;
export const runs: Run[] = runsRaw
  .map((r) => {
    const usage = r.usage as Result['usage'] & {
      input_tokens?: number;
      output_tokens?: number;
      tool_calls?: number;
      received?: number;
      statuses?: Record<string, number>;
    };
    const config = r.config as Record<string, unknown>;
    const kind: RunKind = r.model.startsWith('baseline/') ? 'baseline' : 'model';
    const classification = String(config.model_classification || '');
    return {
      id: r.id,
      model: r.model,
      slug: modelSlug(r.model),
      label: shortName(r.model),
      org: kind === 'baseline' ? 'Referência' : org(r.model),
      kind,
      provider: String(config.provider || (kind === 'baseline' ? 'Local, determinístico' : '')),
      weights: String(config.weights_status || ''),
      openWeights:
        classification === 'open-weights' ? true : classification === 'closed' ? false : null,
      date: r.created_at,
      coverage: usage.coverage,
      complete: r.complete,
      cost: usage.cost_usd,
      latency: usage.latency_mean_seconds,
      tokensIn: usage.input_tokens || 0,
      tokensOut: usage.output_tokens || 0,
      toolCalls: usage.tool_calls || 0,
      calls: usage.received || 0,
      invalid: usage.statuses?.invalid || 0,
      verification: r.verification,
      reproduction: String(config.reproduction || ''),
      split: String(config.split || 'test-public'),
      datasetHash: r.dataset_hash,
      protocolHash: r.protocol_hash,
      color: null as number | null,
    };
  })
  .sort((a, b) =>
    a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'model' ? -1 : 1,
  )
  .map((run) => ({ ...run, color: run.kind === 'model' ? slot++ % 4 : null }));

export const models = runs.filter((r) => r.kind === 'model');
export const baselines = runs.filter((r) => r.kind === 'baseline');

const sliceMap = new Map<string, Slice>();
for (const result of runsRaw) {
  for (const m of result.metrics as (Result['metrics'][number] & Record<string, any>)[]) {
    const source = m.citation_validity
      ? { metric: 'citation' as const, value: m.citation_validity }
      : m.correct_abstention
        ? { metric: 'abstention' as const, value: m.correct_abstention }
        : m.score
          ? { metric: 'score' as const, value: m.score }
          : null;
    if (!source || !m.chamber || !m.mode) continue;
    const key = `${m.task}|${m.chamber}|${m.mode}`;
    const slice: Slice = sliceMap.get(key) || {
      key,
      track: m.track,
      task: m.task,
      chamber: m.chamber,
      mode: m.mode,
      metric: source.metric,
      experimental: m.category === 'experimental',
      temporal: m.temporal_quality || 'not_applicable',
      cells: {},
      floor: null,
      floorRun: null,
      minFamilies: Infinity,
    };
    slice.cells[result.id] = {
      mean: source.value.mean,
      low: source.value.ci95[0],
      high: source.value.ci95[1],
      n: source.value.n,
      families: source.value.families,
      variants: m.prompt_sensitivity?.variant_means || [],
    };
    slice.minFamilies = Math.min(slice.minFamilies, source.value.families);
    sliceMap.set(key, slice);
  }
}
const trackOrder = tracks.map((t) => t[0]);
const modeOrder = ['with_context', 'closed_book', 'tools'];
export const slices: Slice[] = [...sliceMap.values()]
  .map((s) => {
    let floor: number | null = null;
    let floorRun: string | null = null;
    for (const b of baselines) {
      const cell = s.cells[b.id];
      if (cell && (floor === null || cell.mean > floor)) {
        floor = cell.mean;
        floorRun = b.id;
      }
    }
    return { ...s, floor, floorRun };
  })
  .sort(
    (a, b) =>
      trackOrder.indexOf(a.track) - trackOrder.indexOf(b.track) ||
      Object.keys(taskNames).indexOf(a.task) - Object.keys(taskNames).indexOf(b.task) ||
      modeOrder.indexOf(a.mode) - modeOrder.indexOf(b.mode) ||
      a.chamber.localeCompare(b.chamber),
  );

export const principalSlices = slices.filter((s) => !s.experimental);

/** Referência com a maior média entre as fatias principais: o adversário padrão em comparações. */
export const strongestBaseline =
  [...baselines].sort((a, b) => {
    const avg = (id: string) => {
      const cells = principalSlices.map((s) => s.cells[id]).filter(Boolean);
      return cells.reduce((sum, c) => sum + c.mean, 0) / Math.max(1, cells.length);
    };
    return avg(b.id) - avg(a.id);
  })[0] || null;

/**
 * Média simples das fatias principais com contexto. Serve só para ordenar e escolher o que
 * mostrar primeiro; nunca é exibida como nota, porque misturaria tarefas diferentes.
 */
export function orderingScore(runId: string) {
  const cells = principalSlices.filter((s) => s.mode === 'with_context').map((s) => s.cells[runId]).filter(Boolean);
  return cells.reduce((sum, c) => sum + c.mean, 0) / Math.max(1, cells.length);
}

/** Grupo de provedor de cada execução, usado nos filtros. */
export const providerOf = (r: Run) => (r.kind === 'baseline' ? 'Referências' : r.provider || r.org);

/**
 * As execuções que a matriz mostra por padrão, no máximo `limit`: a versão mais nova de cada
 * família de modelo, o melhor modelo de pesos abertos e os próximos mais fortes para completar.
 * Só modelos: as referências seguem disponíveis no seletor e na visão "acima da referência".
 */
export function featuredRuns(limit = 8) {
  const family = (r: Run) => r.label.replace(/[-_ ]?v?\d+(\.\d+)*([-_.].*)?$/, '');
  const version = (r: Run) => (r.label.match(/(\d+(?:\.\d+)*)/)?.[1] || '0').split('.').map(Number);
  const newer = (a: Run, b: Run) => {
    const [va, vb] = [version(a), version(b)];
    for (let i = 0; i < Math.max(va.length, vb.length); i++) if ((va[i] || 0) !== (vb[i] || 0)) return (va[i] || 0) - (vb[i] || 0);
    return Date.parse(a.date) - Date.parse(b.date);
  };
  const byScore = [...models].sort((a, b) => orderingScore(b.id) - orderingScore(a.id));
  const picked: Run[] = [];
  const room = limit;
  const add = (r?: Run) => r && !picked.includes(r) && picked.length < room && picked.push(r);
  const families = new Map<string, Run>();
  for (const m of models) {
    const f = family(m);
    const cur = families.get(f);
    if (!cur || newer(m, cur) > 0) families.set(f, m);
  }
  // O melhor de pesos abertos tem vaga garantida; depois, a versão mais nova de cada família.
  add(byScore.find((m) => m.openWeights === true));
  [...families.values()].sort((a, b) => orderingScore(b.id) - orderingScore(a.id)).forEach(add);
  byScore.forEach(add);
  const ordered = picked.sort((a, b) => orderingScore(b.id) - orderingScore(a.id));
  return ordered;
}

/** Fatias de modelo acima da melhor referência, contando só quando o IC inteiro supera o piso. */
export function liftSummary(runId: string) {
  let above = 0;
  let below = 0;
  let total = 0;
  for (const s of principalSlices) {
    const cell = s.cells[runId];
    if (!cell || s.floor === null) continue;
    total++;
    if (cell.low > s.floor) above++;
    else if (cell.high < s.floor) below++;
  }
  return { above, below, overlap: total - above - below, total };
}

/** Pares (sem contexto → com contexto) para a mesma tarefa e casa: mede o que o contexto acrescenta. */
export function contextPairs(runId: string) {
  return principalSlices
    .filter((s) => s.mode === 'with_context' && s.cells[runId])
    .map((s) => {
      const closed = sliceMap.get(`${s.task}|${s.chamber}|closed_book`);
      return closed?.cells[runId]
        ? { slice: s, withContext: s.cells[runId], closed: closed.cells[runId] }
        : null;
    })
    .filter(<T>(x: T | null): x is T => x !== null);
}

export const sliceLabel = (s: Pick<Slice, 'task' | 'chamber' | 'mode'>) =>
  `${taskNames[s.task] || s.task} · ${chamberNames[s.chamber] || s.chamber} · ${modeNames[s.mode] || s.mode}`;

export const metricNames: Record<Slice['metric'], string> = {
  score: 'Nota da tarefa',
  abstention: 'Abstenção correta',
  citation: 'Trechos localizados',
};

// ── Itens públicos ────────────────────────────────────────────────────────
export interface ItemSummary {
  id: string;
  track: string;
  task: string;
  chamber: string;
  mode: string;
  prompt: string;
  type: string;
  difficulty: string;
  theme: string;
  date: string;
  ref: string;
  experimental: boolean;
  answerable: boolean;
}

async function readItems(): Promise<Item[]> {
  const dir = path.resolve('public');
  const out: Item[] = [];
  for (const p of data.partitions) {
    const file = path.join(dir, p.url.replace(/^\//, ''));
    if (!fs.existsSync(file)) continue;
    const buf = fs.readFileSync(file);
    const rows = (await parquetReadObjects({
      file: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      compressors,
    })) as { item_json: string }[];
    for (const row of rows) out.push(JSON.parse(row.item_json));
  }
  return out;
}

export const items: (Item & Record<string, any>)[] = await readItems();
export const itemSummaries: ItemSummary[] = items.map((i) => ({
  id: i.id,
  track: i.track,
  task: i.task,
  chamber: i.chamber,
  mode: i.mode,
  prompt: i.prompts[0],
  type: i.answer.type,
  difficulty: i.difficulty || '',
  theme: i.theme || '',
  date: i.source_date || '',
  ref: i.evidence[0]?.ref || '',
  experimental: Boolean(i.experimental),
  answerable: i.answerable !== false,
}));

export const trackCounts = Object.fromEntries(
  tracks.map(([id]) => [id, itemSummaries.filter((i) => i.track === id).length]),
) as Record<string, number>;

export const sourceRange = (() => {
  const dates = itemSummaries
    .map((i) => i.date)
    .filter(Boolean)
    .sort();
  return { first: dates[0] || '', last: dates[dates.length - 1] || '' };
})();

/** Payload compacto que os scripts de cliente recebem embutido na página. */
export const clientPayload = {
  runs: runs.map((r) => ({ ...r, provider: providerOf(r), order: orderingScore(r.id) })),
  strongest: strongestBaseline?.id || null,
  featured: featuredRuns().map((r) => r.id),
  slices: slices.map(({ minFamilies, ...s }) => ({
    ...s,
    minFamilies: Number.isFinite(minFamilies) ? minFamilies : 0,
  })),
  tracks,
  taskNames,
  modeNames,
  chamberNames,
};
export type ClientPayload = typeof clientPayload;
