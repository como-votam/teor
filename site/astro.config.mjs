import { defineConfig } from 'astro/config';
import { urls } from './src/lib/seo/config.ts';

export default defineConfig({
  site: urls.origin,
  trailingSlash: 'always',
  output: 'static',
  base: urls.base,
  vite: { optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] } },
});
