import { afterEach, describe, expect, it, vi } from 'vitest';
import { CENTER, SEAT_R, VIEW_W, sampleSeats, seatMatrix } from '../../src/scripts/ui/hemicycle-model';
import { createHemicycle } from '../../src/scripts/ui/hemicycle';

function scene(width = 900, reduce = true) {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  let onResize = () => {};
  const arc = vi.fn();
  const context = { setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), arc, fill: vi.fn(), globalAlpha: 1, fillStyle: '' };
  const canvas = {
    width: 0, height: 0,
    getContext: () => context,
    getBoundingClientRect: () => ({ width, height: width * 235 / 455 }),
  };
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('matchMedia', () => ({ matches: reduce }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { onResize = callback; } observe() { onResize(); } disconnect() {} });
  return {
    canvas: canvas as unknown as HTMLCanvasElement, arc, frames,
    resize(next: number) { width = next; onResize(); },
    frame() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(performance.now() + 2000));
    },
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('Densidade e trabalho do hemiciclo', () => {
  it.each([3000, 30000])('limita pontos desenhados com %i perguntas', (count) => {
    const view = scene();
    const engine = createHemicycle(view.canvas, count)!;
    engine.setMode({ key: 'items', groupOf: Array(count).fill(0), groups: 1, depth: true });
    engine.start();
    view.frame();
    expect(view.arc.mock.calls.length).toBeGreaterThan(0);
    expect(view.arc.mock.calls.length).toBeLessThanOrEqual(480);
    expect(view.frames.size).toBe(0);
  });
  it('reduz a densidade em telas pequenas', () => {
    const view = scene(340);
    const engine = createHemicycle(view.canvas, 3000)!;
    engine.setMode({ key: 'items', groupOf: Array(3000).fill(0), groups: 1 });
    engine.start();
    view.frame();
    expect(view.arc.mock.calls.length).toBeLessThanOrEqual(240);
  });
  it('não mantém animação rodando antes de entrar na tela', () => {
    const view = scene(900, false);
    const engine = createHemicycle(view.canvas, 3000)!;
    engine.setMode({ key: 'items', groupOf: Array(3000).fill(0), groups: 1 });
    view.frame();
    expect(view.arc).not.toHaveBeenCalled();
    expect(view.frames.size).toBe(0);
  });
});


describe('Agregação fiel e geometria legível', () => {
  it.each([1, 5, 96, 192, 480])('distribui exatamente %i pontos sem sobreposição', (count) => {
    const seats = seatMatrix(count);
    expect(seats).toHaveLength(count);
    let minimum = Infinity;
    for (let a = 0; a < seats.length; a++) {
      for (let b = a + 1; b < seats.length; b++) {
        const distance = Math.hypot(seats[a].x - seats[b].x, seats[a].y - seats[b].y);
        minimum = Math.min(minimum, distance);
      }
    }
    expect(minimum).toBeGreaterThanOrEqual(SEAT_R * 2 + 2);
  });
  it('preserva proporções e contabiliza todas as perguntas por grupo', () => {
    const groups = Array.from({ length: 3000 }, (_, i) => i % 10 < 7 ? 0 : i % 10 < 9 ? 1 : 2);
    const points = sampleSeats(groups, 3, 480);
    expect(points).toHaveLength(480);
    expect(new Set(points.map((p) => p.item)).size).toBe(480);
    for (const [group, count, seats] of [[0, 2100, 336], [1, 600, 96], [2, 300, 48]]) {
      const matching = points.filter((p) => p.group === group);
      expect(matching).toHaveLength(seats);
      expect(matching.reduce((sum, p) => sum + p.weight, 0)).toBe(count);
      expect(matching.every((p) => groups[p.item] === group && p.weight >= 1)).toBe(true);
    }
  });
  it('mantém grupos raros visíveis sem criar perguntas ou assentos vazios', () => {
    const groups = [...Array(2993).fill(0), 1, 2, 3, 4, 5, 6, 7];
    const points = sampleSeats(groups, 8, 192);
    expect(points).toHaveLength(192);
    expect(points.reduce((sum, p) => sum + p.weight, 0)).toBe(3000);
    expect(new Set(points.map((p) => p.group)).size).toBe(8);
    expect(points.every((p) => groups[p.item] === p.group && p.weight >= 1)).toBe(true);
  });
  it('mantém um ponto por pergunta quando todas cabem na tela', () => {
    const groups = [2, 0, 1, 2, 0];
    const points = sampleSeats(groups, 3, 480);
    expect(points).toHaveLength(5);
    expect(points.every((point) => point.weight === 1)).toBe(true);
    expect(points.map((point) => point.item).sort()).toEqual([0, 1, 2, 3, 4]);
  });
  it('recalcula a densidade ao redimensionar e mantém tooltip e clique no exemplo correto', () => {
    const view = scene();
    const engine = createHemicycle(view.canvas, 3000)!;
    engine.setMode({ key: 'tracks', groupOf: Array.from({ length: 3000 }, (_, i) => i % 8), groups: 8 });
    engine.start();
    view.frame();
    const assertHits = () => {
      let represented = 0;
      for (const [x, y] of view.arc.mock.calls) {
        const cssX = x * view.canvas.width / VIEW_W;
        const cssY = y * view.canvas.width / VIEW_W;
        const item = engine.hit(cssX, cssY);
        expect(item).toBeGreaterThanOrEqual(0);
        expect(item).toBeLessThan(3000);
        expect(engine.at(item)?.x).toBeCloseTo(cssX);
        expect(engine.at(item)?.y).toBeCloseTo(cssY);
        represented += engine.represented(item);
      }
      expect(represented).toBe(3000);
    };
    assertHits();
    view.arc.mockClear();
    view.resize(340);
    view.frame();
    expect(view.arc.mock.calls.length).toBeLessThanOrEqual(240);
    assertHits();
    expect(engine.hit(CENTER * 340 / VIEW_W, CENTER * 340 / VIEW_W)).toBe(-1);
    expect(engine.at(-1)).toBeNull();
  });
  it('cancela quadros fora da tela e retoma sem um loop permanente', () => {
    const view = scene(900, false);
    const engine = createHemicycle(view.canvas, 3000)!;
    engine.setMode({ key: 'items', groupOf: Array(3000).fill(0), groups: 1 });
    engine.start();
    expect(view.frames.size).toBe(1);
    engine.setVisible(false);
    expect(view.frames.size).toBe(0);
    engine.highlight(0);
    expect(view.frames.size).toBe(0);
    engine.setVisible(true);
    view.frame();
    expect(view.arc.mock.calls.length).toBeLessThanOrEqual(480);
    expect(view.frames.size).toBe(0);
  });
});
