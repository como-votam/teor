// Gráficos em HTML puro. A mesma função roda no build (Astro, set:html) e no navegador,
// então todo texto passa por esc(): nada de dado vira marcação.
export const esc = (v: unknown) =>
  String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const fmt = (v: number) =>
  `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const at = (v: number) => `${(clamp(v) * 100).toFixed(2)}%`;

export const seriesColor = (slot: number | null) =>
  slot === null ? 'var(--series-ref)' : `var(--series-${(slot % 4) + 1})`;

export interface ForestPoint {
  mean: number;
  low: number;
  high: number;
  color: string;
  /** Referência: ponto vazado, em cinza. */
  ref?: boolean;
  /** Abertura de um dumbbell: ponto vazado na cor da série. */
  hollow?: boolean;
  variants?: number[];
  name?: string;
}
export interface ForestRow {
  label: string;
  sub?: string;
  group?: string;
  points: ForestPoint[];
  floor?: number | null;
  value?: string;
  /** Linha entre os dois primeiros pontos (dumbbell). */
  connect?: boolean;
  tip?: string;
  href?: string;
  note?: string;
  /** Destaca a linha (ex.: intervalos que não se sobrepõem). */
  strong?: boolean;
}

export function forestHTML(rows: ForestRow[], opts: { labelWidth?: string; ticks?: number[]; animate?: boolean } = {}) {
  const ticks = opts.ticks || [0, 0.25, 0.5, 0.75, 1];
  let group: string | undefined;
  let i = 0;
  const body = rows
    .map((row) => {
      const head =
        row.group && row.group !== group ? ((group = row.group), `<div class="forest-group">${esc(row.group)}</div>`) : '';
      const grid = ticks
        .slice(1, -1)
        .map((t) => `<span class="forest-grid" style="left:${at(t)}"></span>`)
        .join('');
      const floor =
        row.floor !== undefined && row.floor !== null
          ? `<span class="forest-floor" style="left:${at(row.floor)}" title="Melhor referência: ${esc(fmt(row.floor))}"></span>`
          : '';
      const line =
        row.connect && row.points.length >= 2
          ? `<span class="dumb-line" style="left:${at(Math.min(row.points[0].mean, row.points[1].mean))};width:${(
              Math.abs(row.points[1].mean - row.points[0].mean) * 100
            ).toFixed(2)}%;--i:${i}"></span>`
          : '';
      const marks = row.points
        .map((p) => {
          const ci = `<span class="forest-ci" style="left:${at(p.low)};width:${((clamp(p.high) - clamp(p.low)) * 100).toFixed(
            2,
          )}%;--c:${p.color};--i:${i}"></span>`;
          const vars = (p.variants || [])
            .map((v) => `<span class="forest-var" style="left:${at(v)};--c:${p.color};--i:${i}"></span>`)
            .join('');
          const cls = p.ref ? 'forest-pt forest-pt--ref' : p.hollow ? 'forest-pt dumb-a' : 'forest-pt';
          return `${row.connect ? '' : ci}${vars}<span class="${cls}" style="left:${at(p.mean)};--c:${p.color};--i:${i}"></span>`;
        })
        .join('');
      const aria = `${row.label}${row.sub ? `, ${row.sub}` : ''}: ${row.points
        .map((p) => `${p.name ? `${p.name} ` : ''}${fmt(p.mean)} (IC 95% ${fmt(p.low)} a ${fmt(p.high)})`)
        .join('; ')}${row.floor !== undefined && row.floor !== null ? `; melhor referência ${fmt(row.floor)}` : ''}`;
      const label = row.href
        ? `<a class="forest-label" href="${esc(row.href)}" aria-label="${esc(aria)}">${esc(row.label)}${row.sub ? ` <small>${esc(row.sub)}</small>` : ''}</a>`
        : `<div class="forest-label">${esc(row.label)}${row.sub ? ` <small>${esc(row.sub)}</small>` : ''}</div>`;
      // Com link, o próprio link carrega a descrição e recebe o foco; sem link, a linha é a imagem.
      const roleAttrs = row.href ? 'role="group"' : `tabindex="0" role="img" aria-label="${esc(aria)}"`;
      const html = `${head}<div class="forest-row${row.strong ? ' forest-row--strong' : ''}" ${roleAttrs}${
        row.tip ? ` data-tip="${esc(row.tip)}"` : ''
      }>${label}<div class="forest-track">${grid}${floor}${line}${marks}</div><div class="forest-val"${row.strong === false ? ' data-dim' : ''}>${esc(
        row.value ?? fmt(row.points[0]?.mean ?? 0),
      )}</div></div>`;
      i = Math.min(i + 1, 24);
      return html;
    })
    .join('');
  const axis = ticks
    .map((t) => `<span style="left:${at(t)}">${Math.round(t * 100)}${t === 1 ? '%' : ''}</span>`)
    .join('');
  return `<div class="forest" data-seen="${opts.animate === false ? 'true' : 'false'}" style="--label-w:${esc(
    opts.labelWidth || '38%',
  )}"><div class="forest-row forest-row--axis" aria-hidden="true"><span></span><div class="forest-axis">${axis}</div><span></span></div>${body}</div>`;
}

/** Texto de tooltip estruturado (renderizado com textContent no cliente). */
export function tipData(t: string, v: string, rows: [string, string, string?][] = [], s?: string) {
  return JSON.stringify({ t, v, rows, s });
}
