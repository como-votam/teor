import type { APIRoute } from 'astro';
import { items } from '../../data/derived';

export function getStaticPaths() {
  return items.map((item) => ({ params: { id: item.id }, props: { item } }));
}
export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify(props.item), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
