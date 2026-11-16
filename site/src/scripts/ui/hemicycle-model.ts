// Geometry and aggregation are bounded by screen space, independently of dataset size.
const OUTER = 220;
const INNER = 92;
export const SEAT_R = 3.5;
export const CENTER = OUTER + SEAT_R + 4;
export const VIEW_W = CENTER * 2;
export const VIEW_H = OUTER + 2 * SEAT_R + 8;
export const MAX_SEATS = 480;

export interface Seat { x: number; y: number; row: number; angle: number }
export interface SeatSample { item: number; group: number; weight: number }

export function seatBudget(width: number): number {
  return Math.min(MAX_SEATS, Math.max(96, Math.floor(width / 40) * 24));
}

/** Largest remainder, with one seat reserved for every nonempty group. */
function apportion(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum || !total) return weights.map(() => 0);
  const quota = weights.map((weight) => weight * total / sum);
  const counts = weights.map((weight, i) => weight ? Math.max(1, Math.floor(quota[i])) : 0);
  let remaining = total - counts.reduce((a, b) => a + b, 0);
  while (remaining !== 0) {
    let best = -1;
    let score = -Infinity;
    counts.forEach((count, i) => {
      if (!weights[i] || (remaining < 0 && count <= 1)) return;
      const delta = remaining > 0 ? quota[i] - count : count - quota[i];
      if (delta > score) { best = i; score = delta; }
    });
    if (best < 0) throw new RangeError('Mais grupos do que pontos disponíveis no hemiciclo.');
    counts[best] += remaining > 0 ? 1 : -1;
    remaining += remaining > 0 ? -1 : 1;
  }
  return counts;
}

export function seatMatrix(total: number): Seat[] {
  if (!total) return [];
  const pitch = Math.sqrt(((Math.PI / 2) * (OUTER ** 2 - INNER ** 2)) / total);
  const rows = Math.min(total, Math.max(2, Math.round((OUTER - INNER) / pitch) + 1));
  const radii = Array.from({ length: rows }, (_, i) => rows === 1 ? (INNER + OUTER) / 2 : INNER + i * (OUTER - INNER) / (rows - 1));
  const counts = apportion(radii, total);
  const seats: Seat[] = [];
  counts.forEach((count, row) => {
    for (let i = 0; i < count; i++) {
      const angle = count === 1 ? 90 : 180 - i / (count - 1) * 180;
      const radians = angle * Math.PI / 180;
      seats.push({ x: Math.cos(radians) * radii[row], y: -Math.sin(radians) * radii[row], row, angle });
    }
  });
  return seats.sort((a, b) => b.angle - a.angle || a.row - b.row);
}

/**
 * Every item belongs to one bucket in its group. A point opens the bucket's middle item.
 * Two linear passes replace sorting all items; only the displayed samples are retained.
 */
export function sampleSeats(groupOf: number[], groups: number, capacity: number): SeatSample[] {
  const totals = Array<number>(groups).fill(0);
  for (const group of groupOf) totals[group]++;
  const allocation = apportion(totals, Math.min(groupOf.length, capacity));
  const samples: SeatSample[] = [];
  const targets: number[][] = totals.map(() => []);
  const offsets: number[] = [];
  totals.forEach((total, group) => {
    offsets[group] = samples.length;
    for (let j = 0; j < allocation[group]; j++) {
      const from = Math.floor(j * total / allocation[group]);
      const to = Math.floor((j + 1) * total / allocation[group]);
      targets[group].push(Math.floor((from + to - 1) / 2));
      samples.push({ item: -1, group, weight: to - from });
    }
  });
  const seen = totals.map(() => 0);
  const next = totals.map(() => 0);
  groupOf.forEach((group, item) => {
    const ordinal = seen[group]++;
    if (ordinal === targets[group][next[group]]) {
      samples[offsets[group] + next[group]++].item = item;
    }
  });
  return samples;
}
