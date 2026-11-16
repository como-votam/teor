import { consentCookie, privacySignal, readConsent, type Consent } from '../lib/analytics/consent';
import { setAnalyticsSink, track } from '../lib/analytics/events';
import { safeLocation, safeReferrer, validProjectId, type AnalyticsConfig } from '../lib/analytics/privacy';

type Clarity = ((...args: unknown[]) => void) & { q?: unknown[][] };
declare global { interface Window { clarity?: Clarity } }

const node = document.getElementById('analytics-config');
const config: AnalyticsConfig | null = node ? JSON.parse(node.textContent || 'null') : null;
const banner = document.querySelector<HTMLElement>('[data-analytics-consent]');
const close = document.querySelector<HTMLButtonElement>('[data-analytics-close]');
let active = false;
let script: HTMLScriptElement | null = null;
let choice: Consent = 'unset';
let mounted = false;
let returnTo: HTMLElement | null = null;
const once = new Set<string>();
let consentChannel: BroadcastChannel | null = null;
try {
  if ('BroadcastChannel' in window) {
    consentChannel = new BroadcastChannel('teor-analytics-consent-v1');
    consentChannel.onmessage = () => {
      choice = currentConsent();
      if (active && choice !== 'granted') { stop(); location.reload(); }
    };
  }
} catch { /* Cookie/visibility synchronization still works without this API. */ }
const blocked = () => privacySignal(navigator);
const currentConsent = (): Consent => {
  try { return readConsent(document.cookie); } catch { return 'unset'; }
};
choice = currentConsent();

function eligible(): boolean {
  return !!config && config.enabled && validProjectId(config.projectId) && config.page !== null
    && location.protocol === 'https:' && !blocked() && choice === 'granted'
    && safeLocation(new URL(location.href), config) && safeReferrer(document.referrer, config);
}

function stop(): void {
  active = false;
  // Discard pending calls if the tag has not executed yet, including a queued grant.
  if (window.clarity?.q) window.clarity.q.length = 0;
  try {
    window.clarity?.('consentv2', { ad_Storage: 'denied', analytics_Storage: 'denied' });
    window.clarity?.('stop');
  } catch { /* Third-party failures must not affect navigation or consent. */ }
}

function clearAnalyticsCookies(): void {
  // SDK cookies can have been written at a parent domain by an older installation.
  const domains = location.hostname.split('.');
  for (const name of ['_clck', '_clsk']) {
    try {
      document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
      for (let i = 0; i < domains.length - 1; i++) {
        document.cookie = `${name}=; Path=/; Max-Age=0; Domain=${domains.slice(i).join('.')}; SameSite=Lax; Secure`;
      }
    } catch { /* Browser policy may block cookie access. */ }
  }
}

function trackOnce(key: string, event: Parameters<typeof track>[0]): void {
  if (!active || once.has(key)) return;
  once.add(key);
  track(event);
}

function start(): void {
  if (active || script || !eligible() || !config) return;
  window.clarity = Object.assign((...args: unknown[]) => { window.clarity!.q!.push(args); }, { q: [] as unknown[][] });
  // Queue consent before the network request. Advertising storage is always denied.
  window.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' });
  script = document.createElement('script');
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${config.projectId}`;
  script.referrerPolicy = 'no-referrer';
  script.onerror = () => { active = false; if (window.clarity?.q) window.clarity.q.length = 0; };
  active = true;
  document.head.append(script);
  window.clarity('set', 'site', 'teor');
  window.clarity('set', 'page_path', config.page);
  window.clarity('set', 'telemetry_version', '1');
  track('page_view');
  mountEngagement();
}

setAnalyticsSink((event) => {
  if (!active || !eligible()) return;
  // Limit a slow/blocked tag's in-memory queue. Nothing is buffered before consent.
  if (window.clarity?.q && window.clarity.q.length >= 100) return;
  window.clarity?.('event', event);
});

function showPreferences(focus = false): void {
  if (!banner) return;
  banner.hidden = false;
  if (close) close.hidden = choice === 'unset';
  if (focus) {
    returnTo = document.activeElement as HTMLElement | null;
    banner.querySelector<HTMLButtonElement>('[data-analytics-choice="denied"]')?.focus();
  }
}
function hidePreferences(): void {
  if (banner) banner.hidden = true;
  returnTo?.focus();
  returnTo = null;
}

document.querySelectorAll<HTMLButtonElement>('[data-analytics-choice]').forEach((button) => {
  if (button.dataset.analyticsChoice === 'granted') button.disabled = blocked();
  button.addEventListener('click', () => {
    const next = button.dataset.analyticsChoice === 'granted' && !blocked() ? 'granted' : 'denied';
    const hadScript = !!script;
    if (next === 'denied') { stop(); clearAnalyticsCookies(); }
    try { document.cookie = consentCookie(next, location.protocol === 'https:'); } catch { /* Fail closed below. */ }
    choice = currentConsent();
    if (choice !== next) {
      stop();
      const error = document.querySelector<HTMLElement>('[data-consent-storage-error]');
      if (error) error.hidden = false;
      return;
    }
    try { consentChannel?.postMessage('changed'); } catch { /* Visibility fallback remains available. */ }
    hidePreferences();
    // Reload removes the SDK and its listeners, including a tag still in flight.
    if (hadScript && next === 'denied') { location.reload(); return; }
    start();
  });
});
document.querySelector('[data-analytics-preferences]')?.addEventListener('click', () => showPreferences(true));
close?.addEventListener('click', hidePreferences);
const signalNotice = document.querySelector<HTMLElement>('[data-analytics-signal]');
if (signalNotice) signalNotice.hidden = !blocked();
if (choice === 'unset' && config?.enabled && validProjectId(config.projectId)) showPreferences();

// Before our own History changes, stop capture if a new URL is outside the public vocabulary.
// Do not monkey-patch History: explicit callers use this helper below.
export function protectAnalyticsUrl(url: URL): void {
  if (active && config && !safeLocation(url, config)) stop();
}
window.addEventListener('hashchange', () => { if (!eligible()) stop(); });
window.addEventListener('pageshow', () => { choice = currentConsent(); if (!eligible()) stop(); else start(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  choice = currentConsent();
  if (!eligible()) { if (active) { stop(); location.reload(); } }
  else start();
});

// Delegation covers static pages and controls rendered later, without DOM mutation observers.
document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const target = event.target;
  if (target.closest('[data-analytics-consent], [data-analytics-preferences]')) return;
  const link = target.closest<HTMLAnchorElement>('a[href]');
  if (link) {
    if (link.hasAttribute('download')) track('download_clicked');
    else if (link.protocol === 'https:' && link.origin !== location.origin) track('external_link_opened');
    else if (link.origin === location.origin) {
      track(link.closest('.mobile-nav') ? 'navigation_mobile' : link.closest('header') ? 'navigation_header' : link.closest('footer') ? 'navigation_footer' : 'navigation_content');
    }
  }
  if (target.closest('[data-mobile-nav]')) track('navigation_menu_opened');
  if (target.closest('[data-top]')) track('back_to_top');
  if (target.closest('[role="tab"]')) track('tab_changed');
});
document.addEventListener('seg', () => track('filter_changed'));
document.addEventListener('change', (e) => {
  if (e.target instanceof Element && !e.target.matches('input, textarea')) track('select_changed');
});
document.addEventListener('toggle', (e) => {
  if (e.target instanceof HTMLDetailsElement) track(e.target.open ? 'details_opened' : 'details_closed');
}, true);

function mountEngagement(): void {
  if (mounted || !('IntersectionObserver' in window)) return;
  mounted = true;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || !active) continue;
      const el = entry.target;
      const sections = [...document.querySelectorAll('main section')];
      const section = sections.indexOf(el);
      if (section >= 0) trackOnce(`section:${section}`, 'section_viewed');
      if (el.matches('footer')) trackOnce('end', 'page_end_reached');
      if (section === Math.floor(sections.length / 2)) trackOnce('middle', 'page_middle_reached');
      observer.unobserve(el);
    }
  }, { threshold: 0.1 });
  document.querySelectorAll('main section, footer').forEach((el) => observer.observe(el));
}

start();
