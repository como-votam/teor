import { sitemapIndex } from '../lib/seo/sitemap';
export function GET() {
  return new Response(sitemapIndex(), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
