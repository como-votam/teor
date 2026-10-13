import { pages } from '../lib/seo/registry';
import { markdownDocument } from '../lib/seo/markdown';
export function GET() {
  return new Response(
    `# Teor — documentação pública completa\n\n${pages.map((p) => markdownDocument(p, false)).join('\n\n---\n\n')}`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
