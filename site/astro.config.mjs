import { defineConfig } from 'astro/config';
import { urls } from './src/lib/seo/config.ts';

// Documentos em ../docs se referem uns aos outros por arquivo .md. No site, cada um vira a página
// correspondente; os que não têm página apontam para o arquivo no repositório.
const docPages = {
  'metodologia.md': 'metodologia/',
  'dataset-card.md': 'dados/',
  'erratas.md': 'erratas/',
  'contribuir.md': 'contribuir/',
  'revisar.md': 'revisar/',
  'interpretacao.md': 'analises/interpretacao/',
};
function docLinks() {
  const rewrite = (url) => {
    const [file, hash = ''] = url.replace(/^\.\//, '').split('#');
    const name = file.split('/').pop();
    return docPages[name]
      ? urls.path(docPages[name]) + (hash ? `#${hash}` : '')
      : `https://github.com/como-votam/teor/blob/main/docs/${file}${hash ? `#${hash}` : ''}`;
  };
  return {
    name: 'teor-doc-links',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const walk = (d) =>
          fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
            e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.html') ? [path.join(d, e.name)] : [],
          );
        for (const file of walk(fileURLToPath(dir))) {
          const html = fs.readFileSync(file, 'utf8');
          const next = html.replace(/href="(\w[\w.-]*(?:\/[\w.-]+)*\.md(?:#[^"]*)?)"/g, (_, url) => `href="${rewrite(url)}"`);
          if (next !== html) fs.writeFileSync(file, next);
        }
      },
    },
  };
}

export default defineConfig({
  site: urls.origin,
  trailingSlash: 'always',
  output: 'static',
  base: urls.base,
  integrations: [docLinks()],
  vite: { optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] } },
});
