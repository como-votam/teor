import { $, $$, h, icon, normalize, readJSON, swap, isTyping, announce, scrollWithin } from './ui/core';
import { mountCopy } from './ui/controls';
import type { ItemSummary } from '../data/derived';

interface Labels {
  tracks: string[][];
  taskNames: Record<string, string>;
  modeNames: Record<string, string>;
  chamberNames: Record<string, string>;
  partitions: { url: string; count: number }[];
}
const L = readJSON<Labels>('explorer-labels');
const base = (document.querySelector('[data-logo]') as HTMLAnchorElement).getAttribute('href') || '/';
const typeNames: Record<string, string> = {
  string: 'Texto',
  integer: 'Inteiro',
  set: 'Conjunto',
  sequence: 'Sequência',
  probability: 'Probabilidade',
  claims: 'Afirmações',
};
const difficultyNames: Record<string, string> = { easy: 'Fácil', medium: 'Média', hard: 'Difícil' };
const trackName = Object.fromEntries(L.tracks.map(([id, name]) => [id, name]));

type FacetKey = 'track' | 'task' | 'chamber' | 'mode' | 'type' | 'difficulty';
const FACETS: { key: FacetKey; title: string; label: (v: string) => string; list?: boolean }[] = [
  { key: 'track', title: 'Trilha', label: (v) => `${v} · ${trackName[v] || v}`, list: true },
  { key: 'task', title: 'Tarefa', label: (v) => L.taskNames[v] || v, list: true },
  { key: 'chamber', title: 'Casa', label: (v) => L.chamberNames[v] || v },
  { key: 'mode', title: 'Modo', label: (v) => L.modeNames[v] || v },
  { key: 'type', title: 'Resposta', label: (v) => typeNames[v] || v },
  { key: 'difficulty', title: 'Dificuldade', label: (v) => difficultyNames[v] || v },
];

const params = new URLSearchParams(location.search);
const state: Record<FacetKey, string> & { q: string; item: string } = {
  track: params.get('track') || '',
  task: params.get('task') || '',
  chamber: params.get('chamber') || '',
  mode: params.get('mode') || '',
  type: params.get('type') || '',
  difficulty: params.get('difficulty') || '',
  q: params.get('q') || '',
  item: params.get('item') || '',
};

const facetsEl = $('[data-facets]')!;
const rowsEl = $('[data-rows]')!;
const detailEl = $('[data-detail]')!;
const search = $<HTMLInputElement>('[data-search]')!;
const countEl = $('[data-count]')!;
const clearBtn = $('[data-clear]')!;
search.value = state.q;

let all: (ItemSummary & { _text: string })[] = [];
let shown: typeof all = [];
const cache = new Map<string, any>();

function matches(i: ItemSummary & { _text: string }, skip?: FacetKey) {
  for (const f of FACETS) if (f.key !== skip && state[f.key] && (i as any)[f.key] !== state[f.key]) return false;
  if (state.q) {
    const terms = normalize(state.q).split(/\s+/).filter(Boolean);
    if (!terms.every((t) => i._text.includes(t))) return false;
  }
  return true;
}

function syncURL() {
  const url = new URL(location.href);
  (['track', 'task', 'chamber', 'mode', 'type', 'difficulty', 'q', 'item'] as const).forEach((k) =>
    state[k] ? url.searchParams.set(k, state[k]) : url.searchParams.delete(k),
  );
  history.replaceState(null, '', url);
}

function renderFacets() {
  facetsEl.replaceChildren(
    ...FACETS.map((f) => {
      // Contagens consideram os outros filtros, para mostrar o que sobra ao clicar.
      const counts = new Map<string, number>();
      for (const i of all) if (matches(i, f.key)) counts.set((i as any)[f.key], (counts.get((i as any)[f.key]) || 0) + 1);
      const values = [...new Set(all.map((i) => (i as any)[f.key] as string))].filter(Boolean);
      if (f.key === 'track') values.sort();
      if (f.key === 'task') values.sort((a, b) => Object.keys(L.taskNames).indexOf(a) - Object.keys(L.taskNames).indexOf(b));
      if (f.key === 'difficulty') values.sort((a, b) => ['easy', 'medium', 'hard'].indexOf(a) - ['easy', 'medium', 'hard'].indexOf(b));
      const visible = f.key === 'task' ? values.filter((v) => (counts.get(v) || 0) > 0 || state.task === v) : values;
      return h(
        'div',
        { class: 'facet', role: 'group', 'aria-label': f.title },
        h(
          'div',
          { class: 'facet-title' },
          f.title,
          state[f.key] ? h('button', { type: 'button', onclick: () => setFacet(f.key, '') }, 'limpar') : null,
        ),
        h(
          'div',
          { class: `facet-opts${f.list ? ' facet-opts--list' : ''}` },
          ...visible.map((v) => {
            const n = counts.get(v) || 0;
            return h(
              'button',
              {
                type: 'button',
                class: 'chip',
                'aria-pressed': String(state[f.key] === v),
                'data-empty': n === 0 && state[f.key] !== v ? '' : null,
                onclick: () => setFacet(f.key, state[f.key] === v ? '' : v),
              },
              h('span', null, f.label(v)),
              h('span', { class: 'count' }, String(n)),
            );
          }),
        ),
      );
    }),
  );
}

function setFacet(key: FacetKey, value: string) {
  state[key] = value;
  if (key === 'track' && state.task && !all.some((i) => i.task === state.task && (!value || i.track === value))) state.task = '';
  update();
}

function highlight(text: string) {
  const terms = normalize(state.q).split(/\s+/).filter((t) => t.length > 1);
  if (!terms.length) return [text];
  const norm = normalize(text);
  const marks: [number, number][] = [];
  for (const t of terms) {
    let at = norm.indexOf(t);
    while (at >= 0) {
      marks.push([at, at + t.length]);
      at = norm.indexOf(t, at + t.length);
    }
  }
  marks.sort((a, b) => a[0] - b[0]);
  const out: (string | HTMLElement)[] = [];
  let pos = 0;
  for (const [s, e] of marks) {
    if (s < pos) continue;
    out.push(text.slice(pos, s), h('mark', null, text.slice(s, e)));
    pos = e;
  }
  out.push(text.slice(pos));
  return out;
}

const PAGE = 120;
let limit = PAGE;
// O contêiner rola; só a lista interna é listbox, para que botões e estados vazios fiquem fora dela.
const listEl = h('div', { role: 'listbox', 'aria-label': 'Itens' });
function renderRows() {
  rowsEl.replaceChildren(listEl);
  listEl.hidden = !shown.length;
  listEl.replaceChildren(
    ...shown.slice(0, limit).map((i, idx) =>
      h(
        'button',
        {
          type: 'button',
          class: 'ex-row',
          role: 'option',
          id: `row-${i.id}`,
          'aria-selected': String(i.id === state.item),
          'data-id': i.id,
          'data-idx': idx,
          tabindex: '-1',
          onclick: () => select(i.id),
        },
        h('span', { class: 'code-tag code-tag--soft' }, i.track),
        h(
          'span',
          { style: 'min-width:0' },
          h('span', { class: 'q' }, ...highlight(i.prompt)),
          h(
            'span',
            { class: 'm' },
            h('span', null, L.taskNames[i.task] || i.task),
            h('span', null, L.chamberNames[i.chamber] || i.chamber),
            h('span', null, L.modeNames[i.mode] || i.mode),
          ),
        ),
      ),
    ),
  );
  if (shown.length > limit)
    rowsEl.append(
      h(
        'button',
        { type: 'button', class: 'btn btn--ghost btn--sm', style: 'margin:8px auto;display:flex', onclick: () => ((limit += PAGE), renderRows()) },
        `Mostrar mais ${Math.min(PAGE, shown.length - limit)} de ${shown.length - limit}`,
      ),
    );
  if (!shown.length)
    rowsEl.append(
      h(
        'div',
        { class: 'ex-empty', style: 'min-height:200px' },
        h('div', null, h('h3', null, 'Nada com esses filtros'), h('p', null, 'Tire um filtro ou mude a busca.'), h('button', { type: 'button', class: 'btn btn--outline btn--sm', style: 'margin-top:14px', onclick: clearAll }, 'Limpar tudo')),
      ),
    );
}

function update() {
  shown = all.filter((i) => matches(i));
  limit = PAGE;
  const filtered = FACETS.some((f) => state[f.key]) || !!state.q;
  countEl.textContent = `${shown.length.toLocaleString('pt-BR')} de ${all.length.toLocaleString('pt-BR')} itens`;
  clearBtn.hidden = !filtered;
  renderFacets();
  renderRows();
  syncURL();
}
function clearAll() {
  FACETS.forEach((f) => (state[f.key] = ''));
  state.q = '';
  search.value = '';
  update();
}
clearBtn.addEventListener('click', clearAll);

let t: ReturnType<typeof setTimeout>;
search.addEventListener('input', () => {
  clearTimeout(t);
  t = setTimeout(() => {
    state.q = search.value.trim();
    update();
  }, 90);
});

// Teclado: "/" busca, j/k ou ↑/↓ navegam, Esc sai da busca.
function move(d: number) {
  if (!shown.length) return;
  const idx = shown.findIndex((i) => i.id === state.item);
  const next = Math.max(0, Math.min(shown.length - 1, idx < 0 ? 0 : idx + d));
  if (next >= limit) {
    limit = next + PAGE;
    renderRows();
  }
  select(shown[next].id);
  const row = document.getElementById(`row-${shown[next].id}`);
  if (row) scrollWithin(rowsEl, row);
}
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '/' && !isTyping(e.target)) {
    e.preventDefault();
    search.focus();
    search.select();
    return;
  }
  if (e.target === search && e.key === 'Escape') {
    search.blur();
    return;
  }
  if (e.target === search && e.key === 'ArrowDown') {
    e.preventDefault();
    rowsEl.focus();
    move(state.item ? 0 : 1);
    return;
  }
  if (isTyping(e.target)) return;
  if (e.key === 'j' || (e.key === 'ArrowDown' && rowsEl.contains(document.activeElement))) {
    e.preventDefault();
    move(1);
  } else if (e.key === 'k' || (e.key === 'ArrowUp' && rowsEl.contains(document.activeElement))) {
    e.preventDefault();
    move(-1);
  }
});

// ── Detalhe ─────────────────────────────────────────────────────────────────
async function select(id: string) {
  state.item = id;
  syncURL();
  $$('.ex-row', rowsEl).forEach((r) => r.setAttribute('aria-selected', String(r.dataset.id === id)));
  listEl.setAttribute('aria-activedescendant', `row-${id}`);
  let item = cache.get(id);
  if (!item) {
    detailEl.replaceChildren(h('div', { class: 'ex-detail-inner' }, h('div', { class: 'skeleton', style: 'height:28px;width:40%' }), h('div', { class: 'skeleton', style: 'height:72px;margin-top:18px' }), h('div', { class: 'skeleton', style: 'height:220px;margin-top:18px' })));
    try {
      const res = await fetch(`${base}itens/${encodeURIComponent(id)}.json`);
      if (!res.ok) throw new Error(String(res.status));
      item = await res.json();
      cache.set(id, item);
    } catch {
      detailEl.replaceChildren(h('div', { class: 'ex-empty' }, h('div', null, icon('warning', 28), h('h3', null, 'O item não carregou'), h('p', null, 'Verifique a conexão e escolha o item de novo.'))));
      return;
    }
  }
  if (state.item !== id) return;
  renderDetail(item);
}

const block = (label: string, ...children: (Node | string | null)[]) =>
  h('div', { class: 'ex-block' }, h('div', { class: 'specimen-label' }, label), ...children);

function voteKey(v: string | null) {
  if (v === 'Sim') return 'sim';
  if (v === 'Não') return 'nao';
  if (v === 'Abstenção') return 'abst';
  if (v === null || v === undefined) return 'none';
  return 'outro';
}

function renderVotes(votes: { party?: string; vote: string | null }[]) {
  const byParty = new Map<string, typeof votes>();
  for (const v of votes) {
    const p = v.party || 'Sem partido';
    byParty.set(p, [...(byParty.get(p) || []), v]);
  }
  const tally = new Map<string, number>();
  votes.forEach((v) => tally.set(v.vote ?? 'sem registro', (tally.get(v.vote ?? 'sem registro') || 0) + 1));
  const legendColor: Record<string, string> = { sim: 'var(--color-primary)', nao: 'var(--color-error)', abst: 'var(--color-bar-neutral)', outro: 'var(--color-secondary)', none: 'var(--color-line-strong)' };
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'legend', style: 'margin-bottom:14px' },
      ...[...tally.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => h('span', null, h('span', { class: 'vote-key', style: `background:${legendColor[voteKey(k === 'sem registro' ? null : k)]}` }), k, h('strong', { style: 'color:var(--color-ink)' }, String(n)))),
    ),
    h(
      'div',
      { class: 'votes', role: 'img', 'aria-label': `Votos por partido: ${[...tally.entries()].map(([k, n]) => `${n} ${k}`).join(', ')}` },
      ...[...byParty.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([party, list]) =>
          h(
            'div',
            { class: 'votes-party' },
            h('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, party),
            h('span', { class: 'votes-cells' }, ...list.map((v) => h('i', { 'data-v': voteKey(v.vote), title: v.vote ?? 'sem registro' }))),
            h('span', { class: 'tnum' }, String(list.length)),
          ),
        ),
    ),
  );
}

function renderHistory(history: { body: string; date: string; description: string }[]) {
  const LIMIT = 30;
  const list = h('ol', { class: 'timeline' });
  const draw = (n: number) =>
    list.replaceChildren(
      ...history.slice(0, n).map((e, i) =>
        h(
          'li',
          { 'data-change': i > 0 && history[i - 1].body !== e.body ? '' : null },
          h('span', { class: 'when' }, (e.date || '').replace('T', ' ').slice(0, 16)),
          h('span', { class: 'what' }, h('b', null, e.body), e.description),
        ),
      ),
    );
  draw(LIMIT);
  const wrap = h('div', null, list);
  if (history.length > LIMIT) {
    const more = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', style: 'margin-top:8px' }, `Mostrar os ${history.length} eventos`);
    more.addEventListener('click', () => {
      draw(history.length);
      more.remove();
    });
    wrap.append(more);
  }
  return wrap;
}

function renderContext(c: Record<string, any>, mode: string) {
  if (!c || !Object.keys(c).length)
    return h(
      'div',
      { class: 'callout' },
      icon('info', 18),
      h('span', null, mode === 'tools' ? 'Modo com ferramentas: o modelo consulta a API congelada do snapshot para responder.' : 'Modo sem contexto: o modelo recebe só o identificador do registro. É uma sonda de memória.'),
    );
  const parts: Node[] = [];
  if (c.counterfactual_party)
    parts.push(h('div', { class: 'callout', style: 'margin-bottom:12px' }, icon('warning', 18), h('span', null, h('strong', null, 'Cenário contrafactual. '), `A pergunta atribui todos os votos ao ${c.counterfactual_party}. O gabarito não muda com o partido.`)));
  if (c.heading) parts.push(h('p', { class: 'badge', style: 'margin-bottom:10px' }, c.heading));
  if (c.text) parts.push(h('div', { class: 'ex-doc' }, c.text));
  if (c.rule) parts.push(h('div', { class: 'ex-doc' }, typeof c.rule === 'string' ? c.rule : JSON.stringify(c.rule, null, 2)));
  if (Array.isArray(c.authors)) parts.push(h('div', { class: 'ex-tags' }, ...c.authors.map((a: string) => h('span', { class: 'badge' }, a))));
  if (Array.isArray(c.themes)) parts.push(h('div', { class: 'ex-tags' }, ...c.themes.map((a: string) => h('span', { class: 'badge' }, a))));
  if (Array.isArray(c.votes) && c.votes.length) parts.push(renderVotes(c.votes));
  if (Array.isArray(c.votes) && !c.votes.length) parts.push(h('p', { class: 'fine' }, 'Lista de votos vazia: votação simbólica ou sem registro nominal.'));
  if (c.result) parts.push(h('p', { style: 'margin-top:10px' }, h('span', { class: 'badge' }, `Resultado registrado: ${c.result}`)));
  if (Array.isArray(c.history)) parts.push(renderHistory(c.history));
  if (Array.isArray(c.documents))
    c.documents.forEach((d: { ref: string; text: string }) =>
      parts.push(h('p', { class: 'mono fine', style: 'margin:10px 0 6px' }, d.ref), h('div', { class: 'ex-doc ex-doc--long' }, d.text.trim())),
    );
  const meta = Object.entries(c).filter(([k]) => !['heading', 'text', 'rule', 'authors', 'themes', 'votes', 'result', 'history', 'documents', 'counterfactual_party'].includes(k));
  if (meta.length)
    parts.push(
      h('dl', { class: 'kv', style: 'margin-top:12px' }, ...meta.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, typeof v === 'object' ? JSON.stringify(v) : String(v))])),
    );
  return h('div', null, ...parts);
}

function renderAnswer(a: { type: string; value: any }) {
  if (a.type === 'claims')
    return h('p', { class: 'fine' }, 'Sem gabarito fechado: cada afirmação precisa de um trecho literal que exista no documento citado, e a fidelidade é julgada por dois revisores humanos.');
  if (a.value === '' || a.value === null)
    return h('div', { class: 'specimen-answer' }, h('span', { class: 'answer-token' }, 'abster-se'), h('span', { class: 'fine' }, 'O contexto não traz a informação; a resposta certa é não responder.'));
  if (a.type === 'sequence')
    return h('div', { class: 'seq' }, ...(a.value as string[]).flatMap((v, i) => [i ? h('span', { class: 'arrow' }, '→') : null, h('span', { class: 'answer-token' }, v)]));
  if (Array.isArray(a.value)) return h('div', { class: 'specimen-answer' }, ...a.value.map((v: string) => h('span', { class: 'answer-token' }, v)));
  return h('div', { class: 'specimen-answer' }, h('span', { class: 'answer-token', style: 'font-size:18px;padding:9px 14px' }, String(a.value)));
}

function jsonPretty(value: unknown) {
  const pre = h('pre', { class: 'ex-json' });
  const text = JSON.stringify(value, null, 2);
  // Realce por tokens, sempre como nós de texto.
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    pre.append(text.slice(last, m.index));
    const cls = m[1] ? (m[2] ? 'jk' : 'js') : m[3] ? 'jb' : 'jn';
    pre.append(h('span', { class: cls }, m[1] || m[3] || m[4]));
    if (m[2]) pre.append(m[2]);
    last = m.index! + m[0].length;
  }
  pre.append(text.slice(last));
  return pre;
}

let view: 'read' | 'prompts' | 'json' = 'read';
function renderDetail(item: any) {
  const seg = h(
    'div',
    { class: 'seg', role: 'radiogroup', 'aria-label': 'Visualização do item', 'data-seg': '' },
    ...([['read', 'Leitura'], ['prompts', 'Prompts'], ['json', 'JSON']] as const).map(([v, label]) =>
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(view === v), 'data-value': v }, h('span', { 'data-text': label }, label)),
    ),
  );
  const content = h('div');
  const draw = () => {
    if (view === 'read')
      content.replaceChildren(
        block('Contexto entregue ao modelo', renderContext(item.context, item.mode)),
        block('Gabarito', renderAnswer(item.answer)),
        block(
          'Evidência',
          ...item.evidence.map((e: { ref: string; url: string; quote: string | null }) =>
            h(
              'div',
              { style: 'margin-top:6px' },
              h('a', { class: 'go', href: e.url, target: '_blank', rel: 'noopener' }, e.ref, icon('arrowUpRight', 15)),
              e.quote && e.quote.length < 600 ? h('p', { class: 'fine', style: 'margin-top:6px' }, `“${e.quote.trim()}”`) : null,
            ),
          ),
        ),
      );
    else if (view === 'prompts')
      content.replaceChildren(
        block('As três variantes', h('ol', { class: 'prompt-list', style: 'padding:0;margin:0' }, ...item.prompts.map((p: string) => h('li', null, p)))),
        h('p', { class: 'fine', style: 'margin-top:14px' }, 'Toda execução responde às três. A dispersão entre elas aparece nos perfis como sensibilidade ao prompt.'),
      );
    else
      content.replaceChildren(
        h(
          'div',
          { class: 'ex-block' },
          h(
            'div',
            { class: 'specimen-label' },
            'Item completo',
            h('button', { type: 'button', class: 'icon-btn copy', 'data-copy': JSON.stringify(item, null, 2), 'aria-label': 'Copiar JSON' }, icon('copy', 16, 'ico-copy'), icon('check', 16, 'ico-check')),
          ),
          jsonPretty(item),
        ),
      );
    mountCopy(content);
  };
  seg.addEventListener('seg', (e) => {
    view = (e as CustomEvent).detail.value;
    draw();
  });
  const permalink = `${location.origin}${base}explorador/?item=${encodeURIComponent(item.id)}`;
  const inner = h(
    'div',
    { class: 'ex-detail-inner' },
    h(
      'div',
      { style: 'display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px' },
      h(
        'div',
        { class: 'ex-tags', style: 'margin:0' },
        h('span', { class: 'code-tag' }, item.track),
        h('span', { class: 'badge' }, L.taskNames[item.task] || item.task),
        h('span', { class: 'badge badge--muted' }, L.chamberNames[item.chamber] || item.chamber),
        h('span', { class: 'badge badge--muted' }, L.modeNames[item.mode] || item.mode),
        item.experimental ? h('span', { class: 'badge badge--warn' }, 'experimental') : null,
      ),
      h('button', { type: 'button', class: 'icon-btn copy', 'data-copy': permalink, 'aria-label': 'Copiar link do item' }, icon('copy', 16, 'ico-copy'), icon('check', 16, 'ico-check')),
    ),
    h('h2', { class: 'ex-h' }, item.prompts[0]),
    h(
      'p',
      { class: 'fine mono', style: 'margin-top:10px;overflow-wrap:anywhere' },
      `${item.id} · ${typeNames[item.answer.type] || item.answer.type} · ${difficultyNames[item.difficulty] || item.difficulty}${item.source_date ? ` · fonte de ${item.source_date}` : ''}`,
    ),
    h('div', { style: 'margin-top:20px' }, seg),
    content,
  );
  detailEl.replaceChildren(inner);
  detailEl.scrollTop = 0;
  swap(inner);
  draw();
  mountCopy(inner);
  import('./ui/controls').then((m) => m.mountSegmented(inner));
}

// ── Carga ───────────────────────────────────────────────────────────────────
fetch(`${base}itens/index.json`)
  .then((r) => r.json())
  .then((list: ItemSummary[]) => {
    all = list.map((i) => ({ ...i, _text: normalize(`${i.prompt} ${i.ref} ${i.id} ${i.theme}`) }));
    update();
    const at = shown.findIndex((i) => i.id === state.item);
    if (at >= limit) {
      limit = at + 20;
      renderRows();
    }
    if (state.item && all.some((i) => i.id === state.item)) {
      select(state.item);
      requestAnimationFrame(() => {
        const row = document.getElementById(`row-${state.item}`);
        if (row) scrollWithin(rowsEl, row, 'center');
      });
    }
  })
  .catch(() => {
    countEl.textContent = 'O índice não carregou. Recarregue a página.';
    rowsEl.replaceChildren();
  });

// ── SQL ─────────────────────────────────────────────────────────────────────
const EXAMPLES: [string, string][] = [
  ['Itens por trilha e modo', 'SELECT track, mode, count(*) AS itens\nFROM items\nGROUP BY ALL\nORDER BY track, mode;'],
  ['Siglas no gabarito de tipo', "SELECT regexp_extract(item_json, '\"value\":\"([^\"]*)\"', 1) AS sigla,\n       count(*) AS itens\nFROM items\nWHERE task = 'type'\nGROUP BY sigla\nORDER BY itens DESC;"],
  ['Câmara × Senado por tarefa', "SELECT task,\n       count(*) FILTER (WHERE chamber = 'camara') AS camara,\n       count(*) FILTER (WHERE chamber = 'senado') AS senado\nFROM items\nGROUP BY task\nORDER BY camara + senado DESC;"],
  ['Contextos mais longos', 'SELECT id, track, task, length(item_json) AS bytes\nFROM items\nORDER BY bytes DESC\nLIMIT 15;'],
  ['Buscar no texto', "SELECT id, prompt\nFROM items\nWHERE item_json ILIKE '%lei complementar%'\nLIMIT 50;"],
];
const input = $<HTMLTextAreaElement>('[data-sql-input]')!;
const runBtn = $<HTMLButtonElement>('[data-sql-run]')!;
const csvBtn = $<HTMLButtonElement>('[data-sql-csv]')!;
const status = $('[data-sql-status]')!;
const out = $('[data-sql-out]')!;
$('[data-sql-examples]')!.replaceChildren(
  ...EXAMPLES.map(([label, sql]) =>
    h('button', { type: 'button', class: 'chip', style: 'box-shadow:inset 0 0 0 1px var(--color-line-strong)', onclick: () => ((input.value = sql), run()) }, label),
  ),
);
let conn: any = null;
let lastRows: { cols: string[]; rows: unknown[][] } | null = null;
async function connect() {
  if (conn) return conn;
  status.replaceChildren(h('span', { class: 'loader-bar' }), 'Baixando o DuckDB e abrindo as partições…');
  const duckdb = await import('@duckdb/duckdb-wasm');
  const [mvp, eh, mvpWorker, ehWorker] = await Promise.all([
    import('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'),
    import('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'),
    import('@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'),
    import('@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'),
  ]);
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: mvp.default, mainWorker: mvpWorker.default },
    eh: { mainModule: eh.default, mainWorker: ehWorker.default },
  });
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(bundle.mainWorker!));
  await db.instantiate(bundle.mainModule);
  const c = await db.connect();
  const names: string[] = [];
  for (const [i, p] of L.partitions.entries()) {
    const res = await fetch(`${base}${p.url.replace(/^\//, '')}`);
    if (!res.ok) throw new Error(`Partição ${i + 1} indisponível`);
    const name = `p${i}.parquet`;
    await db.registerFileBuffer(name, new Uint8Array(await res.arrayBuffer()));
    names.push(`'${name}'`);
  }
  await c.query(`CREATE TABLE items AS SELECT * FROM read_parquet([${names.join(',')}])`);
  conn = c;
  return c;
}
async function run() {
  const sql = input.value.trim();
  if (!sql || runBtn.disabled) return;
  runBtn.disabled = true;
  status.removeAttribute('data-tone');
  try {
    const c = await connect();
    status.replaceChildren(h('span', { class: 'loader-bar' }), 'Executando…');
    const t0 = performance.now();
    const table = await c.query(sql);
    const ms = Math.round(performance.now() - t0);
    const cols = table.schema.fields.map((f: { name: string }) => f.name);
    const rows = table.toArray().map((r: any) => cols.map((k: string) => r[k]));
    lastRows = { cols, rows };
    const shownRows = rows.slice(0, 500);
    const cellText = (v: unknown) => (v === null || v === undefined ? 'NULL' : typeof v === 'bigint' ? v.toString() : typeof v === 'object' ? JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)) : String(v));
    out.replaceChildren(
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'table' },
          h('thead', null, h('tr', null, ...cols.map((c: string) => h('th', { scope: 'col' }, c)))),
          h('tbody', null, ...shownRows.map((r: unknown[]) => h('tr', { 'data-row': '' }, ...r.map((v) => h('td', { title: cellText(v).slice(0, 400) }, cellText(v)))))),
        ),
      ),
    );
    status.textContent = `${rows.length.toLocaleString('pt-BR')} ${rows.length === 1 ? 'linha' : 'linhas'} em ${ms} ms${rows.length > 500 ? ' · exibindo as 500 primeiras' : ''}`;
    csvBtn.hidden = !rows.length;
    announce(status.textContent);
  } catch (err) {
    status.setAttribute('data-tone', 'error');
    status.textContent = String((err as Error).message || err).split('\n')[0];
    runBtn.classList.add('is-refused');
    setTimeout(() => runBtn.classList.remove('is-refused'), 300);
  } finally {
    runBtn.disabled = false;
  }
}
runBtn.addEventListener('click', run);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    run();
  }
});
csvBtn.addEventListener('click', () => {
  if (!lastRows) return;
  const esc = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const csv = [lastRows.cols, ...lastRows.rows].map((r) => r.map((v) => esc(typeof v === 'bigint' ? v.toString() : v)).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  h('a', { href: url, download: 'teor-consulta.csv' }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
