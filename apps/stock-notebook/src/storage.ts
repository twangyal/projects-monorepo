import type { Notebook } from './types.ts';
import { LIMITS } from './types.ts';
import { validateToday } from './validation.ts';
import { parseNotebookJson, serializeNotebook } from './model.ts';

const STORE = 'notebooks';
const KEY = 'current';
// Each named database is ordered across instances, including recovery reads and clears.
const queues = new Map<string, Promise<void>>();
function storageError(detail: string): Error {
  return new Error(`Local storage ${detail}. Keep your notebook open, download a backup, then retry. Close other Stock Notebook tabs if storage is blocked.`);
}
function rawText(value: unknown): string {
  let text: unknown;
  try { text = typeof value === 'string' ? value : JSON.stringify(value); }
  catch { throw new Error('Raw saved record cannot be serialized as a backup. Stored data was kept; do not reset until you have recovered it.'); }
  if (typeof text !== 'string') throw new Error('Raw saved record cannot be serialized as a backup. Stored data was kept.');
  if (text.length > LIMITS.notebookBytes || new TextEncoder().encode(text).length > LIMITS.notebookBytes) throw new Error(`Raw saved record is too large for the ${LIMITS.notebookBytes / (1024 * 1024)} MiB backup limit. Stored data was kept.`);
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) throw new Error('Raw saved record has invalid Unicode and cannot become a UTF-8 backup. Stored data was kept.');
  }
  return text;
}

export class NotebookStore {
  #name: string;
  #closed = false;
  #cancellations = new Set<() => void>();
  #connections = new Set<IDBDatabase>();

  constructor(name = 'stock-notebook-v1') {
    if (typeof name !== 'string' || !name.length || name.length > 120 || [...name].some(character => {
      const point = character.codePointAt(0)!;
      return point < 32 || (point >= 127 && point <= 159);
    })) throw new Error('Use a valid local notebook database name.');
    this.#name = name;
  }
  #assertOpen(): void {
    if (this.#closed) throw storageError('is closed; open a new notebook store to retry');
  }
  #ordered<T>(operation: () => Promise<T>): Promise<T> {
    const result = (queues.get(this.#name) ?? Promise.resolve()).then(() => { this.#assertOpen(); return operation(); });
    const tail = result.then(() => undefined, () => undefined);
    queues.set(this.#name, tail);
    void tail.then(() => { if (queues.get(this.#name) === tail) queues.delete(this.#name); });
    return result;
  }
  #closeConnection(db: IDBDatabase): void { this.#connections.delete(db); db.close(); }
  #open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest;
      let settled = false;
      const cancel = () => fail(storageError('is closed; open a new notebook store to retry'));
      const timer = setTimeout(() => fail(storageError('did not respond')), 5000);
      this.#cancellations.add(cancel);
      const cleanup = () => { clearTimeout(timer); this.#cancellations.delete(cancel); };
      function fail(error: Error): void {
        if (settled) return;
        settled = true; cleanup(); reject(error);
      }
      try {
        this.#assertOpen();
        if (typeof indexedDB === 'undefined') throw new Error();
        request = indexedDB.open(this.#name, 1);
      } catch { fail(storageError('is unavailable in this browser')); return; }
      request.onupgradeneeded = () => {
        if (settled || this.#closed) { request.transaction?.abort(); return; }
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onerror = () => fail(storageError('could not be opened'));
      request.onblocked = () => fail(storageError('is blocked by another tab'));
      request.onsuccess = () => {
        const db = request.result;
        if (settled || this.#closed) { db.close(); if (!settled) fail(storageError('is closed')); return; }
        settled = true; cleanup();
        this.#connections.add(db);
        db.onversionchange = () => this.#closeConnection(db);
        resolve(db);
      };
    });
  }
  async #transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => () => T): Promise<T> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction | undefined;
      let settled = false;
      const finish = (error: Error | null, result?: T) => {
        if (settled) return;
        settled = true; this.#cancellations.delete(cancel); this.#closeConnection(db);
        if (error) reject(error); else resolve(result!);
      };
      const cancel = () => {
        try { tx?.abort(); } catch { /* A finished transaction cannot be aborted again. */ }
        finish(storageError('is closed; open a new notebook store to retry'));
      };
      try {
        this.#assertOpen();
        tx = db.transaction(STORE, mode);
        this.#cancellations.add(cancel);
        tx.onabort = () => finish(storageError(this.#closed ? 'is closed' : 'could not complete the transaction'));
        tx.onerror = () => { /* Native abort reports failure after rollback. */ };
        const readResult = action(tx.objectStore(STORE));
        tx.oncomplete = () => {
          try { finish(null, readResult()); } catch { finish(storageError('could not read the saved record')); }
        };
      } catch {
        try { tx?.abort(); } catch { /* Preserve the original actionable failure. */ }
        finish(storageError(this.#closed ? 'is closed' : 'could not complete the transaction'));
      }
    });
  }
  #read(): Promise<{ present: boolean; value: unknown }> {
    return this.#transaction('readonly', store => {
      const value = store.get(KEY), key = store.getKey(KEY);
      return () => ({ present: key.result !== undefined, value: value.result as unknown });
    });
  }
  load(today: string): Promise<Notebook | null> {
    let date: string;
    try { this.#assertOpen(); date = validateToday(today); }
    catch (error) { return Promise.reject(error); }
    return this.#ordered(async () => {
      const record = await this.#read();
      if (!record.present) return null;
      try {
        if (typeof record.value !== 'string') throw new Error();
        return parseNotebookJson(record.value, date);
      } catch { throw new Error('Saved notebook is corrupt, incompatible, future-dated or cannot be evaluated. Stored data was kept. Download the raw saved record before an explicit reset, or import a valid backup.'); }
    });
  }
  save(notebook: Notebook, today: string): Promise<void> {
    let text: string;
    try { this.#assertOpen(); text = serializeNotebook(notebook, validateToday(today)); }
    catch (error) { return Promise.reject(error); }
    return this.#ordered(() => this.#transaction('readwrite', store => {
      store.put(text, KEY); return () => undefined;
    }));
  }
  exportRaw(): Promise<string | null> {
    return this.#ordered(async () => {
      const record = await this.#read();
      return record.present ? rawText(record.value) : null;
    });
  }
  clear(): Promise<void> {
    return this.#ordered(() => this.#transaction('readwrite', store => { store.delete(KEY); return () => undefined; }));
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const cancel of [...this.#cancellations]) cancel();
    for (const db of this.#connections) this.#closeConnection(db);
  }
}
