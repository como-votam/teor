import { data, slug } from '../../data';
import { publicResult } from '../../lib/seo/registry';
import type { APIRoute } from 'astro';
export function getStaticPaths() {
  return data.results.map((result) => ({ params: { run: slug(result.id) }, props: { result } }));
}
export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify(publicResult(props.result), null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
