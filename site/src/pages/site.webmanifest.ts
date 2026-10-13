import { urls } from '../lib/seo/config';
export function GET() {
  return new Response(
    JSON.stringify({
      name: 'Teor — benchmark legislativo',
      short_name: 'Teor',
      lang: 'pt-BR',
      start_url: urls.path(),
      scope: urls.base,
      display: 'browser',
      background_color: '#f9f9fb',
      theme_color: '#f9f9fb',
      icons: [
        { src: urls.path('favicon.svg'), sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        { src: urls.path('icons/192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: urls.path('icons/512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      ],
    }),
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
}
