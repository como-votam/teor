import { citationFile } from '../lib/seo/citation';
import { urls } from '../lib/seo/config';
export function GET() {
  return new Response(citationFile.replace(/^url:.*$/m, `url: ${urls.absolute()}`), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
