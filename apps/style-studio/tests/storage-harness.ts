import { openProjectStore, SavedCopyConflict, STORAGE_OPERATION_MS, MAX_STORED_BYTES } from '../src/storage.ts';
import { createProject } from '../src/domain.ts';

function rawDatabase(version = 2): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('style-studio', version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function rawWrite(database: IDBDatabase, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('profiles', 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.objectStore('profiles').put(value, 'current');
  });
}

function rawRead(database: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('profiles', 'readonly');
    const request = transaction.objectStore('profiles').get('current');
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** Holds an actual transaction after its native put request succeeds. */
function holdNextWrite(): { started: Promise<void>; release(): void } {
  let announce!: () => void;
  const started = new Promise<void>(resolve => { announce = resolve; });
  let holding = true;
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
    const request = original.call(this, value, key);
    if (this.name !== 'profiles') return request;
    IDBObjectStore.prototype.put = original;
    request.addEventListener('success', () => {
      const keepAlive = () => {
        if (!holding) return;
        const read = this.get('current');
        read.onsuccess = keepAlive;
      };
      keepAlive(); announce();
    }, { once: true });
    return request;
  };
  return { started, release() { holding = false; IDBObjectStore.prototype.put = original; } };
}

/** Injects a real aborted transaction, leaving IndexedDB's rollback in charge. */
function abortNextWrite(): void {
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
    const request = original.call(this, value, key);
    if (this.name === 'profiles') {
      IDBObjectStore.prototype.put = original;
      this.transaction.abort();
    }
    return request;
  };
}

const harness = { openProjectStore, SavedCopyConflict, STORAGE_OPERATION_MS, MAX_STORED_BYTES, createProject, rawDatabase, rawWrite, rawRead, holdNextWrite, abortNextWrite };
declare global { interface Window { storageHarness: typeof harness } }
window.storageHarness = harness;
