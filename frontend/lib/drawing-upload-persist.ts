/**
 * Persist drawing-upload session (file blob + editor state) in IndexedDB so refresh keeps the upload.
 */

const DB_NAME = 'zoomen-scaffold-drawing';
const STORE = 'drawing-upload-session';
const DB_VERSION = 1;
const KEY = 'v1';

/** Match scaffold wizard draft: do not restore file/editor state from long-idle tabs. */
const DRAWING_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type PersistedFileKind = 'dxf' | 'cad' | 'pdf' | 'image';

export interface PersistedVertex {
  x: number;
  y: number;
}

export interface PersistedSeg {
  start: PersistedVertex;
  end: PersistedVertex;
}

export interface PersistedDrawingSessionV1 {
  v: 1;
  fileName: string;
  mimeType: string;
  fileKind: PersistedFileKind;
  blob: ArrayBuffer;
  shape: {
    verts: PersistedVertex[];
    wallMm: number[];
    coordsAreMm: boolean;
  };
  bgSegs: PersistedSeg[];
  tracing: boolean;
  status: string;
  buildingHeightMm: number | null;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
  });
}

export async function loadDrawingUploadSession(): Promise<PersistedDrawingSessionV1 | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openDb();
    const data = await new Promise<PersistedDrawingSessionV1 | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result as PersistedDrawingSessionV1 | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!data || data.v !== 1 || !data.blob || !data.fileName) return null;
    if (
      typeof data.savedAt !== 'number' ||
      Number.isNaN(data.savedAt) ||
      Date.now() - data.savedAt > DRAWING_UPLOAD_MAX_AGE_MS
    ) {
      await clearDrawingUploadSession();
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export async function saveDrawingUploadSession(data: PersistedDrawingSessionV1): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).put(data, KEY);
    });
    db.close();
  } catch {
    /* quota or private mode — ignore */
  }
}

export async function clearDrawingUploadSession(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).delete(KEY);
    });
    db.close();
  } catch {
    /* ignore */
  }
}
