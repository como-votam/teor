export function normalize(value: unknown): string {
  return String(value).normalize('NFKC').toLocaleLowerCase('pt-BR').trim().replace(/\s+/g, ' ');
}
export function quizScore(type: string, expected: unknown, response: string): number {
  if (type === 'integer')
    return /^-?\d+$/.test(response.trim()) && Number(response) === expected ? 1 : 0;
  if (type === 'set') {
    const wanted = new Set((expected as string[]).map(normalize));
    const actual = new Set(response.split(';').map(normalize).filter(Boolean));
    const intersection = [...actual].filter((v) => wanted.has(v)).length;
    return wanted.size + actual.size ? (2 * intersection) / (wanted.size + actual.size) : 1;
  }
  return normalize(response) === normalize(expected) ? 1 : 0;
}
