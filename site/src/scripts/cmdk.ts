// ⌘K: páginas, execuções, trilhas e os 500 itens, numa busca só.
import { h, icon, normalize, readJSON, scrollWithin, type IconName } from './ui/core';

interface Entry {
  title: string;
  hint: string;
  href: string;
  kind: 'page' | 'run' | 'track' | 'task' | 'item';
  text: string;
}
interface Index {
  base: string;
  pages: { name: string; path: string; description: string }[];
  runs: { label: string; slug: string; org: string; kind: string }[];
  tracks: string[][];
  tasks: Record<string, string>;
}
const iconFor: Record<Entry['kind'], IconName> = {
  page: 'article',
  run: 'chart',
  track: 'path',
  task: 'listSearch',
  item: 'listSearch',
};
const kindLabel: Record<Entry['kind'], string> = {
  page: 'Página',
  run: 'Execução',
  track: 'Trilha',
  task: 'Tarefa',
  item: 'Item',
};

let entries: Entry[] | null = null;
let itemsLoaded = false;
let root: HTMLElement | null = null;

function base(): Entry[] {
  const idx = readJSON<Index>('cmdk-index');
  return [
    ...idx.runs.map((r) => ({
      title: r.label,
      hint: r.kind === 'baseline' ? 'Referência determinística' : r.org,
      href: `${idx.base}modelos/${r.slug}/`,
      kind: 'run' as const,
      text: normalize(`${r.label} ${r.org} modelo execução`),
    })),
    ...idx.tracks.map(([id, name, desc]) => ({
      title: `${id} · ${name}`,
      hint: desc,
      href: `${idx.base}trilhas/${id.toLowerCase()}/`,
      kind: 'track' as const,
      text: normalize(`trilha ${id} ${name} ${desc}`),
    })),
    ...Object.entries(idx.tasks).map(([id, name]) => ({
      title: name,
      hint: 'Tarefa',
      href: `${idx.base}explorador/?task=${id}`,
      kind: 'task' as const,
      text: normalize(`${name} tarefa ${id}`),
    })),
    ...idx.pages.map((p) => ({
      title: p.name,
      hint: p.path ? `/${p.path}` : '/',
      href: `${idx.base}${p.path}`,
      kind: 'page' as const,
      text: normalize(`${p.name} ${p.description}`),
    })),
  ];
}

async function loadItems() {
  if (itemsLoaded) return;
  itemsLoaded = true;
  const idx = readJSON<Index>('cmdk-index');
  try {
    const res = await fetch(`${idx.base}itens/index.json`);
    const list = (await res.json()) as { id: string; track: string; task: string; prompt: string; ref: string }[];
    entries!.push(
      ...list.map((i) => ({
        title: i.prompt,
        hint: `${i.track} · ${i.ref}`,
        href: `${idx.base}explorador/?item=${encodeURIComponent(i.id)}`,
        kind: 'item' as const,
        text: normalize(`${i.prompt} ${i.ref} ${i.id} ${idx.tasks[i.task] || ''}`),
      })),
    );
  } catch {
    itemsLoaded = false;
  }
}

function search(q: string) {
  const terms = normalize(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return entries!.filter((e) => e.kind !== 'item' && e.kind !== 'task').slice(0, 14);
  const hits = entries!.filter((e) => terms.every((t) => e.text.includes(t)));
  const order = { run: 0, track: 1, task: 2, page: 3, item: 4 };
  return hits.sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 40);
}

export function openPalette() {
  if (root) return;
  entries ||= base();
  const returnTo = document.activeElement as HTMLElement | null;
  const input = h('input', {
    type: 'text',
    placeholder: 'Buscar páginas, modelos, trilhas e itens',
    'aria-label': 'Buscar no Teor',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'cmdk-list',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const list = h('div', { class: 'cmdk-list', role: 'listbox', id: 'cmdk-list', 'aria-label': 'Resultados' });
  const box = h(
    'div',
    { class: 'cmdk-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Busca rápida' },
    h('div', { class: 'cmdk-input' }, icon('search', 18), input, h('kbd', null, 'esc')),
    list,
    h(
      'div',
      { class: 'cmdk-foot' },
      h('span', null, h('kbd', null, '↑'), h('kbd', null, '↓'), 'navegar'),
      h('span', null, h('kbd', null, '↵'), 'abrir'),
      h('span', { style: 'margin-left:auto' }, 'Itens carregam ao digitar'),
    ),
  );
  const scrim = h('div', { class: 'cmdk-scrim' });
  root = h('div', { class: 'cmdk' }, scrim, box);
  document.body.append(root);
  input.focus();
  let active = 0;
  let results: Entry[] = [];

  function render() {
    results = search(input.value);
    active = Math.min(active, Math.max(0, results.length - 1));
    list.replaceChildren(
      ...results.map((r, i) =>
        h(
          'a',
          {
            class: 'cmdk-item',
            href: r.href,
            role: 'option',
            id: `cmdk-${i}`,
            'aria-selected': String(i === active),
            'data-active': i === active ? '' : null,
            onpointermove: () => setActive(i, false),
          },
          icon(iconFor[r.kind], 18),
          h('span', { class: 't' }, r.title),
          h('span', { class: 'k' }, r.kind === 'item' ? r.hint : kindLabel[r.kind]),
        ),
      ),
    );
    if (!results.length)
      list.append(h('div', { class: 'opt-empty' }, itemsLoaded ? 'Nada encontrado. Tente outro termo.' : 'Procurando nos itens…'));
    input.setAttribute('aria-activedescendant', results.length ? `cmdk-${active}` : '');
  }
  function setActive(i: number, scroll = true) {
    active = i;
    list.querySelectorAll('.cmdk-item').forEach((el, j) => {
      el.toggleAttribute('data-active', j === i);
      el.setAttribute('aria-selected', String(j === i));
      if (j === i && scroll) scrollWithin(list, el as HTMLElement);
    });
    input.setAttribute('aria-activedescendant', `cmdk-${i}`);
  }
  function close() {
    root?.remove();
    root = null;
    returnTo?.focus?.();
  }
  input.addEventListener('input', async () => {
    active = 0;
    render();
    if (input.value.trim().length > 1 && !itemsLoaded) {
      await loadItems();
      render();
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(results.length - 1, active + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(0, active - 1));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      location.href = results[active].href;
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') e.preventDefault();
  });
  scrim.addEventListener('click', close);
  render();
}
