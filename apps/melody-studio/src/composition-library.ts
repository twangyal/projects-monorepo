import type { ReferenceBundle } from './reference-types.ts';
import { validateBundle } from './reference-project.ts';
import { encodeProjectBackup, decodeProjectBackup, exactFields } from './reference-backup.ts';
declare const receiptBrand: unique symbol;
export interface LibraryReceipt { readonly [receiptBrand]: true }
export interface LibraryEntry {
  readonly id: string;
  readonly revision: string;
  readonly label: string;
  readonly title: string;
  readonly tracks: number;
  readonly references: number;
  readonly bytes: number;
  readonly sha256: string;
  readonly receipt: LibraryReceipt;
}
export interface LibraryReview {
  readonly entry: LibraryEntry;
  readonly backup: Blob;
  readonly bundle: ReferenceBundle | null;
  readonly error: string | null;
}
export interface LibraryOptions { signal?: AbortSignal }

const DATABASE = 'melody-studio.library', VERSION = 1, STORE = 'copies';
const COUNT = 8, BACKUP_BYTES = 12_582_912, PAYLOAD_BYTES = 100_663_296, METADATA_BYTES = 16_384, OPERATION_MS = 10_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/;
const HASH = /^[a-f0-9]{64}(?![\s\S])/;
const KEYS = ['schemaVersion', 'id', 'revision', 'label', 'title', 'tracks', 'references', 'bytes', 'sha256', 'backup'] as const;
const encoder = new TextEncoder();
const inaccessible = () => new Error('Saved compositions could not be accessed. Refresh copies before trying again; keep a complete backup.');
const conflict = () => new Error('The selected copy or its receipt changed. Refresh copies before another attempt.');
const closed = () => new Error('The composition library is closed. Reopen the page to access saved copies.');
const timedOut = () => new Error('The library operation timed out after 10 seconds. Its result may be uncertain; Refresh copies before another attempt.');
const canceled = () => new Error('The library operation was canceled. Its result may be uncertain; Refresh copies before another attempt.');
const corrupt = () => 'This saved backup could not be verified or decoded. Download its exact bytes before replacing or deleting the copy.';
interface Row {
  schemaVersion: 1;
  id: string;
  revision: string;
  label: string;
  title: string;
  tracks: number;
  references: number;
  bytes: number;
  sha256: string;
  backup: Blob;
}
interface Authority { id: string; signature: string; generation: object }
interface Operation { signal: AbortSignal; check(): void; cancel(error: Error): void }
function label(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Copy label must contain 1–80 characters.');
  const result = value.trim();
  const invalid = 'Copy label must contain 1–80 well-formed characters without control characters.';
  if (!result || result.length > 80) throw new Error(invalid);
  const forbidden = Array.from(result, char => char.charCodeAt(0)).some(code =>
    code <= 0x1f || code >= 0x7f && code <= 0x9f || code === 0x2028 || code === 0x2029);
  if (forbidden
    || /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(result)) {
    throw new Error(invalid);
  }
  return result;
}
function metadata(row: Row) {
  return { schemaVersion: row.schemaVersion, id: row.id, revision: row.revision, label: row.label,
    title: row.title, tracks: row.tracks, references: row.references, bytes: row.bytes, sha256: row.sha256 };
}
function signature(row: Row): string {
  return JSON.stringify({ ...metadata(row), blobSize: row.backup.size, blobType: row.backup.type });
}
function admitRow(value: unknown): Row {
  try {
    const row = exactFields(value, KEYS);
    if (row.schemaVersion !== 1 || typeof row.id !== 'string' || !UUID.test(row.id)
      || typeof row.revision !== 'string' || !UUID.test(row.revision)
      || typeof row.label !== 'string' || label(row.label) !== row.label
      || typeof row.title !== 'string' || row.title.length < 1 || row.title.length > 80 || row.title.trim() !== row.title
      || !Number.isInteger(row.tracks) || (row.tracks as number) < 1 || (row.tracks as number) > 8
      || !Number.isInteger(row.references) || Object.is(row.references, -0) || (row.references as number) < 0 || (row.references as number) > 8
      || !Number.isInteger(row.bytes) || (row.bytes as number) < 1 || (row.bytes as number) > BACKUP_BYTES
      || typeof row.sha256 !== 'string' || !HASH.test(row.sha256)
      || !(row.backup instanceof Blob) || row.backup.type !== 'application/json' || row.backup.size !== row.bytes) throw inaccessible();
    return row as unknown as Row;
  } catch { throw inaccessible(); }
}
function admitCatalog(value: unknown): Row[] {
  if (!Array.isArray(value) || value.length > COUNT) throw inaccessible();
  const rows = value.map(admitRow);
  if (new Set(rows.map(row => row.id)).size !== rows.length
    || rows.reduce((sum, row) => sum + row.bytes, 0) > PAYLOAD_BYTES
    || encoder.encode(JSON.stringify(rows.map(metadata))).length > METADATA_BYTES) throw inaccessible();
  return rows;
}
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Exact backups live independently of current-workspace storage. Logical
 * cancellation never relinquishes a native open/transaction before its event. */
export class CompositionLibrary {
  #factory: IDBFactory;
  #receipts = new WeakMap<LibraryReceipt, Authority>();
  #generations = new Map<string, object>();
  #tail: Promise<void> = Promise.resolve();
  #closed = false;
  #native = 0;
  #operations = new Set<Operation>();
  #connections = new Set<IDBDatabase>();
  constructor(factory: IDBFactory) { this.#factory = factory; }
  get nativePending(): boolean { return this.#native > 0; }

  #enqueue<T>(start: number, options: LibraryOptions | undefined, action: (op: Operation) => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(closed());
    const controller = new AbortController();
    const deadline = start + OPERATION_MS;
    const op: Operation = { signal: controller.signal,
      cancel(error) { if (!controller.signal.aborted) controller.abort(error); },
      check() {
        if (!controller.signal.aborted && Date.now() >= deadline) controller.abort(timedOut());
        if (controller.signal.aborted) throw controller.signal.reason;
      } };
    this.#operations.add(op);
    const externalAbort = () => op.cancel(canceled());
    options?.signal?.addEventListener('abort', externalAbort, { once: true });
    if (options?.signal?.aborted) externalAbort();
    const timer = setTimeout(() => op.cancel(timedOut()), Math.max(0, deadline - Date.now()));
    let rejectLogical: (error: Error) => void = () => {};
    const retirement = new Promise<never>((_resolve, reject) => { rejectLogical = reject; });
    const retire = () => rejectLogical(controller.signal.reason);
    controller.signal.addEventListener('abort', retire, { once: true });
    if (controller.signal.aborted) retire();
    // This tail waits for the action itself, including uncancelable native drains.
    // The caller separately races it against prompt logical retirement.
    const work = this.#tail.then(async () => { op.check(); if (this.#closed) throw closed(); return action(op); });
    this.#tail = work.then(() => undefined, () => undefined);
    const result = Promise.race([work, retirement]);
    void result.finally(() => {
      clearTimeout(timer);
      options?.signal?.removeEventListener('abort', externalAbort);
      controller.signal.removeEventListener('abort', retire);
      this.#operations.delete(op);
    }).catch(() => {});
    return result;
  }
  #release(db: IDBDatabase): void {
    if (this.#connections.delete(db)) db.close();
  }
  #open(op: Operation): Promise<IDBDatabase> {
    op.check();
    return new Promise((resolve, reject) => {
      this.#native++;
      let request: IDBOpenDBRequest, failure: Error | null = null;
      try { request = this.#factory.open(DATABASE, VERSION); }
      catch { this.#native--; reject(inaccessible()); return; }
      const abortUpgrade = () => {
        try { request.transaction?.abort(); } catch { /* The open itself cannot be physically canceled. */ }
      };
      op.signal.addEventListener('abort', abortUpgrade, { once: true });
      request.onupgradeneeded = () => {
        try {
          op.check();
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        } catch {
          failure = op.signal.aborted ? op.signal.reason : inaccessible();
          try { request.transaction?.abort(); } catch { /* Await the native request terminal event. */ }
        }
      };
      request.onerror = () => {
        op.signal.removeEventListener('abort', abortUpgrade);
        this.#native--; reject(op.signal.aborted ? op.signal.reason : failure ?? inaccessible());
      };
      request.onsuccess = () => {
        op.signal.removeEventListener('abort', abortUpgrade);
        this.#native--;
        const db = request.result;
        try {
          op.check(); if (this.#closed) throw closed(); if (failure) throw failure;
          if (db.version !== VERSION || db.objectStoreNames.length !== 1 || !db.objectStoreNames.contains(STORE)) throw inaccessible();
          this.#connections.add(db);
          db.onversionchange = () => {
            if (!this.#connections.has(db)) return;
            op.cancel(new Error('Saved compositions changed in another tab. Refresh copies before another attempt.'));
            this.#release(db);
          };
          resolve(db);
        } catch (error) { db.close(); reject(error); }
      };
      // onblocked is deliberately nonterminal; ownership ends only at success/error.
    });
  }
  #transaction<T>(db: IDBDatabase, mode: IDBTransactionMode, op: Operation,
    begin: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
    op.check();
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = db.transaction([STORE], mode); }
      catch { reject(inaccessible()); return; }
      this.#native++;
      let value: T, assigned = false, failure: Error | null = null;
      const abort = () => {
        failure ??= op.signal.reason;
        try { tx.abort(); } catch { /* A queued native completion may have already committed. */ }
      };
      const cleanup = () => { this.#native--; op.signal.removeEventListener('abort', abort); };
      op.signal.addEventListener('abort', abort, { once: true });
      tx.onabort = () => { cleanup(); reject(failure ?? inaccessible()); };
      tx.onerror = () => { failure ??= inaccessible(); };
      tx.oncomplete = () => {
        cleanup();
        try { op.check(); if (failure) throw failure; if (!assigned) throw inaccessible(); resolve(value); }
        catch (error) { reject(error); }
      };
      const fail = (error: unknown) => {
        failure = error instanceof Error ? error : inaccessible();
        try { tx.abort(); } catch { /* Keep ownership until the native terminal event. */ }
      };
      try {
        const store = tx.objectStore(STORE);
        if (store.keyPath !== 'id' || store.autoIncrement === true) throw inaccessible();
        // Synchronous request callbacks admit/check and enqueue every mutation.
        begin(store, next => { op.check(); assigned = true; value = next; });
      } catch (error) { fail(error); }
    });
  }
  async #read(op: Operation, authority?: Authority): Promise<Row | Row[]> {
    const db = await this.#open(op);
    try {
      op.check();
      return await this.#transaction<Row | Row[]>(db, 'readonly', op, (store, result) => {
        const request = authority ? store.get(authority.id) : store.getAll(undefined, COUNT + 1);
        request.onsuccess = () => {
          try {
            op.check();
            if (authority) { const row = admitRow(request.result); this.#match(row, authority); result(row); }
            else result(admitCatalog(request.result));
          } catch (error) {
            // An aborted native transaction remains pending until onabort.
            op.cancel(error instanceof Error ? error : inaccessible());
          }
        };
      });
    } finally { this.#release(db); }
  }
  #authority(receipt: LibraryReceipt, consume = false): Authority {
    if (this.#closed) throw closed();
    const authority = this.#receipts.get(receipt);
    if (!authority || this.#generations.get(authority.id) !== authority.generation) throw conflict();
    if (consume) {
      this.#receipts.delete(receipt);
      // Retire every previously issued same-ID token, including siblings.
      // A fresh selected read/list must mint a new private generation.
      this.#generations.delete(authority.id);
    }
    return authority;
  }
  #match(row: Row, authority: Authority): void {
    if (row.id !== authority.id || signature(row) !== authority.signature) throw conflict();
  }
  #entry(row: Row): LibraryEntry {
    const receipt = Object.freeze({}) as LibraryReceipt;
    let generation = this.#generations.get(row.id);
    if (!generation) { generation = Object.freeze({}); this.#generations.set(row.id, generation); }
    this.#receipts.set(receipt, Object.freeze({ id: row.id, signature: signature(row), generation }));
    return Object.freeze({ id: row.id, revision: row.revision, label: row.label, title: row.title,
      tracks: row.tracks, references: row.references, bytes: row.bytes, sha256: row.sha256, receipt });
  }
  list(options?: LibraryOptions): Promise<readonly LibraryEntry[]> {
    return this.#enqueue(Date.now(), options, async op => {
      const rows = await this.#read(op) as Row[]; op.check();
      const ids = new Set(rows.map(row => row.id));
      for (const id of this.#generations.keys()) if (!ids.has(id)) this.#generations.delete(id);
      return Object.freeze(rows.map(row => this.#entry(row)));
    });
  }
  review(receipt: LibraryReceipt, options?: LibraryOptions): Promise<LibraryReview> {
    const start = Date.now(); let authority: Authority;
    try { authority = this.#authority(receipt); } catch (error) { return Promise.reject(error); }
    return this.#enqueue(start, options, async op => {
      const row = await this.#read(op, authority) as Row; op.check();
      let bundle: ReferenceBundle | null = null, error: string | null = null;
      try {
        const bytes = new Uint8Array(await row.backup.arrayBuffer()); op.check();
        const hash = await sha256(bytes); op.check(); if (hash !== row.sha256) throw inaccessible();
        bundle = await decodeProjectBackup(bytes); op.check();
        if (bundle.document.composition.title !== row.title || bundle.document.composition.tracks.length !== row.tracks
          || bundle.document.references.length !== row.references) throw inaccessible();
      } catch { op.check(); bundle = null; error = corrupt(); }
      await this.#read(op, authority); op.check();
      return Object.freeze({ entry: this.#entry(row), backup: row.backup, bundle, error });
    });
  }
  async #prepare(labelText: string, bundle: ReferenceBundle, id: string, op: Operation): Promise<Row> {
    op.check(); const bytes = await encodeProjectBackup(bundle); op.check();
    const sha = await sha256(bytes); op.check();
    return admitRow({ schemaVersion: 1, id, revision: crypto.randomUUID(), label: labelText,
      title: bundle.document.composition.title, tracks: bundle.document.composition.tracks.length,
      references: bundle.document.references.length, bytes: bytes.length, sha256: sha,
      backup: new Blob([Uint8Array.from(bytes).buffer], { type: 'application/json' }) });
  }
  async #mutate(op: Operation, authority: Authority | undefined, row: Row | undefined): Promise<void> {
    const db = await this.#open(op);
    try {
      op.check();
      await this.#transaction<void>(db, 'readwrite', op, (store, result) => {
        const request = store.getAll(undefined, COUNT + 1);
        request.onsuccess = () => {
          try {
            op.check(); const rows = admitCatalog(request.result);
            if (authority) {
              const existing = rows.find(item => item.id === authority.id); if (!existing) throw conflict();
              this.#match(existing, authority);
            } else if (rows.length >= COUNT) throw new Error('Saved compositions already contains eight copies. Delete a copy before saving another.');
            if (row) {
              if (!authority && rows.some(existing => existing.id === row.id)) throw conflict();
              admitCatalog([...rows.filter(existing => existing.id !== row.id), row]);
              store.put(row);
            } else if (authority) store.delete(authority.id);
            result(undefined);
          } catch (error) { op.cancel(error instanceof Error ? error : inaccessible()); }
        };
      });
      op.check();
    } finally { this.#release(db); }
  }
  create(labelText: string, bundle: ReferenceBundle, options?: LibraryOptions): Promise<LibraryEntry> {
    const start = Date.now(); let captured: ReferenceBundle, normalized: string;
    try { if (this.#closed) throw closed(); normalized = label(labelText); captured = validateBundle(bundle); }
    catch (error) { return Promise.reject(error); }
    return this.#enqueue(start, options, async op => {
      const row = await this.#prepare(normalized, captured, crypto.randomUUID(), op); op.check();
      await this.#mutate(op, undefined, row); op.check(); return this.#entry(row);
    });
  }
  update(receipt: LibraryReceipt, labelText: string, bundle: ReferenceBundle, options?: LibraryOptions): Promise<LibraryEntry> {
    const start = Date.now(); let authority: Authority, captured: ReferenceBundle, normalized: string;
    try { authority = this.#authority(receipt, true); normalized = label(labelText); captured = validateBundle(bundle); }
    catch (error) { return Promise.reject(error); }
    return this.#enqueue(start, options, async op => {
      const row = await this.#prepare(normalized, captured, authority.id, op); op.check();
      await this.#mutate(op, authority, row); op.check(); return this.#entry(row);
    });
  }
  remove(receipt: LibraryReceipt, options?: LibraryOptions): Promise<void> {
    const start = Date.now(); let authority: Authority;
    try { authority = this.#authority(receipt, true); } catch (error) { return Promise.reject(error); }
    return this.#enqueue(start, options, op => this.#mutate(op, authority, undefined));
  }
  close(): Promise<void> {
    this.#closed = true; this.#receipts = new WeakMap(); this.#generations.clear();
    for (const op of this.#operations) op.cancel(closed());
    for (const db of this.#connections) this.#release(db);
    return this.#tail;
  }
}
