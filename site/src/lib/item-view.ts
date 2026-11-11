// Resumo legível de um item para o espécime da home e para o quiz.
import type { Item } from '../data';

export function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\d*\./, '');
  } catch {
    return url;
  }
}

/** Uma frase que descreve o contexto entregue ao modelo, sem despejar JSON. */
export function contextSummary(item: Pick<Item, 'context'>): string {
  const c = item.context as Record<string, any>;
  if (!c || !Object.keys(c).length) return 'Nenhum: o modelo recebe só o identificador do registro.';
  if (c.text) return String(c.text);
  if (Array.isArray(c.history)) {
    const bodies = c.history.map((e: { body: string }) => e.body);
    return `${c.history.length} eventos de tramitação, de ${bodies[0]} a ${bodies[bodies.length - 1]}.`;
  }
  if (Array.isArray(c.votes)) {
    const tally: Record<string, number> = {};
    for (const v of c.votes) tally[v.vote ?? 'sem registro'] = (tally[v.vote ?? 'sem registro'] || 0) + 1;
    const parts = Object.entries(tally)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, n]) => `${n} ${k}`);
    return `Lista com ${c.votes.length} votos nominais${parts.length ? ` (${parts.join(', ')})` : ''}${c.result ? `. Resultado registrado: ${c.result}` : ''}.`;
  }
  if (c.result) return `Resultado registrado: ${c.result}.`;
  if (Array.isArray(c.themes)) return `Temas: ${c.themes.join(', ')}.`;
  if (Array.isArray(c.documents)) return `${c.documents.length} documento(s) oficial(is) na íntegra.`;
  return JSON.stringify(c).slice(0, 220);
}

export function answerTokens(item: Pick<Item, 'answer'>): string[] {
  const v = item.answer.value as unknown;
  if (Array.isArray(v)) return v.map(String);
  if (v === '' || v === null) return ['abster-se'];
  if (typeof v === 'object') return ['afirmações com trecho literal'];
  return [String(v)];
}
