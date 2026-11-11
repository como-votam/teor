// Comportamento comum a todas as páginas: header, navegação, logo, paleta de comandos e controles.
import { $, $$, h, isTyping } from './ui/core';
import { mountSegmented, mountTooltips, mountCopy, mountReveal, mountSeen, openSheet } from './ui/controls';
import { mountSelects } from './ui/select';
import './nav'; // navegação do desktop: gatilhos, lente e painel único

document.documentElement.classList.replace('no-js', 'js');

// Header condensado: sentinela no topo em vez de ouvir scroll.
const header = $('.site-header');
const sentinel = h('div', { 'aria-hidden': 'true', style: 'position:absolute;top:0;left:0;height:24px;width:1px;pointer-events:none' });
document.body.prepend(sentinel);
new IntersectionObserver(([e]) => header?.setAttribute('data-scrolled', String(!e.isIntersecting))).observe(sentinel);

import './nav';

// Navegação mobile em sheet.
$('[data-mobile-nav]')?.addEventListener('click', () => {
  const tpl = $<HTMLTemplateElement>('#mobile-nav');
  if (!tpl) return;
  const body = tpl.content.cloneNode(true) as DocumentFragment;
  const wrapper = h('nav', { class: 'mobile-nav', 'aria-label': 'Principal' });
  wrapper.append(body);
  const close = openSheet({ title: 'Teor', body: wrapper });
  wrapper.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a')) close();
  });
});

// Logo: replay do traçado a cada hover, só depois do anterior terminar.
$$('[data-logo]').forEach((logo) => {
  let busy = false;
  const play = () => {
    if (busy || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    busy = true;
    logo.removeAttribute('data-play');
    void logo.offsetWidth;
    logo.setAttribute('data-play', '');
    setTimeout(() => {
      logo.removeAttribute('data-play');
      busy = false;
    }, 560);
  };
  logo.addEventListener('pointerenter', play);
  logo.addEventListener('focus', play);
});

// Voltar ao topo
$('[data-top]')?.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));

// Paleta de comandos: ⌘K / Ctrl+K / "/" fora de campos.
let palette: Promise<typeof import('./cmdk')> | null = null;
const openPalette = () => {
  palette ||= import('./cmdk');
  palette.then((m) => m.openPalette());
};
$$('[data-cmdk]').forEach((b) => b.addEventListener('click', openPalette));
document.addEventListener('keydown', (e) => {
  if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    openPalette();
  } else if (e.key === '/' && !isTyping(e.target) && !document.querySelector('[data-own-slash]')) {
    e.preventDefault();
    openPalette();
  }
});
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
$$('[data-mod-key]').forEach((el) => (el.textContent = isMac ? '⌘' : 'Ctrl'));

mountSegmented();
mountSelects();
mountTooltips();
mountCopy();
mountReveal();
mountSeen();
