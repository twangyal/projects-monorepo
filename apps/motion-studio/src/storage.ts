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

export async function loadProject(): Promise<Project | null> {
  // Observe all mutations queued before this load, without requiring a prior save
  // to succeed. Image decoding is deliberately left to the editor's atomic restore.
  await mutations;
  const database = await openDatabase();
  let value: unknown;
  try {
    const transaction = database.transaction(STORE, 'readonly');
    const done = completed(transaction, 'read');
    const request = transaction.objectStore(STORE).get(KEY);
    const read = new Promise<unknown>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(storageError('read', request.error));
    });
    [value] = await Promise.all([read, done]);
  } catch (error) { throw storageError('read', error); }
  finally { database.close(); }
  if (value === undefined) return null;
  try { return snapshot(value); }
  catch (error) {
    throw new Error(`The saved project is invalid and was preserved. Download your current work before explicitly replacing the saved project. ${error instanceof Error ? error.message : ''}`);
  }
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
