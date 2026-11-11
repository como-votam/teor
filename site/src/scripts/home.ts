import { $, $$, h, readJSON, swap, reducedMotion, icon, pct } from './ui/core';
import { openSheet, mountSeen } from './ui/controls';
import { forestHTML, seriesColor, tipData } from '../lib/charts';
import type { ClientPayload } from '../data/derived';

const base = (document.querySelector('[data-logo]') as HTMLAnchorElement | null)?.getAttribute('href') || '/';

// ── Espécime do hero ────────────────────────────────────────────────────────
const specimen = $('[data-specimen]');
if (specimen) {
  const list = readJSON<
    {
      track: string;
      task: string;
      chamber: string;
      ref: string;
      url: string;
      host: string;
      prompt: string;
      context: string;
      answer: string[];
      model: string;
    }[]
  >('specimens');
  const body = $('.specimen-body', specimen)!;
  const bar = $('.specimen-progress', specimen)!;
  const dots = $$<HTMLButtonElement>('[data-go]', specimen);
  const slot = (k: string) => $$(`[data-s="${k}"]`, specimen);
  let index = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const DURATION = 7000;

  const show = (i: number) => {
    index = (i + list.length) % list.length;
    const s = list[index];
    slot('track').forEach((el) => (el.textContent = s.track));
    slot('task').forEach((el) => (el.textContent = s.task));
    slot('chamber').forEach((el) => (el.textContent = s.chamber));
    slot('ref').forEach((el) => (el.textContent = s.ref));
    slot('prompt').forEach((el) => (el.textContent = s.prompt));
    slot('context').forEach((el) => (el.textContent = s.context));
    slot('model').forEach((el) => (el.textContent = s.model));
    slot('host').forEach((el) => (el.textContent = s.host));
    slot('url').forEach((el) => el.setAttribute('href', s.url));
    slot('answer').forEach((el) => el.replaceChildren(...s.answer.map((a) => h('span', { class: 'answer-token' }, a))));
    dots.forEach((d, j) => d.setAttribute('aria-current', String(j === index)));
    swap(body);
    restart();
  };
  // O avanço segue o fim da animação da barra, então pausar no hover pausa os dois.
  const restart = () => {
    clearTimeout(timer);
    if (reducedMotion()) return;
    bar.removeAttribute('data-run');
    void bar.offsetWidth;
    bar.setAttribute('data-run', '');
  };
  bar.addEventListener('animationend', () => show(index + 1));
  dots.forEach((d, j) => d.addEventListener('click', () => show(j)));
  specimen.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') show(index + 1);
    if (e.key === 'ArrowLeft') show(index - 1);
  });
  // Só gira enquanto está visível.
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting) restart();
    else bar.removeAttribute('data-run');
  }).observe(specimen);
}

// ── Matriz ──────────────────────────────────────────────────────────────────
const payload = readJSON<ClientPayload>('payload');
const matrix = $<HTMLTableElement>('.matrix');
if (matrix && payload) {
  $('[data-matrix-chamber]')?.addEventListener('seg', (e) => {
    const value = (e as CustomEvent).detail.value;
    $$<HTMLElement>('tbody[data-chamber]', matrix).forEach((tb) => (tb.hidden = tb.dataset.chamber !== value));
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
    const rows = [
      ['execucao', 'modelo', 'tipo', 'trilha', 'tarefa', 'casa', 'modo', 'metrica', 'media', 'ic95_min', 'ic95_max', 'n', 'familias', 'melhor_referencia'],
    ];
    for (const s of payload.slices)
      for (const r of payload.runs) {
        const c = s.cells[r.id];
        if (!c) continue;
        rows.push([r.id, r.model, r.kind, s.track, s.task, s.chamber, s.mode, s.metric, String(c.mean), String(c.low), String(c.high), String(c.n), String(c.families), String(s.floor ?? '')]);
      }
    const csv = rows.map((r) => r.map(cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: 'teor-fatias.csv' });
    a.click();
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
    h('p', { class: 'eyebrow' }, `Trilha ${track[0]} · ${track[1]}`),
    h(
      'p',
      { class: 'fine', style: 'margin-top:10px' },
      `${payload.chamberNames[s.chamber]} · ${payload.modeNames[s.mode]} · ${n} respostas por execução em ${fam} ${fam === 1 ? 'família' : 'famílias'}.`,
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
    h(
      'p',
      { class: 'fine', style: 'margin-top:20px' },
      'Os traços finos sobre cada ponto são as médias por variante de prompt: quanto mais espalhados, mais a resposta depende da redação.',
    ),
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
const tracks = readJSON<
  { id: string; name: string; desc: string; n: number; question: string; method: string; limitation: string; example: string }[]
>('track-payload');
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
  if (seg) {
    selectTrack(seg.dataset.track!);
    tabs.find((t) => t.dataset.track === seg.dataset.track)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
});
if (tabs.length) {
  composition?.setAttribute('data-focus', '');
  $$('[data-track]', composition!).forEach((el, i) => el.toggleAttribute('data-on', i === 0));
}

// ── Pipeline ────────────────────────────────────────────────────────────────
const pipeline = readJSON<{ title: string; code: string[][] }[]>('pipeline');
const steps = $$<HTMLButtonElement>('.step');
const term = $('[data-term]');
function selectStep(i: number, focus = false) {
  const p = pipeline[i];
  if (!p || !term) return;
  steps.forEach((s, j) => {
    s.setAttribute('aria-selected', String(i === j));
    s.tabIndex = i === j ? 0 : -1;
    if (i === j && focus) s.focus();
  });
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
steps.forEach((s, i) => {
  s.addEventListener('click', () => selectStep(i));
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
  tagline.replaceChildren(
    ...words.flatMap((w, i) => [h('span', { class: 'w', 'aria-hidden': 'true' }, w), i < words.length - 1 ? ' ' : '']),
  );
  const spans = $$('.w', tagline);
  if (reducedMotion() || !('IntersectionObserver' in window)) tagline.setAttribute('data-static', '');
  else {
    // Uma linha de gatilho a 62% da altura: cada palavra acende quando a cruza.
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
            e.target.classList.remove('is-on');
          });
      },
      { rootMargin: '0px 0px -38% 0px', threshold: 1 },
    );
    spans.forEach((s) => io.observe(s));
  }
}
