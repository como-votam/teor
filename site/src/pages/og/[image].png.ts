import { pages, imagePath } from '../../lib/seo/registry';
import { socialImage } from '../../lib/seo/social-image';
import type { APIRoute } from 'astro';
export function getStaticPaths() {
  return pages.map((page) => ({
    params: {
      image: imagePath(page)
        .replace(/^og\//, '')
        .replace(/\.png$/, ''),
    },
    props: { page },
  }));
}
export const GET: APIRoute = async ({ props }) =>
  new Response(await socialImage(props.page), { headers: { 'Content-Type': 'image/png' } });
