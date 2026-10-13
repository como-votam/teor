import { softwareVersion } from '../lib/seo/citation';
import { urls } from '../lib/seo/config';
export function GET() {
  return new Response(
    `@software{comovotam_teor,\n  author = {{Como Votam}},\n  title = {Teor: benchmark aberto do processo legislativo brasileiro},\n  version = {${softwareVersion}},\n  url = {${urls.absolute()}},\n  note = {Cite também os hashes do conjunto e do protocolo da avaliação}\n}\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
