import { data } from '../data';
import { urls, escapeXml } from '../lib/seo/config';
import { modelPages } from '../lib/seo/registry';
export function GET() {
  const e = escapeXml;
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Teor — execuções publicadas</title><link>${e(urls.absolute())}</link><description>Execuções documentadas do benchmark legislativo, incluindo baselines. Compare somente condições equivalentes.</description><language>pt-BR</language><atom:link href="${e(urls.absolute('feed.xml'))}" rel="self" type="application/rss+xml"/>${[
      ...data.results,
    ]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((r) => {
        const link = urls.absolute(
          `${modelPages.find((p) => p.model === r.model)!.path}#execucao-${encodeURIComponent(r.id)}`,
        );
        return `<item><title>${e(`${r.model} — ${r.id}`)}</title><link>${e(link)}</link><guid isPermaLink="true">${e(link)}</guid><description>${e(`Execução ${r.complete ? 'completa' : 'incompleta'}, cobertura ${(r.usage.coverage * 100).toFixed(1)}%, verificação ${r.verification}. Conjunto ${r.dataset_hash}; protocolo ${r.protocol_hash}.`)}</description>${Number.isFinite(Date.parse(r.created_at)) ? `<pubDate>${new Date(r.created_at).toUTCString()}</pubDate>` : ''}</item>`;
      })
      .join('')}</channel></rss>`,
    { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } },
  );
}
