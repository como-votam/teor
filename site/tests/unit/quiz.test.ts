import { describe, it, expect } from 'vitest';
import { quizScore } from '../../src/lib/quiz';
describe('Correção do quiz', () => {
  it('não aceita conversão implícita de inteiro', () => {
    expect(quizScore('integer', 187, '187')).toBe(1);
    expect(quizScore('integer', 187, '187x')).toBe(0);
    expect(quizScore('integer', 0, '')).toBe(0);
  });
  it('normaliza texto sem apagar conteúdo', () => {
    expect(quizScore('string', 'Maioria absoluta', '  maioria ABSOLUTA ')).toBe(1);
    expect(quizScore('string', 'Não', 'Nao')).toBe(0);
  });
  it('corrige conjuntos parcialmente sem contar duplicatas', () => {
    expect(quizScore('set', ['a', 'b'], 'a; a')).toBeCloseTo(2 / 3);
  });
});
