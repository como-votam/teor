// Select próprio: botão + listbox (padrão WAI-ARIA "select-only combobox"), com busca opcional.
// Nada de <select> nativo: o popover, o realce e o check são nossos, e o teclado faz tudo.
import { h, icon, normalize, scrollWithin } from './core';

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  group?: string;
  disabled?: boolean;
  swatch?: string;
}
export interface SelectConfig {
  label: string;
  options: SelectOption[];
  value: string;
  searchable?: boolean;
  /** Mostra o rótulo pequeno acima do valor, dentro do gatilho. */
  stacked?: boolean;
  align?: 'start' | 'end';
  onChange?: (value: string) => void;
}

let uid = 0;
const open = new Set<() => void>();

export function createSelect(config: SelectConfig) {
  const id = `sel-${++uid}`;
  let value = config.value;
  let options = config.options;
  let active = -1;
  let typed = '';
  let typedTimer: ReturnType<typeof setTimeout>;

  const valueEl = h('span', { class: 'select-value' });
  const swatchEl = h('span', { class: 'swatch', hidden: true });
  const trigger = h(
    'button',
    {
      type: 'button',
      class: 'select-trigger',
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
      'aria-controls': `${id}-list`,
      'aria-label': config.label,
    },
    h(
      'span',
      { style: 'display:flex;align-items:center;gap:10px;min-width:0' },
      swatchEl,
      config.stacked
        ? h('span', { style: 'min-width:0' }, h('span', { class: 'select-label' }, config.label), valueEl)
        : valueEl,
    ),
    icon('caretDown', 14),
  );
  const list = h('div', { class: 'select-list', role: 'listbox', id: `${id}-list`, 'aria-label': config.label });
  const searchInput = h('input', {
    type: 'text',
    placeholder: 'Filtrar',
    'aria-label': `Filtrar ${config.label.toLowerCase()}`,
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const pop = h(
    'div',
    { class: 'pop', hidden: true, 'data-align': config.align || 'start' },
    config.searchable ? h('div', { class: 'pop-search' }, icon('search', 15), searchInput) : null,
    list,
  );
  const root = h('div', { class: 'select', 'data-select': '' }, trigger, pop);

  // Filtra por rótulo e dica; quem começa com o termo vem primeiro.
  const visible = () => {
    const q = normalize(searchInput.value.trim());
    if (!config.searchable || !q) return options;
    const hits = options.filter((o) => normalize(`${o.label} ${o.hint || ''}`).includes(q));
    return [...hits.filter((o) => normalize(o.label).startsWith(q)), ...hits.filter((o) => !normalize(o.label).startsWith(q))].map((o) =>
      normalize(o.label).startsWith(q) ? { ...o, group: 'Melhor correspondência' } : o,
    );
  };

  function render() {
    const selected = options.find((o) => o.value === value);
    valueEl.textContent = selected?.label || '—';
    swatchEl.hidden = !selected?.swatch;
    if (selected?.swatch) {
      swatchEl.className = selected.swatch === 'ref' ? 'swatch swatch--ref' : 'swatch';
      swatchEl.style.setProperty('--c', selected.swatch);
    }
    list.replaceChildren();
    const shown = visible();
    let group: string | undefined;
    shown.forEach((o, i) => {
      if (o.group && o.group !== group) {
        group = o.group;
        list.append(h('div', { class: 'pop-group', role: 'presentation' }, o.group));
      }
      const sw = o.swatch
        ? h('span', {
            class: o.swatch === 'ref' ? 'swatch swatch--ref' : 'swatch',
            style: o.swatch === 'ref' ? '' : `--c:${o.swatch}`,
          })
        : null;
      const el = h(
        'div',
        {
          class: 'opt',
          role: 'option',
          id: `${id}-o${i}`,
          'aria-selected': String(o.value === value),
          'aria-disabled': o.disabled ? 'true' : null,
          'data-index': i,
          'data-active': i === active ? '' : null,
        },
        sw,
        h('span', { style: 'min-width:0' }, o.label, o.hint ? h('small', null, o.hint) : null),
        h('span', { class: 'opt-check' }, icon('check', 14)),
      );
      el.addEventListener('pointermove', () => setActive(i, false));
      el.addEventListener('click', () => choose(i));
      list.append(el);
    });
    if (!shown.length) list.append(h('div', { class: 'opt-empty' }, 'Nenhuma opção com esse filtro.'));
  }

  function setActive(i: number, scroll = true) {
    active = i;
    list.querySelectorAll('.opt').forEach((el) => {
      const on = Number((el as HTMLElement).dataset.index) === i;
      el.toggleAttribute('data-active', on);
      if (on && scroll) scrollWithin(pop, el as HTMLElement);
    });
    const target = list.querySelector(`#${id}-o${i}`);
    if (target) (config.searchable ? searchInput : trigger).setAttribute('aria-activedescendant', target.id);
  }

  function choose(i: number) {
    const o = visible()[i];
    if (!o || o.disabled) return;
    const changed = o.value !== value;
    value = o.value;
    close();
    render();
    trigger.focus();
    if (changed) {
      config.onChange?.(value);
      root.dispatchEvent(new CustomEvent('change', { detail: { value }, bubbles: true }));
    }
  }

  function place() {
    const r = trigger.getBoundingClientRect();
    const below = innerHeight - r.bottom;
    const side = below < 260 && r.top > below ? 'top' : 'bottom';
    pop.dataset.side = side;
    pop.style.setProperty('--origin', `${side === 'top' ? 'bottom' : 'top'} ${config.align === 'end' ? 'right' : 'left'}`);
  }

  function openPop() {
    if (!pop.hidden) return;
    open.forEach((fn) => fn());
    searchInput.value = '';
    render();
    pop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    place();
    const index = visible().findIndex((o) => o.value === value);
    setActive(Math.max(0, index));
    if (config.searchable) searchInput.focus();
    open.add(close);
  }
  function close() {
    if (pop.hidden) return;
    pop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
    open.delete(close);
  }

  function onKey(e: KeyboardEvent) {
    const count = visible().length;
    if (pop.hidden) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openPop();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive(Math.min(count - 1, active + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive(Math.max(0, active - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(count - 1);
        break;
      case 'Enter':
        e.preventDefault();
        choose(active);
        break;
      case ' ':
        if (!config.searchable) {
          e.preventDefault();
          choose(active);
        }
        break;
      case 'Escape':
        e.preventDefault();
        close();
        trigger.focus();
        break;
      case 'Tab':
        close();
        break;
      default:
        if (!config.searchable && e.key.length === 1) {
          clearTimeout(typedTimer);
          typed += normalize(e.key);
          typedTimer = setTimeout(() => (typed = ''), 600);
          const hit = visible().findIndex((o) => normalize(o.label).startsWith(typed));
          if (hit >= 0) setActive(hit);
        }
    }
  }

  trigger.addEventListener('click', () => (pop.hidden ? openPop() : close()));
  trigger.addEventListener('keydown', onKey);
  searchInput.addEventListener('keydown', onKey);
  searchInput.addEventListener('input', () => {
    render();
    setActive(0);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!root.contains(e.target as Node)) close();
  });

  render();
  return {
    el: root,
    get value() {
      return value;
    },
    set(next: string, silent = true) {
      value = next;
      render();
      if (!silent) config.onChange?.(value);
    },
    setOptions(next: SelectOption[]) {
      options = next;
      render();
    },
  };
}

/** Monta os selects declarados no HTML (Select.astro) a partir do JSON embutido. */
export function mountSelects(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-select-mount]').forEach((host) => {
    const config = JSON.parse(host.dataset.selectMount!) as SelectConfig & { name: string };
    const select = createSelect({
      ...config,
      onChange: (value) => host.dispatchEvent(new CustomEvent('select', { detail: { value, name: config.name }, bubbles: true })),
    });
    (host as HTMLElement & { select?: ReturnType<typeof createSelect> }).select = select;
    host.replaceChildren(select.el);
  });
}
