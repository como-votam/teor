import { h, icon, announce, reducedMotion } from './core';

// ── Segmented (radiogroup com polegar deslizante) ────────────────────────────
export function mountSegmented(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-seg]:not([data-ready])').forEach((seg) => {
    seg.dataset.ready = '';
    const buttons = Array.from(seg.querySelectorAll<HTMLButtonElement>('button[data-value]'));
    const thumb = h('span', { class: 'seg-thumb', 'aria-hidden': 'true', 'data-instant': '' });
    seg.prepend(thumb);
    const place = () => {
      const on = buttons.find((b) => b.getAttribute('aria-checked') === 'true') || buttons[0];
      thumb.style.width = `${on.offsetWidth}px`;
      thumb.style.transform = `translateX(${on.offsetLeft}px)`;
    };
    const select = (b: HTMLButtonElement, focus = false) => {
      if (b.getAttribute('aria-checked') === 'true') return;
      buttons.forEach((x) => {
        x.setAttribute('aria-checked', String(x === b));
        x.tabIndex = x === b ? 0 : -1;
      });
      if (focus) b.focus();
      place();
      seg.dataset.value = b.dataset.value;
      seg.dispatchEvent(new CustomEvent('seg', { detail: { value: b.dataset.value }, bubbles: true }));
    };
    buttons.forEach((b, i) => {
      b.tabIndex = b.getAttribute('aria-checked') === 'true' ? 0 : -1;
      b.addEventListener('click', () => select(b));
      b.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        select(buttons[(i + d + buttons.length) % buttons.length], true);
      });
    });
    place();
    requestAnimationFrame(() => thumb.removeAttribute('data-instant'));
    new ResizeObserver(() => {
      thumb.setAttribute('data-instant', '');
      place();
      requestAnimationFrame(() => thumb.removeAttribute('data-instant'));
    }).observe(seg);
    document.fonts?.ready.then(place);
    // Quando o código troca a opção marcada (ex.: o hemiciclo alternando sozinho), o polegar acompanha.
    seg.addEventListener('seg-sync', () => {
      buttons.forEach((x) => (x.tabIndex = x.getAttribute('aria-checked') === 'true' ? 0 : -1));
      place();
    });
  });
}

// ── Tooltip única ────────────────────────────────────────────────────────────
// data-tip='{"t":"título","v":"valor","rows":[["rótulo","valor","cor"]],"s":"nota"}'
interface TipData {
  t?: string;
  v?: string;
  rows?: [string, string, string?][];
  s?: string;
}
let tipEl: HTMLDivElement | null = null;
let tipTarget: Element | null = null;
let hideTimer: ReturnType<typeof setTimeout>;
let lastHide = 0;

function tip() {
  if (!tipEl) {
    tipEl = h('div', { class: 'tip', role: 'tooltip', id: 'tip' });
    document.body.append(tipEl);
  }
  return tipEl;
}
function fill(data: TipData) {
  const el = tip();
  el.replaceChildren(
    data.t ? h('div', { style: 'color:#a9b6c4' }, data.t) : null,
    data.v ? h('strong', null, data.v) : null,
    ...(data.rows || []).map(([label, value, color]) =>
      h('div', { class: 't-row' }, color ? h('span', { class: 't-key', style: `--c:${color}` }) : null, h('span', null, label), h('b', null, value)),
    ),
    data.s ? h('div', { class: 't-sub' }, data.s) : null,
  );
}
function position(target: Element) {
  const el = tip();
  const r = target.getBoundingClientRect();
  const w = el.offsetWidth;
  const ht = el.offsetHeight;
  let x = r.left + r.width / 2 - w / 2;
  let y = r.top - ht - 10;
  if (y < 8) y = r.bottom + 10;
  x = Math.max(8, Math.min(innerWidth - w - 8, x));
  el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
}
export function showTip(target: Element) {
  const raw = target.getAttribute('data-tip');
  if (!raw) return;
  clearTimeout(hideTimer);
  const el = tip();
  const glide = el.hasAttribute('data-on') || performance.now() - lastHide < 120;
  el.toggleAttribute('data-glide', glide && !reducedMotion());
  fill(JSON.parse(raw));
  position(target);
  el.setAttribute('data-on', '');
  tipTarget = target;
  target.setAttribute('aria-describedby', 'tip');
}
export function hideTip() {
  hideTimer = setTimeout(() => {
    tip().removeAttribute('data-on');
    tipTarget?.removeAttribute('aria-describedby');
    tipTarget = null;
    lastHide = performance.now();
  }, 60);
}
export function mountTooltips() {
  const find = (e: Event) => (e.target as Element | null)?.closest?.('[data-tip]');
  document.addEventListener('pointerover', (e) => {
    const t = find(e);
    if (t && t !== tipTarget) showTip(t);
  });
  document.addEventListener('pointerout', (e) => {
    const t = find(e);
    const to = (e as PointerEvent).relatedTarget as Element | null;
    if (t && !(to && t.contains(to))) hideTip();
  });
  document.addEventListener('focusin', (e) => {
    const t = find(e);
    if (t) showTip(t);
  });
  document.addEventListener('focusout', (e) => {
    if (find(e)) hideTip();
  });
  addEventListener('scroll', () => tipTarget && hideTip(), { passive: true, capture: true });
}
export const tipJSON = (data: TipData) => JSON.stringify(data);

// ── Sheet lateral ────────────────────────────────────────────────────────────
export function openSheet(opts: { title: string; body: Node; wide?: boolean; onClose?: () => void }) {
  const returnTo = document.activeElement as HTMLElement | null;
  const titleId = `sheet-${Date.now()}`;
  const closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fechar' }, icon('x', 18));
  const sheet = h(
    'div',
    { class: `sheet${opts.wide ? ' sheet--wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div', { class: 'sheet-head' }, h('h2', { id: titleId, class: 'h-panel' }, opts.title), closeBtn),
    h('div', { class: 'sheet-body' }, opts.body),
  );
  const scrim = h('div', { class: 'scrim' });
  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  document.body.append(scrim, sheet);
  const focusables = () =>
    Array.from(sheet.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,textarea,[tabindex]:not([tabindex="-1"])'));
  closeBtn.focus();
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    if (e.key === 'Tab') {
      const f = focusables();
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    }
  }
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    sheet.setAttribute('data-closing', '');
    scrim.setAttribute('data-closing', '');
    const done = () => {
      sheet.remove();
      scrim.remove();
      document.documentElement.style.overflow = prevOverflow;
      returnTo?.focus?.();
      opts.onClose?.();
    };
    if (reducedMotion()) done();
    else setTimeout(done, 220);
  }
  document.addEventListener('keydown', onKey);
  closeBtn.addEventListener('click', close);
  scrim.addEventListener('click', close);
  return close;
}

// ── Copiar ───────────────────────────────────────────────────────────────────
export function mountCopy(root: ParentNode = document) {
  root.querySelectorAll<HTMLButtonElement>('[data-copy]:not([data-ready])').forEach((btn) => {
    btn.dataset.ready = '';
    btn.addEventListener('click', async () => {
      const target = btn.dataset.copyTarget ? document.querySelector(btn.dataset.copyTarget) : null;
      const text = target ? (target.textContent || '').trim() : btn.dataset.copy || '';
      try {
        await navigator.clipboard.writeText(text);
        btn.setAttribute('data-copied', '');
        announce('Copiado para a área de transferência.');
        setTimeout(() => btn.removeAttribute('data-copied'), 1600);
      } catch {
        announce('Não foi possível copiar. Selecione o texto manualmente.');
      }
    });
  });
}

// ── Revelação ao rolar ───────────────────────────────────────────────────────
export function mountReveal(root: ParentNode = document) {
  const els = root.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-in)');
  if (!('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }),
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  els.forEach((el) => io.observe(el));
}

/** Dispara uma vez quando o elemento entra na tela (gráficos que crescem). */
export function whenSeen(el: Element, fn: () => void) {
  if (!('IntersectionObserver' in window)) return fn();
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        fn();
      }
    },
    // Basta a borda do gráfico aparecer: um gráfico alto não pode exigir rolagem para começar.
    { threshold: 0, rootMargin: '0px 0px -40px 0px' },
  );
  io.observe(el);
}

/**
 * (Re)toca a animação de entrada dos gráficos dentro de `root`. Se o gráfico já está na tela,
 * anima no próximo quadro; senão, quando entrar. Chamar de novo depois de redesenhar repete a animação.
 */
export function mountSeen(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-seen]').forEach((el) => {
    el.dataset.seen = 'false';
    void el.offsetWidth;
    const r = el.getBoundingClientRect();
    const play = () => requestAnimationFrame(() => requestAnimationFrame(() => (el.dataset.seen = 'true')));
    if (r.top < innerHeight && r.bottom > 0) play();
    else whenSeen(el, play);
  });
}
