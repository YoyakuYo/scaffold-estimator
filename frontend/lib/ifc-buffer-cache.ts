/**
 * In-memory IFC ArrayBuffer cache.
 * Survives Next.js client-side navigation (SPA) so the result page can
 * display the native IFC mesh even when the Supabase URL is unavailable.
 * Keyed by configId or ifcFileUrl — whichever is known first.
 */

const buffers = new Map<string, ArrayBuffer>();

export function cacheIfcBuffer(key: string, buf: ArrayBuffer): void {
  if (!key || !buf || buf.byteLength === 0) return;
  buffers.set(key, buf);
}

export function getCachedIfcBuffer(key: string): ArrayBuffer | undefined {
  return buffers.get(key);
}

export function getCachedIfcBufferAny(
  ...keys: Array<string | undefined | null>
): ArrayBuffer | undefined {
  for (const k of keys) {
    if (k) {
      const buf = buffers.get(k);
      if (buf) return buf;
    }
  }
  return undefined;
}
