import { pages, markdownPath, imagePath, resultPath } from '../lib/seo/registry';
import { urls, indexable } from '../lib/seo/config';
import { data } from '../data';
export function GET() {
  return new Response(
    JSON.stringify(
      {
        site: urls.origin,
        base: urls.base,
        indexable,
        pages: pages.map((p) => ({
          path: p.path,
          canonical: urls.absolute(p.path),
          title: p.title,
          description: p.description,
          index: p.index,
          markdown: markdownPath(p),
          image: imagePath(p),
        })),
        results: data.results.map((r) => ({ id: r.id, path: resultPath(r) })),
      },
      null,
      2,
    ),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
}
