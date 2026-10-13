export const DEFAULT_SITE = 'https://teor.comovotam.com.br';
export const REPOSITORY = 'https://github.com/como-votam/teor';
export const ORGANIZATION_ID = 'https://comovotam.com.br/#organization';
export function createUrls(site = DEFAULT_SITE, base = '/') {
  const origin = new URL(site);
  if (
    !['https:', 'http:'].includes(origin.protocol) ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  )
    throw new Error(
      'TEOR_SITE_URL deve conter apenas a origem HTTP(S), sem caminho ou credenciais.',
    );
  const prefix = `/${base.split('/').filter(Boolean).join('/')}${base.split('/').filter(Boolean).length ? '/' : ''}`;
  if (!/^\/[a-zA-Z0-9/_-]*$/.test(prefix)) throw new Error('TEOR_BASE inválido.');
  const path = (relative = '') => `${prefix}${relative.replace(/^\/+/, '')}`;
  const absolute = (relative = '') => new URL(path(relative), origin).href;
  const relative = (pathname: string) =>
    pathname.startsWith(prefix) ? pathname.slice(prefix.length) : null;
  return { origin: origin.origin, base: prefix, path, absolute, relative };
}
export const urls = createUrls(
  process.env.TEOR_SITE_URL || DEFAULT_SITE,
  process.env.TEOR_BASE || import.meta.env?.BASE_URL || '/',
);
export const indexable = process.env.TEOR_INDEXABLE !== 'false';
export const SOURCES = [
  { name: 'Câmara dos Deputados — dados abertos', url: 'https://dadosabertos.camara.leg.br/' },
  { name: 'Senado Federal — dados abertos', url: 'https://www12.senado.leg.br/dados-abertos' },
  {
    name: 'Constituição Federal — Presidência da República',
    url: 'https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm',
  },
];
export function serializeJson(value: unknown) {
  const slash = String.fromCharCode(92);
  return JSON.stringify(value)
    .replaceAll('<', slash + 'u003c')
    .replaceAll(String.fromCharCode(0x2028), slash + 'u2028')
    .replaceAll(String.fromCharCode(0x2029), slash + 'u2029');
}
export const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
