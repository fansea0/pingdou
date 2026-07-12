import type { Palette } from '@/types';

const DB_NAME = 'pingdou';
const STORE = 'palette';
const KEY = 'current';
const DB_VERSION = 1;

interface Cached {
  readonly version: string;
  readonly palette: Palette;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cachePalette(palette: Palette, version: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ version, palette } as Cached, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function readCachedPalette(version?: string): Promise<Cached | null> {
  const db = await openDB();
  const result = await new Promise<Cached | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as Cached | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (!result) return null;
  if (version && result.version !== version) return null;
  return result;
}

export async function clearPaletteCache(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}