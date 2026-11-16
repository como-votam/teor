// Hemiciclo em canvas, no desenho do Como Votam (congresso-hemicycle.tsx): uma matriz uniforme de
// assentos em arcos concêntricos. A quantidade de pontos depende da tela, não do dataset. Trocar de
// arranjo recolore os assentos com uma varredura da esquerda para a direita: cada grupo ocupa uma
// faixa contígua do arco, como as bancadas num plenário.

import { CENTER, SEAT_R, VIEW_W, seatBudget, seatMatrix, sampleSeats, type SeatSample } from './hemicycle-model';
export { VIEW_W, VIEW_H } from './hemicycle-model';

const ENTRY_MS = 640;
const ENTRY_FEATHER = 22;
const RECOLOR_MS = 260;
const RECOLOR_SPREAD = 520;

type Rgb = readonly [number, number, number];
const NAVY: Rgb = [27, 49, 80];
const SLATE: Rgb = [88, 114, 144];
const MIST: Rgb = [180, 192, 207];
const PAPER: Rgb = [249, 249, 251];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Cor de um grupo numa rampa contínua de tinta a névoa: grupos vizinhos nunca repetem tom. */
export function tone(g: number, groups: number): Rgb {
  if (groups <= 1) return NAVY;
  const t = g / (groups - 1);
  return t < 0.5 ? mix(NAVY, SLATE, t * 2) : mix(SLATE, MIST, (t - 0.5) * 2);
}
export const toneCss = (g: number, groups: number) => `rgb(${tone(g, groups).map((v) => Math.round(v)).join(',')})`;

export interface Mode {
  key: string;
  /** Grupo de cada item (índice em `groups`). */
  groupOf: number[];
  groups: number;
  /** Profundidade (tinta no centro, névoa nas bordas) em vez de cores por grupo. */
  depth?: boolean;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - (1 - t) ** 3;

export function createHemicycle(canvas: HTMLCanvasElement, count: number, onLayout?: (points: number) => void) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !count) return null;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let cssWidth = canvas.getBoundingClientRect().width;
  let seats = seatMatrix(Math.min(count, seatBudget(cssWidth)));
  let rows = Math.max(1, ...seats.map((s) => s.row));
  // Atraso de cada assento na varredura: proporcional à posição no arco, da esquerda para a direita.
  let sweep = Float32Array.from(seats, (s) => (180 - s.angle) / 180);

  let mode: Mode | null = null;
  let highlight: number | null = null;
  let samples: SeatSample[] = [];
  let seatOf = new Map<number, number>();
  let cur = new Float32Array(seats.length * 3);
  let from = new Float32Array(seats.length * 3);
  let target = new Float32Array(seats.length * 3);
  // Reuse at most the four arrangements at the current screen density.
  const cache = new Map<Mode, SeatSample[]>();
  let recolorStart = -Infinity;
  let spread = RECOLOR_SPREAD;
  let entryStart = performance.now();
  let started = false;
  let raf = 0;
  let visible = false;

  /** Grupos em sequência pelo arco: o grupo 0 nos primeiros assentos, o 1 nos seguintes, e assim por diante. */
  function assign(m: Mode) {
    let next = cache.get(m);
    if (!next) {
      next = sampleSeats(m.groupOf, m.groups, seats.length);
      cache.set(m, next);
    }
    samples = next;
    seatOf = new Map(samples.map((sample, seat) => [sample.item, seat]));
  }
  function colors(m: Mode) {
    const out = new Float32Array(seats.length * 3);
    for (let s = 0; s < seats.length; s++) {
      const g = samples[s].group;
      let rgb = m.depth ? mix(NAVY, MIST, (seats[s].row / rows) * 0.34) : tone(g, m.groups);
      if (highlight !== null && g !== highlight) rgb = mix(rgb, PAPER, 0.8);
      out.set(rgb, s * 3);
    }
    return out;
  }

  function draw(now: number) {
    if (!started || !visible || !mode) return false;
    const k = canvas.width / VIEW_W;
    ctx!.setTransform(1, 0, 0, 1, 0, 0);
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    ctx!.setTransform(k, 0, 0, k, 0, 0);
    const entry = reduce || !started ? (started ? 1 : 0) : clamp01((now - entryStart) / ENTRY_MS);
    const reach = easeOut(entry) * (180 + ENTRY_FEATHER);
    let moving = entry < 1;
    for (let s = 0; s < seats.length; s++) {
      const alpha = clamp01((reach - sweep[s] * 180) / ENTRY_FEATHER);
      if (alpha <= 0) continue;
      const t = reduce ? 1 : clamp01((now - recolorStart - sweep[s] * spread) / RECOLOR_MS);
      if (t < 1) moving = true;
      const e = easeOut(t);
      const r = from[s * 3] + (target[s * 3] - from[s * 3]) * e;
      const g = from[s * 3 + 1] + (target[s * 3 + 1] - from[s * 3 + 1]) * e;
      const b = from[s * 3 + 2] + (target[s * 3 + 2] - from[s * 3 + 2]) * e;
      cur[s * 3] = r;
      cur[s * 3 + 1] = g;
      cur[s * 3 + 2] = b;
      ctx!.globalAlpha = alpha;
      ctx!.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx!.beginPath();
      ctx!.arc(CENTER + seats[s].x, CENTER + seats[s].y, SEAT_R * (0.6 + 0.4 * alpha), 0, Math.PI * 2);
      ctx!.fill();
    }
    ctx!.globalAlpha = 1;
    return moving;
  }
  function frame(now: number) {
    raf = 0;
    if (draw(now)) raf = requestAnimationFrame(frame);
  }
  const schedule = () => {
    if (started && visible && !raf) raf = requestAnimationFrame(frame);
  };
  function resize() {
    const r = canvas.getBoundingClientRect();
    cssWidth = r.width;
    const size = Math.min(count, seatBudget(cssWidth));
    if (size !== seats.length) {
      seats = seatMatrix(size);
      rows = Math.max(1, ...seats.map((s) => s.row));
      sweep = Float32Array.from(seats, (s) => (180 - s.angle) / 180);
      cur = new Float32Array(size * 3);
      cache.clear();
      if (mode) { assign(mode); recolor(true); }
    }
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    onLayout?.(seats.length);
    schedule();
  }
  new ResizeObserver(resize).observe(canvas);

  /** Recolore a partir da cor atual de cada assento, então trocar no meio da varredura não dá salto. */
  function recolor(instant = false) {
    if (!mode) return;
    target = colors(mode);
    from = instant ? target.slice() : cur.slice();
    if (instant) cur.set(target);
    recolorStart = instant ? -Infinity : performance.now();
    spread = RECOLOR_SPREAD;
    schedule();
  }

  return {
    setMode(next: Mode) {
      const first = !mode;
      mode = next;
      highlight = null;
      assign(next);
      recolor(first);
      onLayout?.(seats.length);
    },
    /** Começa a varredura de entrada (quando o hemiciclo aparece na tela). */
    start() {
      visible = true;
      if (!started) { started = true; entryStart = performance.now(); }
      schedule();
    },
    /** Pause outside the viewport and in background tabs. Resume without replaying entry. */
    setVisible(next: boolean) {
      visible = next;
      if (!visible) { cancelAnimationFrame(raf); raf = 0; }
      else {
        if (!started) { started = true; entryStart = performance.now(); }
        schedule();
      }
    },
    /** Number of questions represented by the point that opens this example. */
    represented(item: number) {
      const seat = seatOf.get(item);
      return seat === undefined ? 0 : samples[seat].weight;
    },
    highlight(group: number | null) {
      if (!mode || group === highlight) return;
      highlight = group;
      // Destaque é resposta direta ao ponteiro: sem varredura, só uma transição curta e igual para todos.
      target = colors(mode!);
      from = cur.slice();
      recolorStart = performance.now();
      spread = 0;
      schedule();
    },
    /** Item sob um ponto do canvas (px CSS), ou -1. */
    hit(x: number, y: number) {
      if (!cssWidth) return -1;
      const k = cssWidth / VIEW_W;
      const vx = x / k - CENTER;
      const vy = y / k - CENTER;
      let best = -1;
      let dist = (SEAT_R * 2.4) ** 2;
      for (let s = 0; s < seats.length; s++) {
        const d = (seats[s].x - vx) ** 2 + (seats[s].y - vy) ** 2;
        if (d < dist) {
          dist = d;
          best = s;
        }
      }
      return best < 0 ? -1 : samples[best].item;
    },
    /** Posição de um item em px CSS dentro do canvas. */
    at(item: number) {
      const k = cssWidth / VIEW_W;
      const index = seatOf.get(item);
      if (index === undefined) return null;
      const s = seats[index];
      return { x: (CENTER + s.x) * k, y: (CENTER + s.y) * k };
    },
  };
}
