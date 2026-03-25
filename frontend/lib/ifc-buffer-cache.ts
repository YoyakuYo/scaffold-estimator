/**
 * IFC ArrayBuffer persistence layer.
 *
 * Uses IndexedDB so buffers survive page reloads, deployments, and
 * browser restarts. Falls back to an in-memory Map when IndexedDB
 * is unavailable (SSR, incognito on some browsers).
 */

const DB_NAME = 'zoomen_ifc_cache';
const STORE_NAME = 'buffers';
const DB_VERSION = 2;

const memFallback = new Map<string, ArrayBuffer>();

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // On version bump, delete the old store and recreate to clear stale data
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function clearIfcCache(): Promise<void> {
  memFallback.clear();
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {
    // IndexedDB unavailable
  }
}

export async function cacheIfcBuffer(key: string, buf: ArrayBuffer): Promise<void> {
  if (!key || !buf || buf.byteLength === 0) return;
  memFallback.set(key, buf);
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(buf, key);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {
    // IndexedDB unavailable; in-memory cache still works for this session
  }
}

export async function getCachedIfcBuffer(key: string): Promise<ArrayBuffer | undefined> {
  const mem = memFallback.get(key);
  if (mem) return mem;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    const result = await new Promise<ArrayBuffer | undefined>((res, rej) => {
      req.onsuccess = () => res(req.result as ArrayBuffer | undefined);
      req.onerror = () => rej(req.error);
    });
    db.close();
    if (result) memFallback.set(key, result);
    return result;
  } catch {
    return undefined;
  }
}

export async function getCachedIfcBufferAny(
  ...keys: Array<string | undefined | null>
): Promise<ArrayBuffer | undefined> {
  for (const k of keys) {
    if (!k) continue;
    const mem = memFallback.get(k);
    if (mem) return mem;
  }
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    for (const k of keys) {
      if (!k) continue;
      const req = store.get(k);
      const buf = await new Promise<ArrayBuffer | undefined>((res, rej) => {
        req.onsuccess = () => res(req.result as ArrayBuffer | undefined);
        req.onerror = () => rej(req.error);
      });
      if (buf && buf.byteLength > 0) {
        db.close();
        memFallback.set(k, buf);
        return buf;
      }
    }
    db.close();
  } catch {
    // fall through
  }
  return undefined;
}
