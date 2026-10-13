import { data } from '../../data';
import { urls } from '../../lib/seo/config';
import { resultPath } from '../../lib/seo/registry';
export function GET() {
  return new Response(
    JSON.stringify(
      {
        name: 'Métricas públicas do Teor',
        url: urls.absolute(),
        methodology: urls.absolute('metodologia/'),
        data_policy: urls.absolute('dados/'),
        results: data.results.map((r) => ({
          id: r.id,
          model: r.model,
          dataset_hash: r.dataset_hash,
          protocol_hash: r.protocol_hash,
          created_at: r.created_at,
          verification: r.verification,
          url: urls.absolute(resultPath(r)),
        })),
      },
      null,
      2,
    ),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
}
