import { $, $$, h, icon, readJSON, swap, announce, pct, focusQuietly } from './ui/core';
import { normalize, quizScore } from '../lib/quiz';

interface Q {
  id: string;
  track: string;
  task: string;
  chamber: string;
  prompt: string;
  context: Record<string, any>;
  summary: string;
  answer: { type: string; value: any };
  evidence: { ref: string; url: string }[];
  models: { label: string; mean: number }[];
}
const root = $('[data-quiz]');
if (root) {
  const items = readJSON<Q[]>('quiz-data');
  const body = $('[data-q-body]', root)!;
  const steps = $$('.quiz-steps i', root);
  const scoreEl = $('[data-q-score]', root)!;
  const results: number[] = [];
  let index = 0;

  const tone = (s: number) => (s === 1 ? 'ok' : s > 0 ? 'part' : 'bad');
  const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  function setScore() {
    const total = results.reduce((a, b) => a + b, 0);
    scoreEl.replaceChildren(fmt(total), h('small', { style: 'font-size:24px;color:var(--color-placeholder)' }, `/${items.length}`));
  }

  function contextView(q: Q) {
    const c = q.context;
    if (Array.isArray(c.votes) && c.votes.length) {
      const list = h('div', { class: 'ex-doc', style: 'max-height:260px;overflow:auto;font-family:"Space Mono",monospace;font-size:12.5px;line-height:1.7' });
      list.textContent = c.votes.map((v: any, i: number) => `${String(i + 1).padStart(3, ' ')}  ${(v.party || '').padEnd(14, ' ')} ${v.vote ?? '(sem registro)'}`).join('\n');
      return list;
    }
    if (Array.isArray(c.history)) {
      const list = h('ol', { class: 'timeline', style: 'max-height:300px;overflow:auto' });
      c.history.forEach((e: any) => list.append(h('li', null, h('span', { class: 'when' }, String(e.date).replace('T', ' ').slice(0, 16)), h('span', { class: 'what' }, h('b', null, e.body), e.description))));
      return list;
    }
    if (Array.isArray(c.authors)) return h('div', null, c.text ? h('div', { class: 'ex-doc' }, c.text) : null, h('div', { class: 'ex-tags' }, ...c.authors.map((a: string) => h('span', { class: 'badge' }, a))));
    return h('div', null, c.heading ? h('p', { class: 'badge', style: 'margin-bottom:10px' }, c.heading) : null, h('div', { class: 'ex-doc' }, q.summary));
  }

  function input(q: Q) {
    const type = q.answer.type;
    if (type === 'set') {
      const tags: string[] = [];
      const field = h('input', { type: 'text', id: 'quiz-answer', autocomplete: 'off', placeholder: 'Digite e tecle Enter para cada item' });
      const box = h('div', { class: 'tag-input', onclick: () => field.focus() });
      const draw = () => {
        box.replaceChildren(
          ...tags.map((t, i) =>
            h('span', { class: 'tag' }, t, h('button', { type: 'button', 'aria-label': `Remover ${t}`, onclick: () => (tags.splice(i, 1), draw(), field.focus()) }, icon('x', 12))),
          ),
          field,
        );
      };
      const commit = () => {
        const v = field.value.replace(/[;,]$/, '').trim();
        if (v && !tags.some((t) => normalize(t) === normalize(v))) tags.push(v);
        field.value = '';
        draw();
        field.focus();
      };
      field.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ';' || e.key === ',') && field.value.trim()) {
          e.preventDefault();
          e.stopPropagation();
          commit();
        } else if (e.key === 'Backspace' && !field.value && tags.length) {
          tags.pop();
          draw();
          field.focus();
        }
      });
      draw();
      return {
        el: h('div', null, box, h('p', { class: 'hint' }, 'Um item por vez. Enter vazio confere a resposta.')),
        value: () => {
          if (field.value.trim()) commit();
          return tags.join(';');
        },
        focus: () => field.focus(),
        box,
        tags,
        invalid: (on: boolean) => box.toggleAttribute('data-invalid', on),
        lock: () => {
          field.disabled = true;
          $$('button', box).forEach((b) => b.remove());
        },
      };
    }
    if (type === 'integer') {
      const field = h('input', { type: 'number', inputmode: 'numeric', id: 'quiz-answer', step: '1', autocomplete: 'off' });
      const bump = (d: number) => {
        field.value = String((parseInt(field.value || '0', 10) || 0) + d);
        field.focus();
      };
      const box = h(
        'div',
        { class: 'num-input' },
        h('button', { type: 'button', 'aria-label': 'Diminuir', onclick: () => bump(-1) }, icon('minus', 16)),
        field,
        h('button', { type: 'button', 'aria-label': 'Aumentar', onclick: () => bump(1) }, icon('plus', 16)),
      );
      return {
        el: h('div', null, box, h('p', { class: 'hint' }, 'Número inteiro. Setas do teclado também ajustam.')),
        value: () => field.value.trim(),
        focus: () => field.focus(),
        invalid: (on: boolean) => box.toggleAttribute('data-invalid', on),
        lock: () => {
          field.disabled = true;
          $$('button', box).forEach((b) => ((b as HTMLButtonElement).disabled = true));
        },
      };
    }
    const field = h('input', { type: 'text', class: 'text-input', id: 'quiz-answer', autocomplete: 'off', placeholder: 'Sua resposta' });
    return {
      el: h('div', null, field, h('p', { class: 'hint' }, 'Maiúsculas e espaços extras não contam. Acentos e grafia, sim.')),
      value: () => field.value.trim(),
      focus: () => field.focus(),
      invalid: (on: boolean) => field.setAttribute('aria-invalid', String(on)),
      lock: () => (field.disabled = true),
    };
  }

  function show(first = false) {
    const q = items[index];
    steps.forEach((s, i) => s.setAttribute('data-s', i < index ? tone(results[i]) : i === index ? 'now' : ''));
    $('[data-q-count]', root)!.textContent = `${index + 1} de ${items.length}`;
    const field = input(q);
    const check = h('button', { type: 'button', class: 'btn btn--ink' }, 'Conferir', h('kbd', { style: 'margin-left:4px;background:transparent;color:#8192a7;box-shadow:inset 0 0 0 1px rgba(255,255,255,.2)' }, '↵'));
    const skip = h('button', { type: 'button', class: 'btn btn--ghost' }, 'Pular');
    const actions = h('div', { class: 'quiz-actions' }, check, skip);
    const verdictSlot = h('div');
    body.replaceChildren(
      h('div', { class: 'ex-tags', style: 'margin:0' }, h('span', { class: 'code-tag' }, q.track), h('span', { class: 'badge' }, q.task), h('span', { class: 'badge badge--muted' }, q.chamber)),
      h('h2', { class: 'quiz-q', id: 'quiz-q' }, q.prompt),
      h('div', { class: 'ex-block' }, h('p', { class: 'specimen-label' }, 'Contexto'), contextView(q)),
      h('div', { class: 'quiz-answer' }, h('label', { for: 'quiz-answer' }, 'Sua resposta'), field.el),
      actions,
      verdictSlot,
    );
    swap(body);
    let done = false;
    const submit = (skipped = false) => {
      if (done) return;
      const value = field.value();
      if (!value && !skipped) {
        field.invalid(true);
        check.classList.add('is-refused');
        setTimeout(() => check.classList.remove('is-refused'), 300);
        field.focus();
        return;
      }
      done = true;
      field.invalid(false);
      field.lock();
      const score = skipped ? 0 : quizScore(q.answer.type, q.answer.value, value);
      results[index] = score;
      setScore();
      steps[index].setAttribute('data-s', tone(score));
      verdictSlot.replaceChildren(verdict(q, score, value, skipped));
      const last = index === items.length - 1;
      const next = h('button', { type: 'button', class: 'btn' }, last ? 'Ver resultado' : 'Próxima', icon('arrowRight', 16));
      next.addEventListener('click', () => {
        index++;
        if (index < items.length) show();
        else finish();
      });
      actions.replaceChildren(next);
      next.focus();
      announce(score === 1 ? 'Resposta certa.' : score > 0 ? 'Resposta parcialmente certa.' : 'Resposta diferente do gabarito.');
    };
    check.addEventListener('click', () => submit());
    skip.addEventListener('click', () => submit(true));
    body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && !done && (e.target as HTMLElement).id === 'quiz-answer') {
        e.preventDefault();
        submit();
      }
    });
    if (!first) {
      // Só depois de uma ação de quem responde: foca sem pular e traz o card de volta se ele saiu da tela.
      focusQuietly(body.querySelector<HTMLElement>('#quiz-answer'));
      const top = root!.getBoundingClientRect().top;
      if (top < 0 || top > innerHeight * 0.6) root!.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function verdict(q: Q, score: number, value: string, skipped: boolean) {
    const t = tone(score);
    const title = skipped ? 'Pulada' : score === 1 ? 'Certa' : score > 0 ? `Metade do caminho: ${fmt(score)} ponto` : 'Diferente do gabarito';
    const expected: string[] = Array.isArray(q.answer.value) ? q.answer.value.map(String) : [q.answer.value === '' ? '(abster-se)' : String(q.answer.value)];
    let tokens: HTMLElement[];
    if (q.answer.type === 'set') {
      const want = new Set(expected.map(normalize));
      const got = value.split(';').map((s) => s.trim()).filter(Boolean);
      const gotN = new Set(got.map(normalize));
      tokens = [
        ...got.map((g) => h('span', { class: 'tag', 'data-hit': want.has(normalize(g)) ? '1' : '0' }, g)),
        ...expected.filter((e) => !gotN.has(normalize(e))).map((e) => h('span', { class: 'tag', 'data-hit': 'miss', title: 'Faltou' }, `faltou: ${e}`)),
      ];
    } else tokens = expected.map((e) => h('span', { class: 'answer-token' }, e));
    const ev = q.evidence[0];
    return h(
      'div',
      { class: 'verdict', 'data-tone': t },
      h('h3', null, icon(t === 'ok' ? 'checkCircle' : t === 'part' ? 'circleHalf' : 'xCircle', 18), title),
      h('div', { class: 'row' }, q.answer.type === 'set' ? null : h('span', { class: 'fine', style: 'margin-right:4px' }, 'Gabarito:'), ...tokens),
      q.models.length
        ? h('p', null, `Nesta tarefa e casa, ${q.models.map((m) => `${m.label} acerta ${pct(m.mean)}`).join('; ')} das vezes, com o mesmo contexto.`)
        : null,
      ev ? h('p', null, 'Fonte: ', h('a', { class: 'link', href: ev.url, target: '_blank', rel: 'noopener' }, ev.ref)) : null,
    );
  }

  function finish() {
    steps.forEach((s, i) => s.setAttribute('data-s', tone(results[i])));
    const total = results.reduce((a, b) => a + b, 0);
    $('[data-q-count]', root)!.textContent = 'Resultado';
    const share = `Fiz ${fmt(total)} de ${items.length} no desafio do Teor, o benchmark de IA sobre o Congresso.`;
    const again = h('button', { type: 'button', class: 'btn' }, icon('reset', 16), 'Refazer');
    again.addEventListener('click', () => {
      results.length = 0;
      index = 0;
      setScore();
      show();
    });
    body.replaceChildren(
      h('h2', { class: 'quiz-q', tabindex: '-1', id: 'quiz-end' }, `${fmt(total)} de ${items.length} pontos.`),
      h('div', { class: 'result-dots', role: 'img', 'aria-label': results.map((r, i) => `pergunta ${i + 1}: ${fmt(r)}`).join(', ') }, ...results.map((r, i) => h('i', { 'data-s': tone(r), style: `--i:${i}` }, String(i + 1)))),
      h('p', { class: 'body', style: 'margin-top:20px' }, 'As notas dos modelos nestas tarefas estão na matriz de capacidades. Lá cada fatia vem com intervalo de confiança, coisa que dez perguntas não permitem.'),
      h(
        'div',
        { class: 'quiz-actions' },
        again,
        h('button', { type: 'button', class: 'btn btn--outline copy', 'data-copy': share }, icon('copy', 16, 'ico-copy'), icon('check', 16, 'ico-check'), 'Copiar resultado'),
        h('a', { class: 'btn btn--ghost', href: `${(document.querySelector('[data-logo]') as HTMLAnchorElement).getAttribute('href')}#resultados` }, 'Ver a matriz'),
      ),
    );
    swap(body);
    import('./ui/controls').then((m) => m.mountCopy(body));
    focusQuietly($<HTMLElement>('#quiz-end'));
  }

  show(true);
}
