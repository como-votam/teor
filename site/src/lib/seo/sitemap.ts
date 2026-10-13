import { pages } from './registry';
import { urls, escapeXml } from './config';
const size = 50000;
export const sitemapParts = ['paginas', 'modelos'].flatMap((family) => {
  const group = pages.filter((p) => p.index && (family === 'modelos' ? !!p.model : !p.model));
  return Array.from({ length: Math.ceil(group.length / size) }, (_, i) => ({
    name: `${family}-${i + 1}`,
    pages: group.slice(i * size, (i + 1) * size),
  }));
});
export const sitemapIndex = () =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemapParts.map((part) => `<sitemap><loc>${escapeXml(urls.absolute(`sitemaps/${part.name}.xml`))}</loc></sitemap>`).join('')}</sitemapindex>`;
export const sitemapBody = (part: (typeof sitemapParts)[number]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${part.pages.map((p) => `<url><loc>${escapeXml(urls.absolute(p.path))}</loc></url>`).join('')}</urlset>`;
