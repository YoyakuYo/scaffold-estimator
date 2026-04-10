const SENSITIVE_KEYS = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'confirmpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'secret',
  'code',
  'creditcard',
]);

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_KEYS.has(lower)) return true;
  if (lower.includes('password')) return true;
  if (lower.includes('token') && lower !== 'content-type') return true;
  return false;
}

function redactObject(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactObject(v));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? '[REDACTED]' : redactObject(v);
    }
    return out;
  }
  return value;
}

/** Safe for logs: redacts passwords/tokens from parsed JSON bodies. */
export function redactBodyForLog(body: unknown): string | undefined {
  if (body === null || body === undefined) return undefined;
  try {
    const redacted = redactObject(
      typeof body === 'object' ? body : { value: body },
    ) as Record<string, unknown>;
    return JSON.stringify(redacted).substring(0, 500);
  } catch {
    return '[unserializable body]';
  }
}

/** Redact obvious secrets from query strings (e.g. ?token=). */
export function redactQueryForLog(query: Record<string, unknown> | undefined): string | undefined {
  if (!query || typeof query !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(query)) {
    if (isSensitiveKey(k) || k.toLowerCase() === 'token') {
      out[k] = '[REDACTED]';
    } else {
      out[k] = v;
    }
  }
  try {
    return JSON.stringify(out).substring(0, 500);
  } catch {
    return undefined;
  }
}
