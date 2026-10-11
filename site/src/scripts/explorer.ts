import * as duckdb from '@duckdb/duckdb-wasm';
import mvp from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import type { Item } from '../data';

const partitions = JSON.parse(document.getElementById('partitions')!.textContent!) as {
  url: string;
}[];
let db: duckdb.AsyncDuckDB | undefined;
let connection: duckdb.AsyncDuckDBConnection | undefined;
let loaded = 0;
let timer: ReturnType<typeof setTimeout>;
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
  const search = (document.getElementById('search') as HTMLInputElement).value;
  const track = (document.getElementById('explorer-track') as HTMLSelectElement).value;
  const statement = await connection.prepare(
    "SELECT item_json FROM items WHERE contains(lower(prompt),lower(?)) AND (? = '' OR track = ?) ORDER BY id LIMIT 50",
  );
  const table = await statement.query(search, track, track);
  await statement.close();
  const container = document.getElementById('items')!;
  container.replaceChildren();
  for (const row of table.toArray()) {
    const item = JSON.parse(row.item_json) as Item;
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `${item.track} · ${item.prompts[0]}`;
    details.append(summary);
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
  status.textContent = `${table.numRows} itens exibidos; ${loaded} de ${partitions.length} partições carregadas.`;
}
load.addEventListener('click', async () => {
  load.disabled = true;
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
    load.disabled = loaded >= partitions.length;
  }
});
for (const id of ['search', 'explorer-track'])
  document.getElementById(id)!.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void render(), 200);
  });
