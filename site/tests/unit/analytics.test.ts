import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONSENT_COOKIE, CONSENT_MAX_AGE, consentCookie, privacySignal, readConsent } from '../../src/lib/analytics/consent';
import { isAnalyticsEvent, setAnalyticsSink, track } from '../../src/lib/analytics/events';
import { safeLocation, safeReferrer, validProjectId, type AnalyticsConfig } from '../../src/lib/analytics/privacy';

const config: AnalyticsConfig = {
  enabled: true, projectId: 'abc123456', origin: 'https://teor.example', page: '/base/',
  paths: ['/base/', '/base/explorador/', '/base/comparar/'],
  query: { a: ['public-run'], item: ['public-item'], chamber: ['camara', 'senado'] },
};
afterEach(() => { setAnalyticsSink(() => {}); vi.unstubAllGlobals(); });

describe('Consentimento e minimização', () => {
  it('exige uma escolha explícita na versão atual do cookie', () => {
    expect(readConsent('')).toBe('unset');
    expect(readConsent('cv_consent=granted; teor_analytics_consent=granted')).toBe('unset');
    expect(readConsent(`${CONSENT_COOKIE}=true`)).toBe('unset');
    expect(readConsent(`other=x; ${CONSENT_COOKIE}=granted`)).toBe('granted');
    expect(readConsent(`${CONSENT_COOKIE}=denied`)).toBe('denied');
  });
  it('persiste por 180 dias com escopo de host e proteção de transporte', () => {
    const cookie = consentCookie('denied', true);
    expect(CONSENT_MAX_AGE).toBe(180 * 24 * 60 * 60);
    expect(cookie).toContain('SameSite=Lax; Secure');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain=');
    expect(consentCookie('granted', false)).not.toContain('Secure');
  });
  it('respeita GPC e DNT mesmo com aceite armazenado', () => {
    expect(privacySignal({ globalPrivacyControl: true })).toBe(true);
    expect(privacySignal({ doNotTrack: '1' })).toBe(true);
    expect(privacySignal({ doNotTrack: '0' })).toBe(false);
  });
  it('aceita somente ID de projeto sem caminho ou código', () => {
    expect(validProjectId('abc123456')).toBe(true);
    for (const id of ['', 'x', '../abc', 'https://evil.example', 'abc\" onload=\"x']) expect(validProjectId(id)).toBe(false);
  });
  it('não permite URLs desconhecidas nem dados arbitrários em parâmetros', () => {
    for (const path of ['/base/?q=email@example.com', '/base/?token=secret', '/base/comparar/?a=private-name', '/base/?a=public-run&a=public-run', '/base/?constructor=x', '/base/#email@example.com', '/private-email@example.com/']) {
      expect(safeLocation(new URL(path, config.origin), config), path).toBe(false);
    }
    expect(safeLocation(new URL('https://fork.example/base/'), config)).toBe(false);
    expect(safeLocation(new URL('/base/explorador/?item=public-item&chamber=camara#sql', config.origin), config)).toBe(true);
  });
  it('não libera referrers que possam conter dados pessoais', () => {
    expect(safeReferrer('', config)).toBe(true);
    expect(safeReferrer('https://teor.example/base/', config)).toBe(true);
    expect(safeReferrer('https://teor.example/base/?q=private', config)).toBe(false);
    expect(safeReferrer('https://other.example/private', config)).toBe(false);
    expect(safeReferrer('invalid', config)).toBe(false);
  });
  it('recusa eventos arbitrários em runtime e isola falhas do provedor', () => {
    const sink = vi.fn();
    setAnalyticsSink(sink);
    expect(isAnalyticsEvent('email@example.com')).toBe(false);
    Reflect.apply(track, null, ['email@example.com']);
    expect(sink).not.toHaveBeenCalled();
    track('sql_succeeded');
    expect(sink).toHaveBeenCalledWith('sql_succeeded');
    setAnalyticsSink(() => { throw new Error('blocked'); });
    expect(() => track('page_view')).not.toThrow();
  });
});

// Small DOM double: verifies the request/consent boundary without a server or browser process.
async function browserFixture(options: { consent?: string; enabled?: boolean; gpc?: boolean; href?: string; writable?: boolean; referrer?: string } = {}) {
  vi.resetModules();
  const handlers = new Map<string, () => void>();
  const button = (name: string, choice?: string) => ({
    hidden: true, disabled: false, dataset: { analyticsChoice: choice }, focus: vi.fn(),
    addEventListener: (_: string, callback: () => void) => handlers.set(name, callback),
  });
  const deny = button('deny', 'denied');
  const grant = button('grant', 'granted');
  const close = button('close');
  const preference = button('preference');
  const banner = { hidden: true, querySelector: () => deny };
  const error = { hidden: true };
  let cookie = options.consent ? `${CONSENT_COOKIE}=${options.consent}` : '';
  const doc = {
    get cookie() { return cookie; },
    set cookie(value: string) { if (options.writable !== false && value.startsWith(CONSENT_COOKIE)) cookie = value.split(';')[0]; },
    referrer: options.referrer || '', hidden: false,
    head: { append: vi.fn() }, createElement: () => ({}),
    getElementById: () => ({ textContent: JSON.stringify({ ...config, enabled: options.enabled ?? true }) }),
    querySelector: (selector: string) => ({ '[data-analytics-consent]': banner, '[data-analytics-close]': close, '[data-analytics-preferences]': preference, '[data-consent-storage-error]': error }[selector]),
    querySelectorAll: () => [deny, grant],
    addEventListener: vi.fn(),
  };
  const win: { clarity?: ((...args: unknown[]) => void) & { q?: unknown[][] }; addEventListener: ReturnType<typeof vi.fn> } = { addEventListener: vi.fn() };
  const url = new URL(options.href || 'https://teor.example/base/');
  const reload = vi.fn();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', { globalPrivacyControl: options.gpc });
  vi.stubGlobal('location', { href: url.href, protocol: url.protocol, hostname: url.hostname, origin: url.origin, reload });
  const runtime = await import('../../src/scripts/analytics');
  const events = await import('../../src/lib/analytics/events');
  return { handlers, doc, win, reload, banner, error, runtime, events };
}

describe('Limite de rede do Clarity', () => {
  it('não injeta tag, nem acumula eventos, antes de consentir ou depois de recusar', async () => {
    for (const consent of [undefined, 'denied']) {
      const f = await browserFixture({ consent });
      f.events.track('quiz_answered');
      expect(f.doc.head.append).not.toHaveBeenCalled();
      expect(f.win.clarity).toBeUndefined();
    }
  });
  it('enfileira consentimento antes do primeiro evento e da tag', async () => {
    const f = await browserFixture();
    f.handlers.get('grant')!();
    expect(f.doc.head.append).toHaveBeenCalledOnce();
    expect(f.win.clarity?.q?.[0]).toEqual(['consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' }]);
    expect(f.win.clarity?.q).toContainEqual(['event', 'page_view']);
    expect(f.banner.hidden).toBe(true);
  });
  it('falha fechado em preview, GPC, cookies bloqueados, URL ou referrer privado', async () => {
    for (const options of [{ enabled: false }, { gpc: true }, { href: 'https://fork.example/base/' }, { href: 'https://teor.example/base/?q=private' }, { referrer: 'https://other.example/private' }]) {
      const f = await browserFixture({ consent: 'granted', ...options });
      expect(f.doc.head.append).not.toHaveBeenCalled();
    }
    const blocked = await browserFixture({ writable: false });
    blocked.handlers.get('grant')!();
    expect(blocked.doc.head.append).not.toHaveBeenCalled();
    expect(blocked.error.hidden).toBe(false);
  });
  it('revoga durante o download da tag sem preservar o grant pendente', async () => {
    const f = await browserFixture({ consent: 'granted' });
    f.handlers.get('deny')!();
    expect(f.win.clarity?.q).toEqual([
      ['consentv2', { ad_Storage: 'denied', analytics_Storage: 'denied' }], ['stop'],
    ]);
    expect(f.reload).toHaveBeenCalledOnce();
    f.events.track('quiz_answered');
    expect(f.win.clarity?.q).not.toContainEqual(['event', 'quiz_answered']);
  });
  it('limita a fila e interrompe antes de escrever URL sensível no histórico', async () => {
    const f = await browserFixture({ consent: 'granted' });
    for (let i = 0; i < 200; i++) f.events.track('filter_changed');
    expect(f.win.clarity?.q).toHaveLength(100);
    f.runtime.protectAnalyticsUrl(new URL('https://teor.example/base/?q=private'));
    expect(f.win.clarity?.q).toContainEqual(['stop']);
    expect(f.win.clarity?.q).not.toContainEqual(['event', 'filter_changed']);
  });
});
