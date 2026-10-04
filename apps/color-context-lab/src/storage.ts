import { LIMITS, type Project } from './types.ts';
import { parseProjectJson, serializeProject } from './model.ts';

interface Work {
  owner: ProjectStore;
  controller: AbortController;
  run: (signal: AbortSignal) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}
const pending: Work[] = [];
let active: Work | null = null;
const closedError = () => new Error('Project storage is closed.');
const storageError = () => new Error('Project storage is unavailable or the operation failed. Keep your project backup and retry.');

function drain(): void {
  if (active) return;
  const work = pending.shift();
  if (!work) return;
  active = work;
  void work.run(work.controller.signal).then(value => {
    active = null; work.resolve(value); drain();
  }, error => {
    active = null; work.reject(error); drain();
  });
}

function openDatabase(signal: AbortSignal): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(closedError()); return; }
    let request: IDBOpenDBRequest;
    try {
      if (!globalThis.indexedDB) throw storageError();
      request = indexedDB.open('color-context-lab.v1', 1);
    } catch { reject(storageError()); return; }
    let done = false;
    const finish = (error?: Error, database?: IDBDatabase) => {
      if (done) { database?.close(); return; }
      done = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (error) {
        try { request.transaction?.abort(); } catch { /* Upgrade may already have ended. */ }
        reject(error);
      } else resolve(database!);
    };
    const abort = () => finish(closedError());
    const timer = setTimeout(() => finish(new Error('Opening project storage timed out. Close other tabs and retry.')), LIMITS.storageTimeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    request.onupgradeneeded = () => {
      if (done || signal.aborted) { try { request.transaction?.abort(); } catch { /* Retired upgrade. */ } return; }
      if (!request.result.objectStoreNames.contains('projects')) request.result.createObjectStore('projects');
    };
    request.onerror = () => finish(storageError());
    request.onsuccess = () => finish(undefined, request.result);
  });
}

function transaction<T>(database: IDBDatabase, mode: IDBTransactionMode, signal: AbortSignal,
  requests: (store: IDBObjectStore) => () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(closedError()); return; }
    let tx: IDBTransaction;
    try { tx = database.transaction('projects', mode); } catch { reject(storageError()); return; }
    let done = false, value: (() => T) | undefined;
    let failure: Error | undefined;
    const finish = (error?: Error) => {
      if (done) return;
      done = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else { try { resolve(value!()); } catch (cause) { reject(cause); } }
    };
    const stop = (error: Error) => {
      failure = error;
      try { tx.abort(); } catch { finish(error); }
    };
    const abort = () => stop(closedError());
    const timer = setTimeout(() => stop(new Error('Project storage timed out. Keep your backup and retry.')), LIMITS.storageTimeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    tx.oncomplete = () => finish();
    tx.onabort = () => finish(failure ?? storageError());
    tx.onerror = () => { failure ??= storageError(); };
    try { value = requests(tx.objectStore('projects')); } catch { stop(storageError()); }
  });
}

function rawRecord(value: unknown): string {
  if (typeof value !== 'string' || value.length > LIMITS.projectBytes) throw new Error('The saved record is not a bounded project string. It has been left unchanged.');
  // TextEncoder replaces lone surrogates: reject them before making a purported exact backup.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('The saved record contains invalid Unicode. It has been left unchanged.');
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error('The saved record contains invalid Unicode. It has been left unchanged.');
  }
  if (new TextEncoder().encode(value).length > LIMITS.projectBytes) throw new Error('The saved record exceeds the project byte limit. It has been left unchanged.');
  return value;
}

export class ProjectStore {
  private closed = false;
  private enqueue<T>(mode: IDBTransactionMode, requests: (store: IDBObjectStore) => () => T): Promise<T> {
    if (this.closed) return Promise.reject(closedError());
    if (pending.length + (active ? 1 : 0) >= LIMITS.storageQueue) return Promise.reject(new Error('Project storage has too many pending operations. Wait and retry.'));
    return new Promise<T>((resolve, reject) => {
      pending.push({ owner: this, controller: new AbortController(), resolve: value => resolve(value as T), reject,
        run: async signal => {
          const database = await openDatabase(signal);
          database.onversionchange = () => database.close();
          try { return await transaction(database, mode, signal, requests); }
          finally { database.close(); }
        } });
      drain();
    });
  }
  private read(): Promise<string | null> {
    return this.enqueue('readonly', store => {
      const key = store.getKey('current'), value = store.get('current');
      return () => key.result === undefined ? null : rawRecord(value.result);
    });
  }
  async load(): Promise<Project | null> {
    const raw = await this.read();
    return raw === null ? null : parseProjectJson(raw);
  }
  save(project: Project): Promise<void> {
    if (this.closed) return Promise.reject(closedError());
    let captured: string;
    try { captured = serializeProject(project); } catch (error) { return Promise.reject(error); }
    return this.enqueue('readwrite', store => { store.put(captured, 'current'); return () => undefined; });
  }
  exportRaw(): Promise<string | null> { return this.read(); }
  clear(): Promise<void> { return this.enqueue('readwrite', store => { store.delete('current'); return () => undefined; }); }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].owner === this) { const [work] = pending.splice(i, 1); work.reject(closedError()); }
    }
    if (active?.owner === this) active.controller.abort();
  }
}
