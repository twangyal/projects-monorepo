import type { Project } from './types.ts';
import { validateProject } from './domain.ts';

export interface ProjectStore {
  load(): Promise<Project | null>;
  save(project: Project): Promise<void>;
  clear(): Promise<void>;
  close(): Promise<void>;
}

const UNAVAILABLE = 'Browser storage (IndexedDB) is unavailable. Continue in memory-only mode and export your profile as a backup.';

function storageError(error?: unknown): Error {
  const full = error instanceof DOMException && error.name === 'QuotaExceededError';
  return new Error(`${full ? 'Browser storage is full.' : 'The local profile could not be saved or read.'} Your current edits remain in memory. Export your profile as a backup and retry local storage.`);
}

function closedError(): Error {
  return new Error('This profile storage connection is closed. Reopen storage or export your current in-memory profile.');
}

/** Resolves only after native commit; failed requests finish aborting before rejection. */
function transact<T>(database: IDBDatabase, mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try { transaction = database.transaction('profiles', mode); }
    catch (error) { reject(storageError(error)); return; }
    let result: () => T;
    let failure: unknown;
    transaction.oncomplete = () => {
      try { resolve(result()); } catch (error) { reject(error); }
    };
    transaction.onerror = event => {
      failure ??= (event.target as IDBRequest).error || transaction.error;
    };
    transaction.onabort = () => reject(storageError(failure || transaction.error));
    try { result = operation(transaction.objectStore('profiles')); }
    catch (error) {
      failure = error;
      try { transaction.abort(); } catch { reject(storageError(error)); }
    }
  });
}

class LocalProjectStore implements ProjectStore {
  readonly #database: IDBDatabase;
  #tail: Promise<void> = Promise.resolve();
  #closed = false;
  #closing: Promise<void> | null = null;

  constructor(database: IDBDatabase) {
    this.#database = database;
    database.onversionchange = () => { void this.close().catch(() => {}); };
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(closedError());
    const result = this.#tail.then(operation);
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }

  load(): Promise<Project | null> {
    return this.#enqueue(() => transact(this.#database, 'readonly', store => {
      const value = store.get('current');
      const key = store.getKey('current');
      return () => {
        if (key.result === undefined) return null;
        try { return validateProject(value.result); }
        catch {
          throw new Error('The saved style profile is invalid or corrupt. Existing browser data was preserved. Continue editing in memory and import a valid backup before replacing it.');
        }
      };
    }));
  }

  save(project: Project): Promise<void> {
    if (this.#closed) return Promise.reject(closedError());
    let captured: Project;
    try { captured = validateProject(project); }
    catch (error) { return Promise.reject(error); }
    return this.#enqueue(() => transact(this.#database, 'readwrite', store => {
      store.put(captured, 'current');
      return () => undefined;
    }));
  }

  clear(): Promise<void> {
    return this.#enqueue(() => transact(this.#database, 'readwrite', store => {
      store.delete('current');
      return () => undefined;
    }));
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#closing = this.#tail.then(() => this.#database.close());
    return this.#closing;
  }
}

export async function openProjectStore(): Promise<ProjectStore> {
  let factory: IDBFactory | undefined;
  try { factory = globalThis.indexedDB; }
  catch { throw new Error(UNAVAILABLE); }
  if (!factory) throw new Error(UNAVAILABLE);
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try { request = factory.open('style-studio', 1); }
    catch { reject(new Error(UNAVAILABLE)); return; }
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true; reject(error);
    };
    request.onblocked = () => fail(new Error('Profile storage is blocked by another open tab. Close older Style Studio tabs and retry. Your edits remain in memory; export a backup.'));
    request.onerror = () => fail(new Error(UNAVAILABLE));
    request.onupgradeneeded = () => {
      if (settled) { request.transaction?.abort(); return; }
      if (!request.result.objectStoreNames.contains('profiles')) request.result.createObjectStore('profiles');
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) { database.close(); return; }
      if (!database.objectStoreNames.contains('profiles')) {
        database.close();
        fail(new Error('The saved profile database has an incompatible schema. Existing storage was preserved. Continue in memory and export your current profile.'));
        return;
      }
      settled = true; resolve(new LocalProjectStore(database));
    };
  });
}
