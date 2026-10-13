import { sitemapParts, sitemapBody } from '../../lib/seo/sitemap';
import type { APIRoute } from 'astro';
export function getStaticPaths() {
  return sitemapParts.map((part) => ({ params: { name: part.name }, props: { part } }));
}
export const GET: APIRoute = ({ props }) =>
  new Response(sitemapBody(props.part), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
