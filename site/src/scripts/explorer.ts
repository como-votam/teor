import * as duckdb from '@duckdb/duckdb-wasm';
import mvp from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { chamberNames, modeNames, taskNames } from '../data/labels';
import type { Item } from '../data';

const partitions = JSON.parse(document.getElementById('partitions')!.textContent!) as {
  url: string;
}[];
let db: duckdb.AsyncDuckDB | undefined;
let connection: duckdb.AsyncDuckDBConnection | undefined;
let loaded = 0;
let timer: ReturnType<typeof setTimeout>;
let renderVersion = 0;
const status = document.getElementById('explorer-status')!;
const load = document.getElementById('load') as HTMLButtonElement;
async function initialize() {
  if (connection) return;
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: mvp, mainWorker: mvpWorker },
    eh: { mainModule: eh, mainWorker: ehWorker },
  });
  const worker = new Worker(bundle.mainWorker!);
  db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  await db.instantiate(bundle.mainModule);
  connection = await db.connect();
  await connection.query(
    'CREATE TABLE items(id VARCHAR, track VARCHAR, task VARCHAR, chamber VARCHAR, mode VARCHAR, prompt VARCHAR, item_json VARCHAR)',
  );
}
async function render() {
  if (!connection) return;
  const version = ++renderVersion;
  const search = (document.getElementById('search') as HTMLInputElement).value;
  const track = (document.getElementById('explorer-track') as HTMLSelectElement).value;
  const statement = await connection.prepare(
    "SELECT item_json FROM items WHERE contains(lower(prompt),lower(?)) AND (? = '' OR track = ?) ORDER BY id LIMIT 50",
  );
  const table = await statement.query(search, track, track);
  await statement.close();
  if (version !== renderVersion) return;
  const container = document.getElementById('items')!;
  container.replaceChildren();
  for (const row of table.toArray()) {
    const item = JSON.parse(row.item_json) as Item;
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    const code = document.createElement('span');
    code.className = 'track-code';
    code.textContent = item.track;
    const prompt = document.createElement('span');
    prompt.textContent = item.prompts[0];
    summary.append(code, prompt);
    details.append(summary);
    const meta = document.createElement('div');
    meta.className = 'item-meta';
    [
      taskNames[item.task] || item.task,
      chamberNames[item.chamber] || item.chamber,
      modeNames[item.mode] || item.mode,
    ].forEach((text) => {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = text;
      meta.append(badge);
    });
    details.append(meta);
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify({ context: item.context, answer: item.answer }, null, 2);
    details.append(pre);
    for (const evidence of item.evidence) {
      const link = document.createElement('a');
      link.textContent = 'Fonte oficial ↗';
      link.href = evidence.url;
      link.rel = 'noopener';
      details.append(link);
    }
    container.append(details);
  }
  if (!table.numRows) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    const heading = document.createElement('h2');
    heading.textContent = 'Nenhum item nesta busca';
    const help = document.createElement('p');
    help.textContent = 'Tente outro termo, escolha outra trilha ou carregue a próxima partição.';
    empty.append(heading, help);
    container.append(empty);
  }
  status.textContent = `${table.numRows} itens exibidos; ${loaded} de ${partitions.length} partições carregadas.`;
}
load.addEventListener('click', async () => {
  load.disabled = true;
  load.setAttribute('aria-busy', 'true');
  status.textContent = 'Carregando a partição de dados…';
  const skeleton = document.createElement('div');
  skeleton.className = 'loading-skeleton';
  skeleton.setAttribute('aria-hidden', 'true');
  document.getElementById('items')!.prepend(skeleton);
  try {
    await initialize();
    if (loaded >= partitions.length) {
      status.textContent = 'Todas as partições foram carregadas.';
      return;
    }
    const name = `partition-${loaded}.parquet`;
    const response = await fetch(
      `${import.meta.env.BASE_URL}${partitions[loaded].url.replace(/^\//, '')}`,
    );
    if (!response.ok) throw new Error('Arquivo indisponível');
    await db!.registerFileBuffer(name, new Uint8Array(await response.arrayBuffer()));
    await connection!.query(`INSERT INTO items SELECT * FROM read_parquet('${name}')`);
    loaded++;
    await render();
  } catch (error) {
    status.textContent = `Não foi possível abrir os dados. Tente novamente. ${String(error)}`;
  } finally {
    skeleton.remove();
    load.removeAttribute('aria-busy');
    load.disabled = loaded >= partitions.length;
  }
});
for (const id of ['search', 'explorer-track'])
  document.getElementById(id)!.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void render().catch(() => {
        status.textContent =
          'Não foi possível aplicar a busca. Tente outro termo ou carregue a próxima partição.';
      });
    }, 200);
  });

const trackParam = new URLSearchParams(location.search).get('track');
const trackSelect = document.getElementById('explorer-track') as HTMLSelectElement;
if (trackParam && Array.from(trackSelect.options).some((o) => o.value === trackParam))
  trackSelect.value = trackParam;
load.disabled = !partitions.length;
