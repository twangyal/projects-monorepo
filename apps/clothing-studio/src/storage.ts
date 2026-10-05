import { validateProject, type Project } from './model.ts';
import { validatePhoto } from './media.ts';

const DATABASE_NAME = 'clothing-studio';
const STORE_NAME = 'project';
const PROJECT_KEY = 'current';

function storageError(action: string, cause?: DOMException | null): Error {
  return new Error(`Could not ${action} the local project${cause?.message ? `: ${cause.message}` : '. Check browser storage permissions and keep a backup file.'}`);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(storageError('access'));
      return;
    }
    let settled = false;
    const request = indexedDB.open(DATABASE_NAME, 1);
    let upgradeError: DOMException | null = null;
    request.onupgradeneeded = () => {
      try { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME); }
      catch (error) { upgradeError = error instanceof DOMException ? error : new DOMException('Could not create project storage.'); request.transaction?.abort(); }
    };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => { settled = true; reject(storageError('open', upgradeError ?? request.error)); };
    request.onblocked = () => { settled = true; reject(new Error('Local project storage is blocked by another tab. Close other Clothing Studio tabs and try again.')); };
  });
}

const TRANSACTION_DEADLINE_MS = 10_000;

async function transact<T>(mode: IDBTransactionMode, action: string,
  request: (store: IDBObjectStore) => () => T): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    try { transaction = database.transaction(STORE_NAME, mode); }
    catch { database.close(); reject(storageError(action)); return; }
    let failure: Error | null = null;
    let readResult: (() => T) | undefined;
    // This timer belongs to this native transaction, including time queued
    // behind another connection. Only a native terminal event releases callers.
    const timer = setTimeout(() => {
      const timeout = new Error(`Local project storage timed out after 10 seconds. Keep your current concept open and export a project backup, then retry.`);
      try { transaction.abort(); failure ??= timeout; }
      catch {
        // Native commit/abort may already have won while its callback is delayed.
        // Await that event rather than falsely reporting a committed write lost.
      }
    }, TRANSACTION_DEADLINE_MS);
    const finish = () => { clearTimeout(timer); database.close(); };
    transaction.oncomplete = () => {
      finish();
      if (failure) { reject(failure); return; }
      try { resolve(readResult!()); } catch { reject(storageError(action)); }
    };
    transaction.onabort = () => { finish(); reject(failure ?? storageError(action, transaction.error)); };
    transaction.onerror = () => {
      // An error event precedes rollback. Keep the autosave queue waiting for it.
      failure ??= storageError(action, transaction.error);
    };
    try { readResult = request(transaction.objectStore(STORE_NAME)); }
    catch {
      failure = storageError(action);
      try { transaction.abort(); } catch { /* Await the actual native terminal outcome. */ }
    }
  });
}

export async function loadProject(): Promise<Project | null> {
  const record = await transact('readonly', 'read', store => {
    const value = store.get(PROJECT_KEY), presence = store.count(PROJECT_KEY);
    return () => ({ value: value.result as unknown, count: presence.result });
  });
  if (record.count === 0) return null;
  const project = validateProject(record.value);
  await validatePhoto(project.photo);
  return project;
}

export async function saveProject(project: Project): Promise<void> {
  const safe = validateProject(project);
  await validatePhoto(safe.photo);
  await transact('readwrite', 'save', store => {
    store.put(safe, PROJECT_KEY); return () => undefined;
  });
}

export async function clearProject(): Promise<void> {
  await transact('readwrite', 'clear', store => {
    store.delete(PROJECT_KEY); return () => undefined;
  });
}
