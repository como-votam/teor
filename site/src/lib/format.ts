const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('pt-BR');
export const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || Number.isNaN(v)
    ? '—'
    : `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
export const pctInt = (v: number) => `${Math.round(v * 100)}`;
/** Diferença em pontos percentuais, sempre com sinal. */
export const pp = (v: number) => {
  const n = v * 100;
  const s = Math.abs(n) < 0.05 ? '0,0' : nf1.format(Math.abs(n));
  return `${n > 0.049 ? '+' : n < -0.049 ? '−' : '±'}${s} pp`;
};
export const int = (v: number) => nf0.format(v);
export const compact = (v: number) =>
  new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
export const usd = (v: number | null) =>
  v === null ? 'não informado' : v === 0 ? 'US$ 0' : `US$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: v < 1 ? 4 : 2 })}`;
export const secs = (v: number | null) =>
  v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} s`;
export const date = (iso: string) =>
  iso
    ? new Date(iso).toLocaleDateString('pt-BR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'America/Sao_Paulo',
      })
    : '—';
export const shortHash = (h: string) => h.slice(0, 8);
/** Fundo e texto de célula na escala sequencial de um matiz (texto claro só nos tons escuros). */
export function seqColor(v: number) {
  const step = Math.max(0, Math.min(6, Math.round(v * 6)));
  return { bg: `var(--seq-${step})`, fg: step >= 4 ? '#fff' : 'var(--color-ink)' };
}
/** Diferença contra a melhor referência: cinza neutro no zero, tinta acima, terracota abaixo. */
export function liftColor(d: number) {
  const a = Math.min(1, Math.abs(d) / 0.6);
  if (Math.abs(d) < 0.005) return { bg: 'var(--color-bg-subtle)', fg: 'var(--color-placeholder)' };
  const mix = Math.round(14 + a * 70);
  return d > 0
    ? { bg: `color-mix(in oklab, var(--seq-6) ${mix}%, var(--seq-0))`, fg: mix > 48 ? '#fff' : 'var(--color-ink)' }
    : { bg: `color-mix(in oklab, var(--color-absence) ${mix}%, #faf6f3)`, fg: mix > 52 ? '#fff' : 'var(--color-ink)' };
}
