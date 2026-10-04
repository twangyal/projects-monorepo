import type { Project } from './types.ts';
import { validateProject, serializeProject } from './model.ts';
import { validateProjectImages } from './images.ts';

const DATABASE = 'lens-studio.v1';
const STORE = 'projects';
const KEY = 'current';
let queue: Promise<void> = Promise.resolve();

function storageError(detail: string): Error {
  return new Error(`Local storage ${detail}. Keep your work open, Download project for a backup, then retry. If another Lens tab is open, close it first.`);
}

function ordered<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation);
  queue = result.then(() => undefined, () => undefined);
  return result;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    let settled = false;
    const timer = setTimeout(() => fail(storageError('did not respond')), 5000);
    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
    try {
      if (typeof indexedDB === 'undefined') throw new Error('Unavailable');
      request = indexedDB.open(DATABASE, 1);
    } catch { fail(storageError('is unavailable in this browser')); return; }
    request.onupgradeneeded = () => {
      if (settled) { request.transaction?.abort(); return; }
      try {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      } catch {
        // Roll back schema creation without leaking browser exception details.
        request.transaction?.abort();
      }
    };
    request.onblocked = () => fail(storageError('is blocked by another tab'));
    request.onerror = () => fail(storageError('could not be opened'));
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      settled = true;
      clearTimeout(timer);
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => () => T): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE, mode);
      tx.onabort = () => { db.close(); reject(storageError('could not complete the transaction')); };
      tx.onerror = () => { /* onabort reports failure after the transaction rolls back. */ };
      const readResult = action(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        try { resolve(readResult()); } catch { reject(storageError('could not read the saved record')); }
      };
    } catch { db.close(); reject(storageError('could not start the transaction')); }
  });
}

export function loadProject(): Promise<Project | null> {
  return ordered(async () => {
    const record = await transact('readonly', store => {
      const value = store.get(KEY);
      const key = store.getKey(KEY);
      return () => ({ present: key.result !== undefined, value: value.result as unknown });
    });
    if (!record.present) return null;
    try {
      const project = validateProject(record.value);
      serializeProject(project);
      await validateProjectImages(project);
      return project;
    } catch {
      throw new Error('Saved project is invalid or its image could not be decoded. Stored data was kept; import a valid project backup or clear local storage explicitly.');
    }
  });
}

export function saveProject(project: Project): Promise<void> {
  let snapshot: Project;
  try {
    snapshot = validateProject(project);
    serializeProject(snapshot);
  } catch (error) { return Promise.reject(error); }
  return ordered(async () => {
    await validateProjectImages(snapshot);
    await transact('readwrite', store => {
      store.put(snapshot, KEY);
      return () => undefined;
    });
  });
}

export function clearProject(): Promise<void> {
  return ordered(() => transact('readwrite', store => {
    store.delete(KEY);
    return () => undefined;
  }));
}
