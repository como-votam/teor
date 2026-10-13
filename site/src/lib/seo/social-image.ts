import fs from 'node:fs';
import sharp from 'sharp';
import { create, type Font } from 'fontkitten';
import type { Page } from './registry';
const headline = create(
  fs.readFileSync('node_modules/@fontsource/newsreader/files/newsreader-latin-500-normal.woff'),
) as Font;
const body = create(
  fs.readFileSync('node_modules/@fontsource/public-sans/files/public-sans-latin-400-normal.woff'),
) as Font;
function width(text: string, font: Font, size: number) {
  return (
    (font.glyphsForString(text).reduce((sum, g) => sum + g.advanceWidth, 0) * size) /
    font.unitsPerEm
  );
}
function textPath(text: string, font: Font, size: number, x: number, y: number, color: string) {
  const scale = size / font.unitsPerEm;
  let offset = 0;
  const paths = font
    .glyphsForString(text)
    .map((g) => {
      const node = `<path transform="translate(${offset} 0)" d="${g.path.toSVG()}"/>`;
      offset += g.advanceWidth;
      return node;
    })
    .join('');
  return `<g fill="${color}" transform="translate(${x} ${y}) scale(${scale} ${-scale})">${paths}</g>`;
}
export async function socialImage(p: Page) {
  const logo = fs
    .readFileSync('public/brand.svg', 'utf8')
    .replace('<svg ', '<svg x="72" y="64" width="42" height="48" ');
  const title = p.name === 'Teor' ? 'Benchmark de IA para o Legislativo brasileiro' : p.name;
  const lines: string[] = [];
  let line = '';
  for (const word of title.split(/\s+/)) {
    const next = `${line}${line ? ' ' : ''}${word}`;
    if (line && width(next, headline, 60) > 1020) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#f9f9fb"/>${logo}${textPath('teor', headline, 42, 132, 102, '#041627')}${textPath('por Como Votam', body, 18, 132, 130, '#44474c')}<rect x="72" y="184" width="40" height="4" rx="2" fill="#1b6d24"/>${lines
    .slice(0, 4)
    .map((line, i) => textPath(line, headline, 60, 72, 270 + i * 66, '#041627'))
    .join(
      '',
    )}${textPath('Fontes oficiais · Protocolo público · Métricas por tarefa', body, 20, 72, 558, '#44474c')}<path d="M1040 160h80v80m-80 0 80-80" fill="none" stroke="#1b6d24" stroke-width="4" stroke-linecap="round"/></svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}
