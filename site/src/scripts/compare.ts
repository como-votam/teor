import { $, h, readJSON, pct, pp } from './ui/core';
import { createSelect } from './ui/select';
import { mountSeen } from './ui/controls';
import { forestHTML, tipData } from '../lib/charts';
import type { ClientPayload } from '../data/derived';

const root = $('[data-compare]');
if (root) {
  const p = readJSON<ClientPayload>('payload');
  const COLORS = { a: 'var(--series-1)', b: 'var(--series-2)' };
  const params = new URLSearchParams(location.search);
  const byId = (id: string | null) => p.runs.find((r) => r.id === id);

  // Padrão: os dois modelos mais fortes. Referências só entram se alguém escolher.
  const ranked = p.runs.filter((r) => r.kind === 'model').sort((x, y) => y.order - x.order);
  let a = byId(params.get('a'))?.id || ranked[0]?.id || p.runs[0].id;
  let b = byId(params.get('b'))?.id || ranked.find((r) => r.id !== a)?.id || p.runs.find((r) => r.id !== a)!.id;
  if (a === b) b = p.runs.find((r) => r.id !== a)!.id;
  let chamber = '';
  let sort = 'track';

  const options = p.runs.map((r) => ({
    value: r.id,
    label: r.label,
    hint: r.kind === 'baseline' ? 'Referência determinística' : `${r.org} · ${r.provider}`,
    group: r.kind === 'baseline' ? 'Referências' : 'Modelos',
  }));
  const pickA = createSelect({ label: 'Execução A', options, value: a, searchable: true, onChange: (v) => set(v, b) });
  const pickB = createSelect({ label: 'Execução B', options, value: b, searchable: true, align: 'end', onChange: (v) => set(a, v) });
  $('[data-pick="a"]', root)!.replaceChildren(pickA.el);
  $('[data-pick="b"]', root)!.replaceChildren(pickB.el);

  function set(nextA: string, nextB: string) {
    if (nextA === nextB) [nextA, nextB] = [nextB === a ? b : a, nextB];
    if (nextA === nextB) nextB = p.runs.find((r) => r.id !== nextA)!.id;
    a = nextA;
    b = nextB;
    pickA.set(a);
    pickB.set(b);
    const url = new URL(location.href);
    url.searchParams.set('a', a);
    url.searchParams.set('b', b);
    history.replaceState(null, '', url);
    render();
  }
  $('[data-swap]', root)!.addEventListener('click', () => set(b, a));
  $('[data-cmp-chamber]', root)!.addEventListener('seg', (e) => {
    chamber = (e as CustomEvent).detail.value;
    render();
  });
  $('[data-cmp-sort]', root)!.addEventListener('seg', (e) => {
    sort = (e as CustomEvent).detail.value;
    render();
  });

  // Fatos de cada lado: provedor e o que importa para quem roda (cobertura, latência, tokens).
  function facts(id: string) {
    const r = byId(id)!;
    const row = (k: string, v: string) => [h('div', null, h('dt', null, k), h('dd', null, v))];
    return [
      ...row('Provedor', r.kind === 'baseline' ? 'Referência' : r.provider),
      ...row('Cobertura', pct(r.coverage)),
      ...row('Latência', r.latency === null ? '—' : `${r.latency.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} s`),
      ...row('Tokens', r.tokensIn ? new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(r.tokensIn + r.tokensOut) : '—'),
      h('div', null, h('dd', null, h('a', { class: 'link', href: `${base()}modelos/${r.slug}/` }, 'Perfil completo'))),
    ];
  }
  const base = () => (document.querySelector('[data-logo]') as HTMLAnchorElement).getAttribute('href') || '/';

  function render() {
    const ra = byId(a)!;
    const rb = byId(b)!;
    $('[data-facts="a"]', root)!.replaceChildren(...facts(a));
    $('[data-facts="b"]', root)!.replaceChildren(...facts(b));
    $('[data-cmp-legend]', root)!.replaceChildren(
      h('span', null, h('span', { class: 'swatch', style: `--c:${COLORS.a}` }), ra.label),
      h('span', null, h('span', { class: 'swatch', style: `--c:${COLORS.b}` }), rb.label),
      h('span', null, h('span', { class: 'ci' }), 'IC 95%'),
    );
    const shared = p.slices.filter((s) => !s.experimental && s.cells[a] && s.cells[b] && (!chamber || s.chamber === chamber));
    let aWins = 0;
    let bWins = 0;
    const rows = shared.map((s) => {
      const ca = s.cells[a];
      const cb = s.cells[b];
      const diff = ca.mean - cb.mean;
      const sep = ca.low > cb.high || cb.low > ca.high;
      if (sep && diff > 0) aWins++;
      if (sep && diff < 0) bWins++;
      const track = p.tracks.find((t) => t[0] === s.track)!;
      return {
        diff,
        row: {
          group: sort === 'track' ? `${track[0]} · ${track[1]}` : undefined,
          label: p.taskNames[s.task] || s.task,
          sub: `${p.chamberNames[s.chamber]} · ${p.modeNames[s.mode]}`,
          strong: sep,
          value: pp(diff),
          points: [
            { mean: cb.mean, low: cb.low, high: cb.high, color: COLORS.b, name: rb.label },
            { mean: ca.mean, low: ca.low, high: ca.high, color: COLORS.a, name: ra.label },
          ],
          tip: tipData(`${p.taskNames[s.task] || s.task} · ${p.chamberNames[s.chamber]}`, pp(diff), [
            [ra.label, `${pct(ca.mean)} (${pct(ca.low, 0)}–${pct(ca.high, 0)})`, COLORS.a],
            [rb.label, `${pct(cb.mean)} (${pct(cb.low, 0)}–${pct(cb.high, 0)})`, COLORS.b],
          ], sep ? 'Intervalos separados.' : 'Intervalos se sobrepõem: sem diferença demonstrada.'),
        },
      };
    });
    if (sort === 'diff') rows.sort((x, y) => y.diff - x.diff);
    const chart = $('[data-cmp-chart]', root)!;
    if (!rows.length) {
      chart.replaceChildren(h('div', { class: 'empty-state' }, h('h3', null, 'Nenhuma fatia em comum'), h('p', null, 'As duas execuções não têm tarefas avaliadas nesta casa.')));
    } else {
      chart.innerHTML = forestHTML(rows.map((r) => r.row), { labelWidth: '36%' });
      mountSeen(chart);
    }
    // Placar em cabo de guerra: A puxa da esquerda, B da direita, o meio é o que o benchmark não separa.
    const overlap = rows.length - aWins - bWins;
    const side = (n: number, who: string, color: string, align: string) =>
      h(
        'div',
        { class: `tug-side tug-${align}` },
        h('span', { class: 'tug-n' }, String(n)),
        h('span', { class: 'tug-cap' }, h('span', { class: 'swatch', style: `--c:${color}` }), `${who} acima`),
      );
    $('[data-verdicts]', root)!.replaceChildren(
      h(
        'div',
        { class: 'tug-head' },
        side(aWins, ra.label, COLORS.a, 'start'),
        h('div', { class: 'tug-side tug-center' }, h('span', { class: 'tug-n' }, String(overlap)), h('span', { class: 'tug-cap' }, 'sem diferença demonstrada')),
        side(bWins, rb.label, COLORS.b, 'end'),
      ),
      h(
        'div',
        { class: 'tug-bar', role: 'img', 'aria-label': `${aWins} fatias com ${ra.label} acima, ${overlap} sobrepostas, ${bWins} com ${rb.label} acima, de ${rows.length}` },
        h('i', { class: 'tug-a', style: `flex-grow:${aWins}` }),
        h('i', { class: 'tug-o', style: `flex-grow:${overlap}` }),
        h('i', { class: 'tug-b', style: `flex-grow:${bWins}` }),
      ),
      h('p', { class: 'tug-note' }, `De ${rows.length} fatias em comum. Só conta como acima quando os intervalos de confiança de 95% não se tocam.`),
    );
  }
  render();
}
