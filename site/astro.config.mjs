import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://teor.comovotam.com.br',
  output: 'static',
  base: process.env.TEOR_BASE || '/',
  vite: { optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] } },
});
