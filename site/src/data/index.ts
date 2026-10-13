import fs from 'node:fs';
import path from 'node:path';

export interface Metric {
  track: string;
  task: string;
  chamber?: string;
  mode?: string;
  split?: string;
  category?: string;
  score?: { mean: number; ci95: number[]; n: number; families: number };
  brier?: { mean: number; ci95: number[] };
  citation_validity?: { mean: number; ci95: number[] };
  semantic_fidelity?: string;
  human_fidelity?: { mean: number; ci95: number[]; n: number };
  mean?: number;
  ci95?: number[];
  first?: string;
  second?: string;
  temporal_quality?: string;
}
export interface Result {
  id: string;
  model: string;
  dataset_hash: string;
  protocol_hash: string;
  verification: string;
  complete: boolean;
  created_at: string;
  metrics: Metric[];
  usage: { coverage: number; cost_usd: number | null; latency_mean_seconds: number | null };
  config: { open_weights?: boolean; brazilian?: boolean; [key: string]: unknown };
}
export interface Item {
  id: string;
  track: string;
  task: string;
  chamber: string;
  mode: string;
  prompts: string[];
  context: Record<string, unknown>;
  answer: { type: string; value: unknown };
  evidence: { ref: string; url: string }[];
}
export interface Dataset {
  results: Result[];
  partitions: { url: string; count: number; tracks: string[] }[];
  quiz: Item[];
  predictions: {
    item_id: string;
    variant: number;
    model: string;
    response: unknown;
    abstain: boolean;
    status: string;
  }[];
  rounds: {
    id: string;
    opens_at: string;
    closes_at: string;
    state: string;
    published_at: string;
  }[];
  count: number;
  dataset_hash: string;
  examples?: { model: string; run_id: string; item: Item; response: unknown; score: number }[];
}
const file = path.resolve('src/data/generated.json');
const publishedResults = path.resolve('../results');
export const data: Dataset = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, 'utf8'))
  : {
      results: (fs.existsSync(publishedResults) ? fs.readdirSync(publishedResults) : [])
        .filter((name) => /^baseline-.*\.json$/.test(name))
        .sort()
        .map((name) => JSON.parse(fs.readFileSync(path.join(publishedResults, name), 'utf8'))),
      partitions: [],
      quiz: [],
      predictions: [],
      rounds: [],
      count: 0,
      dataset_hash: '',
    };
export const tracks = [
  ['A', 'Texto', 'Tipos, autoria e referências explícitas.'],
  ['B', 'Regras', 'Procedimentos e regras com vigência documentada.'],
  ['C', 'Votações', 'Contagens e resultados oficiais.'],
  ['D', 'Tramitação', 'Sequências e raciocínio sobre o histórico.'],
  ['E', 'Previsão', 'Aprovação e voto individual, com corte temporal.'],
  ['F', 'Grounding', 'Afirmações, citações e revisão humana.'],
  ['G', 'Ferramentas', 'Consultas a uma API congelada.'],
  ['H', 'Paridade', 'Diferenças entre cenários contrafactuais pareados.'],
];
export const slug = (value: string) => encodeURIComponent(value.replaceAll('/', '--'));
export { taskNames, modeNames, chamberNames, modelName } from './labels';
