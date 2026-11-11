import { $, $$, h, readJSON, swap, reducedMotion, icon, pct } from './ui/core';
import { openSheet, mountSeen, showTip, hideTip } from './ui/controls';
import { createSelect } from './ui/select';
import { createHemicycle, toneCss, VIEW_W, VIEW_H, type Mode } from './ui/hemicycle';
import { forestHTML, seriesColor, tipData } from '../lib/charts';
import type { ClientPayload } from '../data/derived';

const base = (document.querySelector('[data-logo]') as HTMLAnchorElement | null)?.getAttribute('href') || '/';

// ── Hemiciclo do hero ───────────────────────────────────────────────────────
interface Group {
  id: string;
  name: string;
  n: number;
}
interface HemiData {
  items: [number, number, number][];
  tracks: Group[];
  chambers: Group[];
  modes: Group[];
  taskNames: Record<string, string>;
  trackNames: Record<string, string>;
  chamberNames: Record<string, string>;
  modeNames: Record<string, string>;
}
const hemi = $('[data-hemi]');
if (hemi) {
  const data = readJSON<HemiData>('hemi-data');
  const canvas = $<HTMLCanvasElement>('[data-hemi-canvas]', hemi)!;
  canvas.style.aspectRatio = `${VIEW_W} / ${VIEW_H}`;
  const engine = createHemicycle(canvas, data.items.length);
  const valueEl = $('[data-hemi-value]', hemi)!;
  const captionEl = $('[data-hemi-caption]', hemi)!;
  const legend = $('[data-hemi-legend]', hemi)!;
  const probe = $('[data-hemi-probe]', hemi)!;
  const total = data.items.length.toLocaleString('pt-BR');
  const modes: Record<string, { mode: Mode; value: string; caption: string; groups: Group[] }> = {
    items: { mode: { key: 'items', groupOf: data.items.map(() => 0), groups: 1, depth: true }, value: total, caption: 'perguntas, uma por assento', groups: [] },
    tracks: { mode: { key: 'tracks', groupOf: data.items.map((i) => i[0]), groups: data.tracks.length }, value: String(data.tracks.length), caption: 'trilhas, uma capacidade em cada', groups: data.tracks },
    chambers: {
      mode: { key: 'chambers', groupOf: data.items.map((i) => i[1]), groups: data.chambers.length },
      value: data.chambers.map((c) => c.n.toLocaleString('pt-BR')).join(' · '),
      caption: 'perguntas da Câmara e do Senado',
      groups: data.chambers,
    },
    modes: { mode: { key: 'modes', groupOf: data.items.map((i) => i[2]), groups: data.modes.length }, value: String(data.modes.length), caption: 'modos: com contexto, sem contexto e com ferramentas', groups: data.modes },
  };
  let current = 'items';
  let touched = false;

  const setMode = (key: string) => {
    const m = modes[key];
    if (!m || !engine) return;
    current = key;
    engine.setMode(m.mode);
    valueEl.textContent = m.value;
    captionEl.textContent = m.caption;
    swap(valueEl.parentElement!);
    legend.replaceChildren(
      ...m.groups.map((g, i) =>
        h(
          'button',
          {
            type: 'button',
            class: 'hemi-key',
            onpointerenter: () => engine.highlight(i),
            onpointerleave: () => engine.highlight(null),
            onfocus: () => engine.highlight(i),
            onblur: () => engine.highlight(null),
            onclick: () => {
              if (key === 'tracks') location.href = `${base}trilhas/${g.id.toLowerCase()}/`;
              else location.href = `${base}explorador/?${key === 'chambers' ? 'chamber' : 'mode'}=${g.id}`;
            },
          },
          h('span', { class: 'hemi-swatch', style: `background:${toneCss(i, m.groups.length)}` }),
          key === 'tracks' ? h('span', { class: 'mono' }, g.id) : null,
          h('span', null, g.name),
          h('span', { class: 'count' }, g.n.toLocaleString('pt-BR')),
        ),
      ),
    );
    $$<HTMLButtonElement>('[data-hemi-mode] button', hemi).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === key)));
    $('[data-hemi-mode]', hemi)?.dispatchEvent(new Event('seg-sync'));
  };
  setMode('items');

  // Aparece com a varredura quando entra na tela; depois alterna sozinho até alguém mexer.
  let hovering = false;
  let visible = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const order = Object.keys(modes);
  const cycle = () => {
    if (touched || hovering || !visible || document.hidden) return;
    setMode(order[(order.indexOf(current) + 1) % order.length]);
  };
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) engine?.start();
    if (visible && !timer && !reducedMotion()) timer = setInterval(cycle, 3800);
  }).observe(canvas);
  hemi.addEventListener('pointerenter', () => (hovering = true));
  hemi.addEventListener('pointerleave', () => (hovering = false));
  $('[data-hemi-mode]', hemi)?.addEventListener('seg', (e) => {
    touched = true;
    setMode((e as CustomEvent).detail.value);
  });

  // Hover num ponto: a pergunta real daquele assento. O índice de textos chega sob demanda.
  let prompts: { id: string; track: string; task: string; chamber: string; mode: string; prompt: string }[] | null = null;
  let loading = false;
  let hovered = -1;
  const load = () => {
    if (prompts || loading) return;
    loading = true;
    fetch(`${base}itens/index.json`)
      .then((r) => r.json())
      .then((list) => (prompts = list))
      .catch(() => (loading = false));
  };
  canvas.addEventListener('pointermove', (e) => {
    load();
    if (!engine || !prompts) return;
    const r = canvas.getBoundingClientRect();
    const i = engine.hit(e.clientX - r.left, e.clientY - r.top);
    canvas.style.cursor = i >= 0 ? 'pointer' : '';
    if (i === hovered) return;
    hovered = i;
    if (i < 0) return hideTip();
    const item = prompts[i];
    const at = engine.at(i);
    probe.style.left = `${at.x}px`;
    probe.style.top = `${at.y}px`;
    probe.setAttribute(
      'data-tip',
      tipData(
        `${item.track} · ${data.taskNames[item.task] || item.task} · ${data.chamberNames[item.chamber] || item.chamber}`,
        '',
        [],
        item.prompt.length > 180 ? `${item.prompt.slice(0, 177)}…` : item.prompt,
      ),
    );
    showTip(probe);
  });
  canvas.addEventListener('pointerleave', () => {
    hovered = -1;
    canvas.style.cursor = '';
    hideTip();
  });
  canvas.addEventListener('click', () => {
    if (hovered >= 0 && prompts) location.href = `${base}explorador/?item=${encodeURIComponent(prompts[hovered].id)}`;
  });
}

// ── Matriz ──────────────────────────────────────────────────────────────────
const payload = readJSON<ClientPayload>('payload');
const matrix = $<HTMLTableElement>('.matrix');
const MAX_COLS = 8;
if (matrix && payload) {
  const panel = $('[data-matrix-panel]')!;
  let selected = new Set(payload.featured);
  let provider = '';
  let track = '';
  let mode = '';

  const providers = [...new Set(payload.runs.map((r) => r.provider))];
  const runLabel = (id: string) => payload.runs.find((r) => r.id === id)?.label || id;

  function applyColumns() {
    $$<HTMLElement>('[data-col]', matrix!).forEach((el) => el.classList.toggle('off', !selected.has(el.dataset.col!)));
  }
  function applyRows() {
    $$<HTMLTableRowElement>('tbody tr.row', matrix!).forEach((tr) => {
      // Uma linha sem nenhum dado nas colunas escolhidas não informa nada: some junto.
      const empty = $$<HTMLElement>('td[data-col]', tr).every((td) => !selected.has(td.dataset.col!) || td.classList.contains('empty'));
      tr.hidden = empty || (!!track && tr.dataset.track !== track) || (!!mode && tr.dataset.mode !== mode);
    });
    $$<HTMLTableRowElement>('tbody tr.group', matrix!).forEach((tr) => {
      const rows = $$<HTMLTableRowElement>(`tr.row[data-track="${tr.dataset.track}"]`, tr.parentElement!);
      tr.hidden = rows.every((r) => r.hidden);
    });
  }

  // Colunas: pílulas removíveis com o que está na matriz e um painel para adicionar, com busca
  // e abas de provedor. No máximo sete colunas; o que passa disso fica desabilitado com o motivo.
  const chips = $('[data-run-chips]', panel)!;
  const pickHost = $('[data-pick-runs]', panel)!;
  const addBtn = h('button', { type: 'button', class: 'mx-add', 'aria-haspopup': 'true', 'aria-expanded': 'false' });
  const search = h('input', { type: 'text', placeholder: 'Buscar modelo', 'aria-label': 'Buscar execução', autocomplete: 'off', spellcheck: 'false' });
  const tabsEl = h('div', { class: 'mx-tabs', role: 'tablist', 'aria-label': 'Provedor' });
  const listEl = h('div', { class: 'mx-list', role: 'group', 'aria-label': 'Execuções' });
  const footEl = h('div', { class: 'mx-pop-foot' });
  const pop = h('div', { class: 'pop mx-pop', hidden: true, 'data-side': 'bottom' }, h('div', { class: 'pop-search' }, icon('search', 15), search), tabsEl, listEl, footEl);
  const pickWrap = h('div', { class: 'select' }, addBtn, pop);
  pickHost.replaceChildren(pickWrap);

  const swatchOf = (r: (typeof payload.runs)[number]) =>
    h('span', { class: r.kind === 'baseline' ? 'swatch swatch--ref' : 'swatch', style: r.kind === 'baseline' ? '' : `--c:${seriesColor(r.color)}` });
  const ordered = () => [...payload.runs].sort((a, b) => (a.kind !== b.kind ? (a.kind === 'model' ? -1 : 1) : b.order - a.order));

  function drawChips() {
    chips.replaceChildren(
      ...ordered()
        .filter((r) => selected.has(r.id))
        .map((r) =>
          h(
            'span',
            { class: 'mx-chip' },
            swatchOf(r),
            h('span', { class: 'mx-chip-name', title: r.label }, r.label),
            h(
              'button',
              {
                type: 'button',
                class: 'mx-chip-x',
                'aria-label': `Tirar ${r.label} da matriz`,
                disabled: selected.size <= 1 ? true : null,
                onclick: () => {
                  selected.delete(r.id);
                  update();
                },
              },
              icon('x', 12),
            ),
          ),
        ),
    );
    addBtn.replaceChildren(icon('plus', 14), selected.size >= MAX_COLS ? `Trocar (${selected.size}/${MAX_COLS})` : `Adicionar (${selected.size}/${MAX_COLS})`);
  }
  function drawPicker() {
    const q = search.value.trim().toLowerCase();
    tabsEl.replaceChildren(
      ...['', ...providers].map((pv) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: 'mx-tab',
            'aria-selected': String(provider === pv),
            onclick: () => {
              provider = pv;
              drawPicker();
            },
          },
          pv || 'Todos',
        ),
      ),
    );
    const list = ordered().filter((r) => (!provider || r.provider === provider) && (!q || `${r.label} ${r.provider}`.toLowerCase().includes(q)));
    listEl.replaceChildren(
      ...list.map((r) => {
        const on = selected.has(r.id);
        const full = !on && selected.size >= MAX_COLS;
        return h(
          'button',
          {
            type: 'button',
            class: 'opt',
            role: 'checkbox',
            'aria-checked': String(on),
            'aria-disabled': full ? 'true' : null,
            'data-run': r.id,
            onclick: () => {
              if (full) return;
              if (on) {
                if (selected.size <= 1) return;
                selected.delete(r.id);
              } else selected.add(r.id);
              update();
              listEl.querySelector<HTMLElement>(`[data-run="${r.id}"]`)?.focus({ preventScroll: true });
            },
          },
          h('span', { class: `check-box${on ? ' on' : ''}` }, on ? icon('check', 11) : null),
          swatchOf(r),
          h('span', { class: 'mx-opt-name' }, r.label),
          h('small', { class: 'mx-opt-hint' }, r.kind === 'baseline' ? 'referência' : r.provider),
        );
      }),
    );
    if (!list.length) listEl.append(h('div', { class: 'opt-empty' }, 'Nenhuma execução com esse filtro.'));
    footEl.replaceChildren(
      h('span', null, selected.size >= MAX_COLS ? `Limite de ${MAX_COLS} colunas. Desmarque uma para trocar.` : `${selected.size} de ${MAX_COLS} colunas`),
      h(
        'button',
        {
          type: 'button',
          class: 'link',
          onclick: () => {
            selected = new Set(payload.featured);
            update();
          },
        },
        'Restaurar destaque',
      ),
    );
  }
  const setPick = (open: boolean) => {
    pop.hidden = !open;
    addBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      search.value = '';
      drawPicker();
      search.focus({ preventScroll: true });
    }
  };
  addBtn.addEventListener('click', () => setPick(pop.hidden));
  search.addEventListener('input', drawPicker);
  document.addEventListener('pointerdown', (e) => {
    if (!pickWrap.contains(e.target as Node)) setPick(false);
  });
  pickWrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) {
      setPick(false);
      addBtn.focus();
    }
  });

  const trackSelect = createSelect({
    label: 'Trilha',
    value: '',
    options: [{ value: '', label: 'Todas' }, ...payload.tracks.map(([id, name]) => ({ value: id, label: `${id} · ${name}` }))],
    onChange: (v) => {
      track = v;
      applyRows();
    },
  });
  $('[data-pick-track]', panel)!.replaceChildren(trackSelect.el);

  function update() {
    applyColumns();
    applyRows();
    drawChips();
    if (!pop.hidden) drawPicker();
    matrix!.closest('.matrix-wrap')?.setAttribute('aria-label', `Matriz com ${[...selected].map(runLabel).join(', ')}`);
  }
  update();

  $('[data-matrix-chamber]')?.addEventListener('seg', (e) => {
    const value = (e as CustomEvent).detail.value;
    $$<HTMLElement>('tbody[data-chamber]', matrix).forEach((tb) => (tb.hidden = tb.dataset.chamber !== value));
  });
  $('[data-matrix-mode]')?.addEventListener('seg', (e) => {
    mode = (e as CustomEvent).detail.value;
    applyRows();
  });
  $('[data-matrix-view]')?.addEventListener('seg', (e) => {
    const value = (e as CustomEvent).detail.value;
    matrix.dataset.view = value;
    $$<HTMLElement>('[data-scale]').forEach((el) => (el.hidden = el.dataset.scale !== value));
  });
  matrix.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-slice]');
    if (btn) openSlice(btn.dataset.slice!);
  });

  $('[data-export]')?.addEventListener('click', () => {
    const cell = (v: unknown) => {
      const s = String(v ?? '');
      return `"${(/^[=+@-]/.test(s) ? "'" + s : s).replaceAll('"', '""')}"`;
    };
    const rows = [['execucao', 'modelo', 'tipo', 'trilha', 'tarefa', 'casa', 'modo', 'metrica', 'media', 'ic95_min', 'ic95_max', 'n', 'familias', 'melhor_referencia']];
    for (const s of payload.slices)
      for (const r of payload.runs) {
        const c = s.cells[r.id];
        if (!c || !selected.has(r.id)) continue;
        if ((track && s.track !== track) || (mode && s.mode !== mode)) continue;
        rows.push([r.id, r.model, r.kind, s.track, s.task, s.chamber, s.mode, s.metric, String(c.mean), String(c.low), String(c.high), String(c.n), String(c.families), String(s.floor ?? '')]);
      }
    const csv = rows.map((r) => r.map(cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
    h('a', { href: url, download: 'teor-fatias.csv' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

function openSlice(key: string) {
  const s = payload.slices.find((x) => x.key === key);
  if (!s) return;
  const track = payload.tracks.find((t) => t[0] === s.track)!;
  const ordered = [...payload.runs].sort((a, b) => (s.cells[b.id]?.mean ?? -1) - (s.cells[a.id]?.mean ?? -1));
  const rows = ordered
    .filter((r) => s.cells[r.id])
    .map((r) => {
      const c = s.cells[r.id];
      return {
        label: r.label,
        sub: r.kind === 'baseline' ? 'referência' : '',
        floor: s.floor,
        points: [{ mean: c.mean, low: c.low, high: c.high, color: seriesColor(r.color), ref: r.kind === 'baseline', variants: c.variants, name: r.label }],
        tip: tipData(r.label, pct(c.mean), [
          ['IC 95%', `${pct(c.low)} a ${pct(c.high)}`],
          ['Respostas', String(c.n)],
          ['Famílias', String(c.families)],
          ...(c.variants.length ? ([['Por variante de prompt', c.variants.map((v) => pct(v, 0)).join(' · ')]] as [string, string][]) : []),
        ]),
        href: `${base}modelos/${r.slug}/`,
      };
    });
  const chart = h('div');
  chart.innerHTML = forestHTML(rows, { labelWidth: '34%' });
  const n = Math.max(...Object.values(s.cells).map((c) => c.n));
  const fam = Math.min(...Object.values(s.cells).map((c) => c.families));
  const explore = `${base}explorador/?track=${s.track}&task=${s.task}&chamber=${s.chamber}&mode=${s.mode}`;
  const body = h(
    'div',
    null,
    h(
      'p',
      { class: 'fine' },
      `Trilha ${track[0]} · ${track[1]} · ${payload.chamberNames[s.chamber]} · ${payload.modeNames[s.mode]} · ${n} respostas por execução em ${fam} ${fam === 1 ? 'família' : 'famílias'}.`,
    ),
    h(
      'div',
      { class: 'legend', style: 'margin:22px 0 14px' },
      h('span', null, h('span', { class: 'swatch', style: '--c:var(--series-1)' }), 'Modelo'),
      h('span', null, h('span', { class: 'swatch swatch--ref' }), 'Referência'),
      h('span', null, h('span', { class: 'ci' }), 'IC 95%'),
      h('span', null, h('span', { class: 'tick' }), 'Melhor referência'),
    ),
    chart,
    fam < 5
      ? h(
          'div',
          { class: 'callout', style: 'margin-top:20px' },
          icon('warning', 18),
          h('span', null, 'Poucas famílias nesta fatia. O bootstrap reamostra famílias inteiras, então o intervalo fica estreito ou largo demais para sustentar uma comparação.'),
        )
      : null,
    h('p', { class: 'fine', style: 'margin-top:20px' }, 'Os traços finos sobre cada ponto são as médias por variante de prompt: quanto mais espalhados, mais a resposta depende da redação.'),
    h(
      'div',
      { style: 'display:flex;flex-wrap:wrap;gap:10px;margin-top:24px' },
      h('a', { class: 'btn btn--ink btn--sm', href: explore }, 'Ver os itens desta fatia', icon('arrowRight', 15)),
      h('a', { class: 'btn btn--outline btn--sm', href: `${base}trilhas/${s.track.toLowerCase()}/` }, 'Sobre a trilha'),
    ),
  );
  openSheet({ title: payload.taskNames[s.task] || s.task, body, wide: true });
  requestAnimationFrame(() => mountSeen(body));
}

// ── Trilhas ─────────────────────────────────────────────────────────────────
const tracks = readJSON<{ id: string; name: string; desc: string; n: number; question: string; method: string; limitation: string; example: string }[]>('track-payload');
const tabs = $$<HTMLButtonElement>('.track-row');
const detail = $('[data-track-body]');
const composition = $('[data-composition]');
function selectTrack(id: string, focus = false) {
  const t = tracks.find((x) => x.id === id);
  if (!t || !detail) return;
  tabs.forEach((tab) => {
    const on = tab.dataset.track === id;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    if (on && focus) tab.focus();
  });
  $('#track-panel')?.setAttribute('aria-labelledby', `tab-${id}`);
  const set = (k: string, v: string) => $$(`[data-t="${k}"]`, detail).forEach((el) => (el.textContent = v));
  set('id', t.id);
  set('name', t.name);
  set('question', t.question);
  set('method', t.method);
  set('limitation', t.limitation);
  set('example', t.example);
  $(`[data-t="explore"]`, detail)?.setAttribute('href', `${base}explorador/?track=${t.id}`);
  $(`[data-t="page"]`, detail)?.setAttribute('href', `${base}trilhas/${t.id.toLowerCase()}/`);
  swap(detail);
  if (composition) {
    composition.setAttribute('data-focus', '');
    $$('[data-track]', composition).forEach((el) => el.toggleAttribute('data-on', (el as HTMLElement).dataset.track === id));
  }
}
tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => selectTrack(tab.dataset.track!));
  tab.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    selectTrack(tabs[(i + d + tabs.length) % tabs.length].dataset.track!, true);
  });
});
composition?.addEventListener('click', (e) => {
  const seg = (e.target as Element).closest<HTMLElement>('[data-track]');
  if (seg) selectTrack(seg.dataset.track!);
});
if (tabs.length && composition) {
  composition.setAttribute('data-focus', '');
  $$('[data-track]', composition).forEach((el, i) => el.toggleAttribute('data-on', i === 0));
}

// ── Pipeline: o terminal acompanha o hover e o clique ───────────────────────
const pipeline = readJSON<{ title: string; code: string[][] }[]>('pipeline');
const steps = $$<HTMLButtonElement>('.step');
const term = $('[data-term]');
let currentStep = 0;
function selectStep(i: number, focus = false) {
  const p = pipeline[i];
  if (!p || !term) return;
  steps.forEach((s, j) => {
    s.setAttribute('aria-selected', String(i === j));
    s.tabIndex = i === j ? 0 : -1;
    if (i === j && focus) s.focus();
  });
  if (i === currentStep && term.childElementCount) return;
  currentStep = i;
  const code = h('code');
  for (const [k, line] of p.code) code.append(h('span', { class: k }, `${k === 'p' ? '$ ' : ''}${line}\n`));
  term.replaceChildren(code);
  swap(term);
  $('[data-term-title]')!.textContent = `teor · ${p.title.toLowerCase()}`;
  $('#term-cmds')!.textContent = p.code
    .filter(([k]) => k === 'p' || k === 'o')
    .map(([, l]) => l)
    .join('\n');
}
// Hover troca com uma pequena intenção (o ponteiro só de passagem não pisca o terminal).
let hoverTimer: ReturnType<typeof setTimeout>;
steps.forEach((s, i) => {
  s.addEventListener('click', () => selectStep(i));
  s.addEventListener('pointerenter', (e) => {
    if ((e as PointerEvent).pointerType !== 'mouse') return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => selectStep(i), 70);
  });
  s.addEventListener('pointerleave', () => clearTimeout(hoverTimer));
  s.addEventListener('focus', () => selectStep(i));
  s.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    selectStep((i + d + steps.length) % steps.length, true);
  });
});

// ── Tagline palavra por palavra ─────────────────────────────────────────────
const tagline = $('[data-tagline]');
if (tagline) {
  const words = (tagline.textContent || '').trim().split(/\s+/);
  tagline.setAttribute('aria-label', words.join(' '));
  tagline.replaceChildren(...words.flatMap((w, i) => [h('span', { class: 'w', 'aria-hidden': 'true' }, w), i < words.length - 1 ? ' ' : '']));
  const spans = $$('.w', tagline);
  if (reducedMotion() || !('IntersectionObserver' in window)) tagline.setAttribute('data-static', '');
  else {
    // Palavras da mesma linha cruzam juntas; o atraso em ordem de leitura as acende uma a uma.
    const io = new IntersectionObserver(
      (entries) => {
        const on = entries.filter((e) => e.isIntersecting).sort((a, b) => spans.indexOf(a.target as HTMLElement) - spans.indexOf(b.target as HTMLElement));
        on.forEach((e, k) => {
          (e.target as HTMLElement).style.transitionDelay = `${k * 70}ms`;
          e.target.classList.add('is-on');
        });
        entries
          .filter((e) => !e.isIntersecting && e.boundingClientRect.top > 0)
          .forEach((e) => {
            (e.target as HTMLElement).style.transitionDelay = '0ms';
            e.target.classList.toggle('is-on', false);
          });
      },
      { rootMargin: '0px 0px -38% 0px', threshold: 1 },
    );
    spans.forEach((s) => io.observe(s));
  }
}
