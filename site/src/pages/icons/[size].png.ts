import fs from 'node:fs';
import sharp from 'sharp';
import type { APIRoute } from 'astro';
export function getStaticPaths() {
  return [48, 180, 192, 512].map((size) => ({ params: { size: String(size) }, props: { size } }));
}
export const GET: APIRoute = async ({ props }) =>
  new Response(
    new Uint8Array(
      await sharp(fs.readFileSync('public/favicon.svg'))
        .resize(props.size, props.size)
        .png()
        .toBuffer(),
    ),
    { headers: { 'Content-Type': 'image/png' } },
  );
