import { urls, indexable } from '../lib/seo/config';
export function GET() {
  return new Response(
    indexable
      ? `User-agent: *\nAllow: ${urls.base}\n\n# Preferências do benchmark: descoberta e citação não autorizam treinamento.\nUser-agent: GPTBot\nDisallow: ${urls.base}\n\nUser-agent: ClaudeBot\nDisallow: ${urls.base}\n\nSitemap: ${urls.absolute('sitemap.xml')}\n`
      : `User-agent: *\nDisallow: ${urls.base}\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
