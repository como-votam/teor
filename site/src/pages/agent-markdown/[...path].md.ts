import { pages, markdownPath } from '../../lib/seo/registry';
import { markdownDocument } from '../../lib/seo/markdown';
import type { APIRoute } from 'astro';
export function getStaticPaths() {
  return pages.map((page) => ({
    params: {
      path: markdownPath(page)
        .replace(/^agent-markdown\//, '')
        .replace(/\.md$/, ''),
    },
    props: { page },
  }));
}
export const GET: APIRoute = ({ props }) =>
  new Response(markdownDocument(props.page), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
