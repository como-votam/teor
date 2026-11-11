import caretDown from '@phosphor-icons/core/assets/regular/caret-down.svg?raw';
import check from '@phosphor-icons/core/assets/bold/check-bold.svg?raw';
import x from '@phosphor-icons/core/assets/regular/x.svg?raw';
import search from '@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw';
import copy from '@phosphor-icons/core/assets/regular/copy.svg?raw';
import arrowRight from '@phosphor-icons/core/assets/regular/arrow-right.svg?raw';
import arrowUpRight from '@phosphor-icons/core/assets/regular/arrow-up-right.svg?raw';
import fileCode from '@phosphor-icons/core/assets/light/file-code-light.svg?raw';
import database from '@phosphor-icons/core/assets/light/database-light.svg?raw';
import scales from '@phosphor-icons/core/assets/light/scales-light.svg?raw';
import books from '@phosphor-icons/core/assets/light/books-light.svg?raw';
import chart from '@phosphor-icons/core/assets/light/chart-scatter-light.svg?raw';
import listSearch from '@phosphor-icons/core/assets/light/list-magnifying-glass-light.svg?raw';
import cube from '@phosphor-icons/core/assets/light/cube-light.svg?raw';
import path from '@phosphor-icons/core/assets/light/path-light.svg?raw';
import warning from '@phosphor-icons/core/assets/regular/warning-circle.svg?raw';
import info from '@phosphor-icons/core/assets/regular/info.svg?raw';
import minus from '@phosphor-icons/core/assets/regular/minus.svg?raw';
import plus from '@phosphor-icons/core/assets/regular/plus.svg?raw';
import download from '@phosphor-icons/core/assets/regular/download-simple.svg?raw';
import play from '@phosphor-icons/core/assets/fill/play-fill.svg?raw';
import checkCircle from '@phosphor-icons/core/assets/fill/check-circle-fill.svg?raw';
import xCircle from '@phosphor-icons/core/assets/fill/x-circle-fill.svg?raw';
import circleHalf from '@phosphor-icons/core/assets/fill/circle-half-fill.svg?raw';
import reset from '@phosphor-icons/core/assets/regular/arrow-counter-clockwise.svg?raw';
import quote from '@phosphor-icons/core/assets/light/quotes-light.svg?raw';
import article from '@phosphor-icons/core/assets/light/article-light.svg?raw';
import terminal from '@phosphor-icons/core/assets/light/terminal-window-light.svg?raw';

const raw = {
  caretDown,
  check,
  x,
  search,
  copy,
  arrowRight,
  arrowUpRight,
  fileCode,
  database,
  scales,
  books,
  chart,
  listSearch,
  cube,
  path,
  warning,
  info,
  minus,
  plus,
  download,
  play,
  checkCircle,
  xCircle,
  circleHalf,
  reset,
  quote,
  article,
  terminal,
};
export type IconName = keyof typeof raw;

/** SVG confiável (empacotado no build), nunca conteúdo de dados. */
export function icon(name: IconName, size = 16, className = '') {
  const tpl = document.createElement('template');
  tpl.innerHTML = raw[name]
    .replace('<svg ', `<svg width="${size}" height="${size}" aria-hidden="true" `)
    .replace('<svg ', className ? `<svg class="${className}" ` : '<svg ');
  return tpl.content.firstElementChild as SVGElement;
}

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

/** Cria elementos sem innerHTML: todo texto entra por textContent. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs)
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function')
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<T>(sel));

export function readJSON<T>(id: string): T {
  return JSON.parse(document.getElementById(id)?.textContent || 'null') as T;
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Reinicia uma animação CSS declarada por atributo (data-swap) sem trocar o nó. */
export function swap(el: Element) {
  el.removeAttribute('data-swap');
  void (el as HTMLElement).offsetWidth;
  el.setAttribute('data-swap', '');
}

const live = () => {
  let region = document.getElementById('live-region');
  if (!region) {
    region = h('div', { id: 'live-region', class: 'sr-only', 'aria-live': 'polite' });
    document.body.append(region);
  }
  return region;
};
export function announce(text: string) {
  const region = live();
  region.textContent = '';
  requestAnimationFrame(() => (region!.textContent = text));
}

export function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined
    ? '—'
    : `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
export const pp = (v: number) => {
  const n = v * 100;
  if (Math.abs(n) < 0.05) return '±0,0 pp';
  return `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pp`;
};

export function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
  );
}

/**
 * Rola só o contêiner até o elemento, sem mexer na janela. scrollIntoView rola todos os
 * ancestrais roláveis, inclusive a página, o que faria a tela pular ao carregar ou ao navegar.
 */
export function scrollWithin(container: HTMLElement, el: HTMLElement, block: 'nearest' | 'center' = 'nearest') {
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const top = r.top - c.top + container.scrollTop;
  if (block === 'center') container.scrollTop = top - (container.clientHeight - r.height) / 2;
  else if (r.top < c.top) container.scrollTop = top - 6;
  else if (r.bottom > c.bottom) container.scrollTop = top + r.height - container.clientHeight + 6;
}

/** Foco sem rolar a página: o leitor de tela e o teclado vão para o campo, a tela fica onde está. */
export const focusQuietly = (el: HTMLElement | null | undefined) => el?.focus({ preventScroll: true });
