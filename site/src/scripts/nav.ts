// Navegação do desktop, no padrão do Como Votam: uma lente que repousa na seção atual e desliza
// até o gatilho sob o ponteiro, e um único painel que acompanha o gatilho aberto, mudando de
// tamanho e trazendo o conteúdo novo pela direção do movimento.
import { $, $$, reducedMotion } from './ui/core';

const OPEN_DELAY = 110;
const CLOSE_DELAY = 140;

const nav = $('[data-nav]');
const lens = $('.nav-lens');
const viewport = $('[data-nav-viewport]');

if (nav && lens && viewport) {
  const triggers = $$<HTMLButtonElement>('[data-nav-trigger]', nav);
  const panels = new Map($$('[data-nav-panel]', viewport).map((p) => [p.dataset.navPanel!, p]));
  const current = triggers.find((t) => t.getAttribute('aria-current') === 'page') || null;
  let open = '';
  let lensOn: HTMLElement | null = null;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  // Posição em relação à própria navegação, pela geometria real na tela. offsetLeft dependia de
  // qual ancestral estava posicionado, e isso jogava a lente para o primeiro item.
  const box = (el: HTMLElement) => {
    const n = nav.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - n.left, w: r.width };
  };

  function moveLens(el: HTMLElement | null, hover: boolean) {
    lens!.toggleAttribute('data-glide', !!lensOn && !!el && !reducedMotion());
    lens!.toggleAttribute('data-hover', hover);
    if (el) {
      const { x, w } = box(el);
      lens!.style.width = `${w}px`;
      lens!.style.transform = `translateX(${x}px)`;
    }
    lens!.toggleAttribute('data-on', !!el);
    lensOn = el;
  }
  const rest = () => moveLens(open ? triggers.find((t) => t.dataset.navTrigger === open)! : current, !!open);

  function place(key: string, glide: boolean) {
    const trigger = triggers.find((t) => t.dataset.navTrigger === key)!;
    const panel = panels.get(key)!;
    const width = Math.min(parseFloat(panel.style.width) || 480, innerWidth - 32);
    const height = panel.offsetHeight;
    const n = nav!.getBoundingClientRect();
    const t = box(trigger);
    // Centrado no gatilho, mas sem passar das bordas da janela.
    const left = Math.max(16 - n.left, Math.min(t.x + t.w / 2 - width / 2, innerWidth - 16 - n.left - width));
    viewport!.toggleAttribute('data-glide', glide && !reducedMotion());
    viewport!.style.width = `${width}px`;
    viewport!.style.height = `${height}px`;
    viewport!.style.transform = `translateX(${left}px)`;
  }

  function show(key: string) {
    clearTimeout(closeTimer);
    if (key === open) return;
    const prev = open;
    const from = triggers.findIndex((t) => t.dataset.navTrigger === prev);
    const to = triggers.findIndex((t) => t.dataset.navTrigger === key);
    open = key;
    triggers.forEach((t) => t.setAttribute('aria-expanded', String(t.dataset.navTrigger === key)));
    panels.forEach((p, k) => {
      if (k === key) {
        p.hidden = false;
        p.dataset.motion = prev ? (to > from ? 'from-end' : 'from-start') : '';
      } else if (k === prev) {
        p.hidden = true;
      } else p.hidden = true;
    });
    const first = viewport!.hidden;
    viewport!.hidden = false;
    if (first) viewport!.setAttribute('data-opening', '');
    else viewport!.removeAttribute('data-opening');
    place(key, !first);
    rest();
  }
  function hide() {
    clearTimeout(openTimer);
    if (!open) return;
    open = '';
    triggers.forEach((t) => t.setAttribute('aria-expanded', 'false'));
    viewport!.hidden = true;
    panels.forEach((p) => (p.hidden = true));
    if (!nav!.matches(':hover')) rest();
  }
  const scheduleClose = () => {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(hide, CLOSE_DELAY);
  };

  triggers.forEach((t, i) => {
    const key = t.dataset.navTrigger!;
    t.addEventListener('pointerenter', (e) => {
      moveLens(t, true);
      if ((e as PointerEvent).pointerType !== 'mouse') return;
      clearTimeout(closeTimer);
      clearTimeout(openTimer);
      // Com um painel já aberto, a troca é imediata; a primeira abertura espera a intenção.
      if (open) show(key);
      else openTimer = setTimeout(() => show(key), OPEN_DELAY);
    });
    t.addEventListener('pointerleave', scheduleClose);
    t.addEventListener('click', () => (open === key ? hide() : show(key)));
    t.addEventListener('focus', () => moveLens(t, true));
    t.addEventListener('keydown', (e) => {
      const panel = panels.get(key)!;
      const links = () => $$<HTMLElement>('a[href], button', panel);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        show(key);
        requestAnimationFrame(() => links()[0]?.focus());
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        triggers[(i + (e.key === 'ArrowRight' ? 1 : -1) + triggers.length) % triggers.length].focus();
      } else if (e.key === 'Tab' && !e.shiftKey && open === key) {
        // O painel fica depois dos gatilhos no DOM; o Tab entra nele em vez de pular para o próximo gatilho.
        e.preventDefault();
        links()[0]?.focus();
      }
    });
  });
  // O último link de um painel devolve o Tab ao gatilho seguinte.
  viewport.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return;
    if (e.key !== 'Tab' || !open) return;
    const panel = panels.get(open)!;
    const links = $$<HTMLElement>('a[href], button', panel);
    const at = links.indexOf(document.activeElement as HTMLElement);
    const idx = triggers.findIndex((t) => t.dataset.navTrigger === open);
    if (!e.shiftKey && at === links.length - 1 && triggers[idx + 1]) {
      e.preventDefault();
      triggers[idx + 1].focus();
      hide();
    } else if (e.shiftKey && at === 0) {
      e.preventDefault();
      triggers[idx].focus();
    }
  });
  viewport.addEventListener('pointerenter', () => clearTimeout(closeTimer));
  viewport.addEventListener('pointerleave', scheduleClose);
  nav.addEventListener('pointerleave', () => {
    if (!open) rest();
  });
  nav.addEventListener('focusout', (e) => {
    if (nav.contains(e.relatedTarget as Node)) return;
    hide();
    rest();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !open) return;
    const t = triggers.find((x) => x.dataset.navTrigger === open);
    hide();
    t?.focus();
  });
  document.addEventListener('pointerdown', (e) => {
    if (open && !nav.contains(e.target as Node)) hide();
  });
  viewport.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a')) hide();
  });
  addEventListener('resize', () => {
    if (open) place(open, false);
    lensOn = null;
    rest();
  });

  // Trilhas: passar sobre um link acende o segmento no gráfico, e vice-versa.
  const trackPanel = panels.get('trilhas');
  if (trackPanel) {
    const comp = $('[data-nav-comp]', trackPanel);
    const mark = (id: string | null) => {
      comp?.toggleAttribute('data-focus', !!id);
      $$<HTMLElement>('[data-track]', trackPanel).forEach((el) => el.toggleAttribute('data-on', el.dataset.track === id));
    };
    trackPanel.addEventListener('pointerover', (e) => {
      const el = (e.target as Element).closest<HTMLElement>('[data-track]');
      mark(el?.dataset.track || null);
    });
    trackPanel.addEventListener('pointerleave', () => mark(null));
    trackPanel.addEventListener('focusin', (e) => mark((e.target as HTMLElement).dataset.track || null));
  }

  rest();
  // As fontes mudam a largura dos itens; reposiciona a lente sem animar.
  document.fonts?.ready.then(() => {
    lensOn = null;
    rest();
  });
}
