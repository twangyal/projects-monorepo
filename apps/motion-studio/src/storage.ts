import { validateProject, type Project } from './model.ts';

const DATABASE = 'motion-studio';
const STORE = 'project';
const KEY = 'current';
const MAX_STORED_BYTES = 6 * 1024 * 1024;
let mutations: Promise<void> = Promise.resolve();

function storageError(action: string, cause?: unknown): Error {
  const detail = cause instanceof Error && cause.message ? ` ${cause.message}` : '';
  return new Error(`Could not ${action} the local project.${detail} Check browser storage permissions and keep a project backup.`);
}

function snapshot(value: unknown): Project {
  const safe = validateProject(value);
  if (new TextEncoder().encode(JSON.stringify(safe)).byteLength > MAX_STORED_BYTES) {
    throw new Error('The local project exceeds 6 MiB. Remove some artwork or images before saving.');
  }
  return safe;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    try {
      if (!globalThis.indexedDB) throw new Error('IndexedDB is unavailable in this browser.');
      const request = indexedDB.open(DATABASE, 1);
      let upgradeError: unknown;
      request.onupgradeneeded = () => {
        try {
          if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
        } catch (error) {
          upgradeError = error;
          request.transaction?.abort();
        }
      };
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true;
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => { settled = true; reject(storageError('open', upgradeError ?? request.error)); };
      request.onblocked = () => {
        settled = true;
        reject(new Error('Local project storage is blocked by another Motion Studio tab. Close other tabs and retry, or export a project backup.'));
      };
    } catch (error) { reject(storageError('access', error)); }
  });
}

function completed(transaction: IDBTransaction, action: string): Promise<void> {
  const result = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(storageError(action, transaction.error));
    transaction.onabort = () => reject(storageError(action, transaction.error));
  });
  // Object-store calls can fail synchronously before their transaction is awaited.
  void result.catch(() => {});
  return result;
}

function enqueue(operation: () => Promise<void>): Promise<void> {
  const result = mutations.then(operation);
  // A failed save remains visible to its caller while later edits can still save.
  mutations = result.catch(() => {});
  return result;
}

async function write(action: 'save' | 'clear', project?: Project): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, 'readwrite');
    const done = completed(transaction, action);
    const store = transaction.objectStore(STORE);
    if (action === 'save') store.put(project, KEY);
    else store.delete(KEY);
    await done;
  } catch (error) { throw storageError(action, error); }
  finally { database.close(); }
}

export type RawRecord = { present: false } | { present: true; value: unknown };

export async function readRawRecord(): Promise<RawRecord> {
  // Observe all mutations queued before this load, without requiring a prior save
  // to succeed. Image decoding is deliberately left to the editor's atomic restore.
  await mutations;
  const database = await openDatabase();
  let value: unknown, count: number;
  try {
    const transaction = database.transaction(STORE, 'readonly');
    const done = completed(transaction, 'read');
    const store = transaction.objectStore(STORE);
    const request = store.get(KEY);
    const presence = store.count(KEY);
    const read = new Promise<unknown>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(storageError('read', request.error));
    });
    const counted = new Promise<number>((resolve, reject) => {
      presence.onsuccess = () => resolve(presence.result);
      presence.onerror = () => reject(storageError('read', presence.error));
    });
    [value, count] = await Promise.all([read, counted, done]);
  } catch (error) { throw storageError('read', error); }
  finally { database.close(); }
  return count === 0 ? { present: false } : { present: true, value };
}

export function decodeSavedRecord(value: unknown): Project {
  try { return snapshot(value); }
  catch (error) {
    throw new Error(`The saved project is invalid and was preserved. Download your current work before explicitly replacing the saved project. ${error instanceof Error ? error.message : ''}`);
  }
}

export async function loadProject(): Promise<Project | null> {
  const raw = await readRawRecord();
  return raw.present ? decodeSavedRecord(raw.value) : null;
}

// JSON.stringify alone silently drops undefined, invokes toJSON and changes
// exotic values. Inspect descriptors first; never normalize a preserved record.
export function serializeRawRecord(value: unknown): string {
  const active = new Set<object>();
  function inspect(item: unknown, depth: number): void {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item) && !Object.is(item, -0)) return;
    if (typeof item !== 'object' || depth > 512) throw new Error('Cannot make a lossless JSON backup of this unsafe saved record.');
    if (active.has(item)) throw new Error('Cannot make a JSON backup of a cyclic saved record.');
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error('Cannot make a lossless JSON backup of this saved record type.');
    const keys = Reflect.ownKeys(item);
    if (array && keys.length !== item.length + 1) throw new Error('Cannot make a lossless JSON backup of a sparse or extended array.');
    active.add(item);
    for (const key of keys) {
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (typeof key !== 'string' || !descriptor.enumerable || !('value' in descriptor)) throw new Error('Cannot make a lossless JSON backup of hidden or computed values.');
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length)) throw new Error('Cannot make a lossless JSON backup of an extended array.');
      inspect(descriptor.value, depth + 1);
    }
    active.delete(item);
  }
  inspect(value, 0);
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).byteLength > MAX_STORED_BYTES) throw new Error('Cannot download the saved record: its JSON exceeds 6 MiB.');
  return json;
}

export async function saveProject(project: Project): Promise<void> {
  // Validate and reconstruct immediately: callers may edit their original object
  // while an earlier save is pending. The queue receives a stable bounded snapshot.
  const safe = snapshot(project);
  return enqueue(() => write('save', safe));
}

export async function clearProject(): Promise<void> {
  return enqueue(() => write('clear'));
}
