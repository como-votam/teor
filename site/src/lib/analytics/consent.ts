export type Consent = 'granted' | 'denied' | 'unset';
export const CONSENT_COOKIE = 'teor_analytics_consent_v1';
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 180;

/** A host-only, essential cookie; never shared with Como Votam or other subdomains. */
export function readConsent(cookie: string): Consent {
  const value = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${CONSENT_COOKIE}=`))?.slice(CONSENT_COOKIE.length + 1);
  return value === 'granted' || value === 'denied' ? value : 'unset';
}

export function consentCookie(value: Exclude<Consent, 'unset'>, secure: boolean): string {
  return `${CONSENT_COOKIE}=${value}; Path=/; Max-Age=${CONSENT_MAX_AGE}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function privacySignal(nav: { doNotTrack?: string | null; globalPrivacyControl?: boolean }): boolean {
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1';
}
