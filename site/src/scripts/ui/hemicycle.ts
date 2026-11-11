// Hemiciclo em canvas, no desenho do Como Votam (congresso-hemicycle.tsx): uma matriz uniforme de
// assentos em arcos concêntricos que nunca se mexe. Cada assento é um item do benchmark. Trocar de
// arranjo recolore os assentos com uma varredura da esquerda para a direita: cada grupo ocupa uma
// faixa contígua do arco, como as bancadas num plenário.

const OUTER = 220;
const INNER = 92;
const SEAT_R = 3.5;
const PAD = 4;
const CENTER = OUTER + SEAT_R + PAD;
export const VIEW_W = 2 * (OUTER + SEAT_R + PAD);
export const VIEW_H = OUTER + 2 * SEAT_R + 2 * PAD;

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

interface Seat {
  x: number;
  y: number;
  row: number;
  angle: number;
}

/** Matriz de pontos com passo igual ao longo e através dos arcos (mesma conta do Como Votam). */
function seatMatrix(total: number): Seat[] {
  const pitch = Math.sqrt(((Math.PI / 2) * (OUTER ** 2 - INNER ** 2)) / total);
  const rows = Math.max(2, Math.round((OUTER - INNER) / pitch) + 1);
  const radii = Array.from({ length: rows }, (_, i) => INNER + (i * (OUTER - INNER)) / (rows - 1));
  const sum = radii.reduce((a, b) => a + b, 0);
  const counts = radii.map((r) => Math.max(1, Math.round((total * r) / sum)));
  counts[rows - 1] = Math.max(1, counts[rows - 1] + total - counts.reduce((a, b) => a + b, 0));
  const seats: Seat[] = [];
  counts.forEach((count, row) => {
    for (let i = 0; i < count; i++) {
      const angle = count === 1 ? 90 : 180 - (i / (count - 1)) * 180;
      const rad = (angle * Math.PI) / 180;
      seats.push({ x: Math.cos(rad) * radii[row], y: -Math.sin(rad) * radii[row], row, angle });
    }
  });
  // Ordem de leitura do plenário: da esquerda para a direita, de dentro para fora em cada coluna.
  return seats.sort((a, b) => b.angle - a.angle || a.row - b.row);
}

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

export function createHemicycle(canvas: HTMLCanvasElement, count: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !count) return null;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const seats = seatMatrix(count);
  const rows = Math.max(1, ...seats.map((s) => s.row));
  // Atraso de cada assento na varredura: proporcional à posição no arco, da esquerda para a direita.
  const sweep = Float32Array.from(seats, (s) => (180 - s.angle) / 180);

  let mode: Mode | null = null;
  let highlight: number | null = null;
  let itemAt = new Int32Array(count); // assento → item
  let seatOf = new Int32Array(count); // item → assento
  let groupAt = new Int32Array(count); // assento → grupo
  const cur = new Float32Array(count * 3);
  let from = new Float32Array(count * 3);
  let target = new Float32Array(count * 3);
  let recolorStart = -Infinity;
  let spread = RECOLOR_SPREAD;
  let entryStart = performance.now();
  let started = false;
  let raf = 0;

  /** Grupos em sequência pelo arco: o grupo 0 nos primeiros assentos, o 1 nos seguintes, e assim por diante. */
  function assign(m: Mode) {
    const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => m.groupOf[a] - m.groupOf[b] || a - b);
    itemAt = Int32Array.from(order);
    seatOf = new Int32Array(count);
    order.forEach((item, seat) => (seatOf[item] = seat));
    groupAt = Int32Array.from(order, (item) => m.groupOf[item]);
  }
  function colors(m: Mode) {
    const out = new Float32Array(count * 3);
    for (let s = 0; s < count; s++) {
      const g = groupAt[s];
      let rgb = m.depth ? mix(NAVY, MIST, (seats[s].row / rows) * 0.34) : tone(g, m.groups);
      if (highlight !== null && g !== highlight) rgb = mix(rgb, PAPER, 0.8);
      out.set(rgb, s * 3);
    }
    return out;
  }

  function draw(now: number) {
    const k = canvas.width / VIEW_W;
    ctx!.setTransform(1, 0, 0, 1, 0, 0);
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    ctx!.setTransform(k, 0, 0, k, 0, 0);
    const entry = reduce || !started ? (started ? 1 : 0) : clamp01((now - entryStart) / ENTRY_MS);
    const reach = easeOut(entry) * (180 + ENTRY_FEATHER);
    let moving = entry < 1;
    for (let s = 0; s < count; s++) {
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
    if (!raf) raf = requestAnimationFrame(frame);
  };
  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
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
    },
    /** Começa a varredura de entrada (quando o hemiciclo aparece na tela). */
    start() {
      if (started) return;
      started = true;
      entryStart = performance.now();
      schedule();
    },
    highlight(group: number | null) {
      if (group === highlight) return;
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
      const r = canvas.getBoundingClientRect();
      const k = r.width / VIEW_W;
      const vx = x / k - CENTER;
      const vy = y / k - CENTER;
      let best = -1;
      let dist = (SEAT_R * 2.4) ** 2;
      for (let s = 0; s < count; s++) {
        const d = (seats[s].x - vx) ** 2 + (seats[s].y - vy) ** 2;
        if (d < dist) {
          dist = d;
          best = s;
        }
      }
      return best < 0 ? -1 : itemAt[best];
    },
    /** Posição de um item em px CSS dentro do canvas. */
    at(item: number) {
      const r = canvas.getBoundingClientRect();
      const k = r.width / VIEW_W;
      const s = seats[seatOf[item]];
      return { x: (CENTER + s.x) * k, y: (CENTER + s.y) * k };
    },
  };
}
