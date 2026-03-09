/**
 * Map between PostgREST/Supabase snake_case and API camelCase.
 * Use when reading/writing via Supabase client so API contract stays unchanged.
 */

function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function toSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/** Convert DB row (snake_case keys) to camelCase for API responses. */
export function mapRowToCamel<T = Record<string, unknown>>(row: Record<string, unknown> | null): T | null {
  if (row === null || row === undefined) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = toCamel(k);
    if (isPlainObject(v) && !(v instanceof Date)) {
      out[key] = mapRowToCamel(v as Record<string, unknown>) as unknown;
    } else if (Array.isArray(v)) {
      out[key] = v.map((item) => (isPlainObject(item) ? mapRowToCamel(item as Record<string, unknown>) : item));
    } else {
      out[key] = v;
    }
  }
  return out as T;
}

/** Convert multiple rows. */
export function mapRowsToCamel<T = Record<string, unknown>>(rows: Record<string, unknown>[]): T[] {
  return rows.map((r) => mapRowToCamel(r) as T).filter(Boolean) as T[];
}

/** Convert API/camelCase payload to DB snake_case for insert/update. */
export function mapPayloadToSnake<T = Record<string, unknown>>(payload: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined) continue;
    const key = toSnake(k);
    if (isPlainObject(v)) {
      out[key] = mapPayloadToSnake(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      out[key] = v.map((item) => (isPlainObject(item) ? mapPayloadToSnake(item as Record<string, unknown>) : item));
    } else {
      out[key] = v;
    }
  }
  return out as T;
}
