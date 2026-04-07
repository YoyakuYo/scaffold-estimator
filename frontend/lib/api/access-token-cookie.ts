import Cookies from 'js-cookie';

/**
 * Attributes used when setting the JWT (see auth.ts login + team-invites).
 * Removal must use the same Path / Domain / Secure / SameSite or the cookie may not delete.
 */
export function accessTokenCookieWriteAttributes(): Cookies.CookieAttributes {
  return {
    expires: 7,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    ...(process.env.NODE_ENV === 'production' && typeof window !== 'undefined'
      ? { domain: window.location.hostname }
      : {}),
  };
}

/** Remove all plausible variants (handles host-only vs domain-scoped cookies across deploys). */
export function clearAccessTokenCookie(): void {
  if (typeof window === 'undefined') return;
  const isProd = process.env.NODE_ENV === 'production';
  const host = window.location.hostname;

  const variants: Cookies.CookieAttributes[] = [];

  if (isProd) {
    variants.push({ path: '/', sameSite: 'lax', secure: true, domain: host });
    variants.push({ path: '/', sameSite: 'lax', secure: true });
    if (host.startsWith('www.')) {
      variants.push({ path: '/', sameSite: 'lax', secure: true, domain: host.slice(4) });
    }
  } else {
    variants.push({ path: '/', sameSite: 'lax' });
    variants.push({ path: '/' });
  }

  for (const attrs of variants) {
    Cookies.remove('access_token', attrs);
  }
}
