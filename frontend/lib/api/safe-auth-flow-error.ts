import { isAxiosError } from 'axios';

/** Keys must exist under `translations.login`. */
export type LoginFlowErrorKey =
  | 'tryLater'
  | 'invalidCredentials'
  | 'accountPendingApproval'
  | 'accountRejected'
  | 'accountDeactivated'
  | 'superAdminUseSuperPage'
  | 'useNormalLoginForSuper';

export function isLikelyHtmlPayload(text: string): boolean {
  const s = text.trim().toLowerCase();
  return s.startsWith('<!doctype') || s.startsWith('<html') || s.includes('<html');
}

/**
 * Reads Nest-style `{ message: string | string[] }` or a plain string body.
 * Strips HTML error pages (e.g. reverse-proxy / host platform) so they are never shown to users.
 */
export function nestMessageFromUnknown(data: unknown): string {
  if (typeof data === 'string') {
    const t = data.trim();
    if (!t || isLikelyHtmlPayload(t)) return '';
    return t.slice(0, 2000);
  }
  if (!data || typeof data !== 'object') return '';
  const raw = (data as { message?: unknown }).message;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t || isLikelyHtmlPayload(t)) return '';
    return t.slice(0, 2000);
  }
  if (Array.isArray(raw)) {
    const joined = raw.filter((x): x is string => typeof x === 'string').join(' ').trim();
    if (!joined || isLikelyHtmlPayload(joined)) return '';
    return joined.slice(0, 2000);
  }
  return '';
}

/**
 * Maps login (and superadmin login) HTTP failures to safe i18n keys — never raw host/proxy HTML or stack text.
 */
export function axiosErrorToLoginFlowKey(err: unknown): LoginFlowErrorKey {
  if (!isAxiosError(err)) return 'tryLater';

  if (!err.response) return 'tryLater';

  const status = err.response.status;
  if (status >= 500) return 'tryLater';

  const message = nestMessageFromUnknown(err.response.data);
  const m = message.toLowerCase();

  if (status === 401) {
    if (m.includes('invalid credentials')) return 'invalidCredentials';
    if (m.includes('pending admin approval')) return 'accountPendingApproval';
    if (m.includes('has been rejected')) return 'accountRejected';
    if (m.includes('deactivated')) return 'accountDeactivated';
    return 'tryLater';
  }

  if (status === 403) {
    if (m.includes('/superadmin') || m.includes('super admin')) return 'superAdminUseSuperPage';
    if (m.includes('normal login')) return 'useNormalLoginForSuper';
    return 'tryLater';
  }

  return 'tryLater';
}

/**
 * True when the request did not return a usable app JSON body (offline, timeout, 5xx, HTML error page).
 */
export function isAuthTransportOrGatewayFailure(err: unknown): boolean {
  if (!isAxiosError(err)) return false;
  if (!err.response) return true;
  if (err.response.status >= 500) return true;
  if (typeof err.response.data === 'string' && err.response.data.trim() && isLikelyHtmlPayload(err.response.data)) {
    return true;
  }
  const msg = nestMessageFromUnknown(err.response.data);
  if (!msg && typeof err.response.data === 'string' && err.response.data.trim()) return true;
  return false;
}

/**
 * Safe line(s) for register / validation: never HTML or huge blobs; prefer generic copy for transport failures.
 */
export function safeRegisterErrorLines(err: unknown): string[] | null {
  if (!isAxiosError(err)) return null;
  if (!err.response) return null;
  if (err.response.status >= 500) return null;
  const msg = nestMessageFromUnknown(err.response.data);
  if (!msg) return null;
  if (msg.length > 800) return null;
  return [msg];
}

/**
 * Short user-facing reset-password error: allow known 400 messages from our API; hide infra/proxy noise.
 */
export function safeResetPasswordErrorLine(err: unknown): string | null {
  if (!isAxiosError(err)) return null;
  if (!err.response || err.response.status >= 500) return null;
  const msg = nestMessageFromUnknown(err.response.data);
  if (!msg) return null;
  if (msg.length > 600) return null;
  return msg;
}
