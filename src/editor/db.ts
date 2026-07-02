// Tiny IndexedDB wrapper. Everything OpenCanvas stores lives in the user's
// browser: the current design (autosaved) and the uploads folder. Items not
// touched for RETENTION_DAYS are purged on startup — no accounts, no server.

import { RETENTION_MS } from '../constants';

const DB_NAME = 'opencanvas';
const DB_VERSION = 1;

export interface UploadRecord {
  id: string;
  name: string;
  kind: 'image' | 'svg' | 'pdf' | 'pptx' | 'html';
  mime: string;
  blob: Blob;
  thumb?: string;
  palette?: string[];
  addedAt: number;
  lastUsed: number;
}

export interface SavedDoc {
  name: string;
  docW: number;
  docH: number;
  pages: string[]; // one serialized fabric JSON string per page
  savedAt: number;
  lastVisit: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('uploads')) db.createObjectStore('uploads', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const kvGet = <T>(key: string) => tx<T | undefined>('kv', 'readonly', (s) => s.get(key));
export const kvSet = (key: string, value: unknown) => tx<void>('kv', 'readwrite', (s) => s.put(value, key));
export const kvDel = (key: string) => tx<void>('kv', 'readwrite', (s) => s.delete(key));

export const uploadsAll = () => tx<UploadRecord[]>('uploads', 'readonly', (s) => s.getAll());
export const uploadPut = (rec: UploadRecord) => tx<void>('uploads', 'readwrite', (s) => s.put(rec));
export const uploadDelete = (id: string) => tx<void>('uploads', 'readwrite', (s) => s.delete(id));

export async function uploadTouch(id: string): Promise<void> {
  const rec = await tx<UploadRecord | undefined>('uploads', 'readonly', (s) => s.get(id));
  if (rec) { rec.lastUsed = Date.now(); await uploadPut(rec); }
}

/** Purge the saved design and uploads that haven't been touched in a week. */
export async function purgeExpired(): Promise<void> {
  const now = Date.now();
  try {
    const doc = await kvGet<SavedDoc>('doc');
    if (doc && now - doc.lastVisit > RETENTION_MS) await kvDel('doc');
    const ups = await uploadsAll();
    for (const u of ups) {
      if (now - u.lastUsed > RETENTION_MS) await uploadDelete(u.id);
    }
  } catch {
    // storage unavailable (private mode etc.) — the editor still works, nothing persists
  }
}

export async function loadSavedDoc(): Promise<SavedDoc | null> {
  try {
    const doc = await kvGet<SavedDoc>('doc');
    if (!doc) return null;
    doc.lastVisit = Date.now();
    await kvSet('doc', doc);
    return doc;
  } catch {
    return null;
  }
}

export async function saveDoc(doc: Omit<SavedDoc, 'savedAt' | 'lastVisit'>): Promise<void> {
  try {
    await kvSet('doc', { ...doc, savedAt: Date.now(), lastVisit: Date.now() });
  } catch {
    // ignore quota / private-mode errors
  }
}

export async function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
