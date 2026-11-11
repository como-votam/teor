import type { APIRoute } from 'astro';
import { itemSummaries } from '../../data/derived';

// Índice leve: o explorador e a busca rápida filtram tudo no navegador sem baixar contexto.
export const GET: APIRoute = () =>
  new Response(JSON.stringify(itemSummaries), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
