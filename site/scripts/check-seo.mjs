import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import sharp from 'sharp';
const root = path.resolve(process.argv[2] || 'dist');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const manifest = JSON.parse(read('seo-manifest.json'));
const urls = new Set(),
  titles = new Set(),
  descriptions = new Set();
const localFile = (url) => {
  const parsed = new URL(url, manifest.site);
  if (parsed.origin !== manifest.site) return null;
  assert.ok(parsed.pathname.startsWith(manifest.base), `URL fora de TEOR_BASE: ${url}`);
  const relative = parsed.pathname.slice(manifest.base.length);
  return path.join(
    root,
    relative.endsWith('/') ? relative + 'index.html' : relative || 'index.html',
  );
};
function checkLink(url) {
  const filename = localFile(url);
  if (filename) assert.ok(fs.existsSync(filename), `Artefato ausente: ${url}`);
}
const sitemap = load(read('sitemap.xml'), { xmlMode: true });
const sitemapUrls = [];
for (const element of sitemap('sitemap loc').toArray()) {
  const location = sitemap(element).text();
  checkLink(location);
  const xml = load(fs.readFileSync(localFile(location), 'utf8'), { xmlMode: true });
  assert.ok(xml('url').length <= 50000, 'Sitemap excede 50 mil URLs');
  xml('url loc').each((_, el) => {
    const url = xml(el).text();
    sitemapUrls.push(url);
    checkLink(url);
  });
}
assert.equal(new Set(sitemapUrls).size, sitemapUrls.length, 'URLs duplicadas nos sitemaps');
assert.deepEqual(
  [...sitemapUrls].sort(),
  manifest.pages
    .filter((p) => p.index)
    .map((p) => p.canonical)
    .sort(),
  'Sitemap diverge da política de indexação',
);
const llms = read('llms.txt');
for (const page of manifest.pages) {
  assert.ok(!urls.has(page.canonical), 'URL canônica duplicada');
  urls.add(page.canonical);
  const $ = load(read(page.path + 'index.html'));
  assert.equal($('html').attr('lang'), 'pt-BR');
  assert.equal($('title').length, 1);
  assert.equal($('title').text(), page.title);
  assert.ok(!titles.has(page.title), `Título duplicado: ${page.title}`);
  titles.add(page.title);
  assert.equal($('meta[name=description]').attr('content'), page.description);
  assert.ok(!descriptions.has(page.description), `Descrição duplicada: ${page.description}`);
  descriptions.add(page.description);
  assert.equal($('link[rel=canonical]').attr('href'), page.canonical);
  assert.equal(new URL(page.canonical).search, '');
  assert.equal(new URL(page.canonical).hash, '');
  assert.equal($('meta[property="og:url"]').attr('content'), page.canonical);
  assert.equal($('meta[property="og:title"]').attr('content'), page.title);
  assert.equal($('meta[name="twitter:title"]').attr('content'), page.title);
  assert.equal($('meta[property="og:description"]').attr('content'), page.description);
  assert.equal($('meta[name="twitter:description"]').attr('content'), page.description);
  assert.ok(
    ($('meta[name=robots]').attr('content') || '').startsWith(page.index ? 'index,' : 'noindex,'),
  );
  assert.equal($('h1').length, 1, `H1 ausente ou duplicado: ${page.path}`);
  for (const element of $('head link[href]').toArray())
    checkLink(new URL($(element).attr('href'), page.canonical).href);
  const alternate = $('link[rel=alternate][type="text/markdown"]').attr('href');
  checkLink(alternate);
  assert.equal(alternate, manifest.base + page.markdown);
  const markdown = read(page.markdown);
  assert.ok(markdown.includes('canonical: ' + JSON.stringify(page.canonical)));
  if (page.index)
    assert.ok(
      llms.includes(new URL(alternate, manifest.site).href),
      `Markdown ausente no llms.txt: ${alternate}`,
    );
  const script = $('script[type="application/ld+json"]');
  assert.equal(script.length, 1);
  const graph = JSON.parse(script.text());
  assert.equal(graph['@context'], 'https://schema.org');
  const ids = graph['@graph'].map((node) => node['@id']);
  assert.equal(new Set(ids).size, ids.length, 'IDs duplicados no JSON-LD');
  assert.ok(ids.includes(page.canonical + '#webpage'));
  for (const node of graph['@graph']) {
    assert.ok(node['@type']);
    if (node['@type'] === 'Dataset') {
      assert.ok(node.name && node.description.length >= 50);
      const distributions = node.distribution
        ? Array.isArray(node.distribution)
          ? node.distribution
          : [node.distribution]
        : [];
      distributions.forEach((distribution) => checkLink(distribution.contentUrl));
    }
  }
  const json = markdown.match(/## Dados estruturados da página\s+```json\s+([\s\S]*?)\s+```/);
  assert.ok(json, `JSON-LD ausente no Markdown: ${page.path}`);
  assert.deepEqual(JSON.parse(json[1]), graph);
  const image = $('meta[property="og:image"]').attr('content');
  checkLink(image);
  assert.equal($('meta[name="twitter:image"]').attr('content'), image);
  const info = await sharp(localFile(image)).metadata();
  assert.equal(info.format, 'png');
  assert.equal(info.width, 1200);
  assert.equal(info.height, 630);
  for (const element of $('a[href]').toArray()) {
    const href = $(element).attr('href');
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/.test(href)) continue;
    const target = new URL(href, page.canonical);
    checkLink(target.href);
    if (target.origin === manifest.site && target.hash && target.pathname.endsWith('/')) {
      const targetHtml = load(fs.readFileSync(localFile(target.href), 'utf8'));
      const id = decodeURIComponent(target.hash.slice(1));
      assert.ok(
        targetHtml('[id]')
          .toArray()
          .some(
            (el) =>
              targetHtml(el).attr('id') === id ||
              targetHtml(el).attr('id') === target.hash.slice(1),
          ),
        `Âncora quebrada: ${target.href}`,
      );
    }
  }
}
const notFound = load(read('404.html'));
assert.match(notFound('meta[name=robots]').attr('content'), /^noindex/);
const review = load(read('review-local.html'));
assert.match(review('meta[name=robots]').attr('content'), /^noindex/);
const robots = read('robots.txt');
assert.ok(
  manifest.indexable
    ? robots.includes('Sitemap: ' + new URL(manifest.base + 'sitemap.xml', manifest.site).href)
    : robots.includes('Disallow: ' + manifest.base),
);
assert.equal(
  new Set(manifest.results.map((r) => r.path)).size,
  manifest.results.length,
  'Arquivos de execução duplicados',
);
const catalog = JSON.parse(read('resultados/index.json'));
assert.equal(catalog.results.length, manifest.results.length);
for (const result of catalog.results) {
  checkLink(result.url);
  const report = JSON.parse(fs.readFileSync(localFile(result.url), 'utf8'));
  assert.equal(report.id, result.id);
  assert.equal(report.model, result.model);
  assert.equal(report.dataset_hash, result.dataset_hash);
  assert.equal(report.protocol_hash, result.protocol_hash);
  assert.ok(!('config' in report), 'Configuração bruta não deve ser redistribuída neste endpoint');
}
for (const filename of [
  'llms-full.txt',
  'CITATION.cff',
  'citation.bib',
  'feed.xml',
  'site.webmanifest',
])
  assert.ok(read(filename).length > 20);
console.log(
  `SEO/GEO: ${manifest.pages.length} páginas, ${sitemapUrls.length} URLs indexáveis e ${catalog.results.length} relatórios públicos conferidos. Metadados, HTML/Markdown/JSON-LD, links, imagens e indexação consistentes.`,
);
