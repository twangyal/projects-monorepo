import { validateBundle, validateDocument, validateAsset } from './reference-project.ts';
import { REFERENCE_LIMITS, type ReferenceBundle, type ReferenceAsset, type MelodyDocument } from './reference-types.ts';
import { exactFields, referenceMetadata, admitReferenceMetadata, hashReferencePcm } from './reference-backup.ts';

export const REFERENCE_DB_NAME = 'melody-studio.projects';
export const REFERENCE_DB_VERSION = 1;
const closedError = () => new Error('Project storage is closed. Reopen the page or choose a complete backup.');
const storageError = () => new Error('The complete saved project could not be accessed. Keep a project backup and retry storage.');
const timeoutError = () => new Error('Project storage timed out after 10 seconds. Keep a complete backup and retry.');
const metadataKeys = ['id', 'kind', 'captureTempo', 'decodedSampleRate', 'decodedChannels', 'decodedFrames', 'analyzedFrames', 'frameCount', 'sha256', 'pcm'];
interface Operation { signal: AbortSignal; check(): void }

declare const receiptBrand: unique symbol;
export interface SavedCopyReceipt { readonly [receiptBrand]: true }
export interface LoadedProject { bundle: ReferenceBundle | null; receipt: SavedCopyReceipt }
export interface ReplacementReview {
  receipt: SavedCopyReceipt;
  summary: { readable: boolean; title: string | null; tracks: number | null; references: number | null };
}
export class SavedCopyConflict extends Error {
  constructor() { super('The saved copy changed in another tab. Keep your complete backup and review the conflict before replacing it.'); this.name = 'SavedCopyConflict'; }
}

interface StoredSnapshot {
  signature: string;
  exists: boolean;
  document: MelodyDocument | null;
  assets: Record<string, unknown>[];
}
interface ReceiptAuthority { kind: 'load' | 'replacement'; signature: string }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/;
const descriptorBytes = REFERENCE_LIMITS.documentBytes + 128;
const encoder = new TextEncoder();

/** Only bounded JSON data can identify a malformed descriptor for replacement.
 * No coercion, toJSON hooks, exotic objects or PCM belong in this identity.
 */
function descriptorIdentity(value: unknown): string {
  if (value === undefined) return 'present-undefined';
  let nodes = 0, units = 0;
  const negativeZeros: number[] = [];
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 65536 || depth > REFERENCE_LIMITS.jsonDepth) throw storageError();
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw storageError();
      if (Object.is(item, -0)) negativeZeros.push(nodes);
      return;
    }
    if (typeof item === 'string') { units += item.length; if (units > descriptorBytes) throw storageError(); return; }
    if (item === null || typeof item === 'boolean') return;
    if (!item || typeof item !== 'object') throw storageError();
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw storageError();
    const keys = Reflect.ownKeys(item);
    if (keys.length > 65536 || array && keys.length !== item.length + 1) throw storageError();
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') throw storageError();
      units += key.length;
      if (units > descriptorBytes) throw storageError();
      const field = Object.getOwnPropertyDescriptor(item, key);
      if (!field?.enumerable || !('value' in field)) throw storageError();
      visit(field.value, depth + 1);
    }
    if (array) for (let index = 0; index < item.length; index++) if (!Object.hasOwn(item, index)) throw storageError();
  };
  visit(value, 0);
  const json = JSON.stringify(value);
  if (encoder.encode(json).length > descriptorBytes) throw storageError();
  return JSON.stringify({ json, negativeZeros });
}
function storedAsset(value: unknown): Record<string, unknown> {
  const row = exactFields(value, metadataKeys);
  admitReferenceMetadata(row);
  if (!(row.pcm instanceof Blob) || row.pcm.type !== '' || row.pcm.size !== (row.frameCount as number) * 2
      || row.pcm.size > REFERENCE_LIMITS.assetBytes || typeof row.sha256 !== 'string' || !uuid.test(row.id as string)
      || !/^[a-f0-9]{64}(?![\s\S])/.test(row.sha256)) throw storageError();
  return row;
}
function snapshot(exists: boolean, value: unknown, keys: unknown[], entries: unknown[]): StoredSnapshot {
  if (keys.length !== entries.length || keys.length > REFERENCE_LIMITS.currentAssets) throw storageError();
  const assets = entries.map(storedAsset);
  if (keys.some((key, index) => typeof key !== 'string' || key !== assets[index].id)) throw storageError();
  // Full bounded descriptor identity includes unknown JSON fields, not a normalized projection.
  const descriptor = exists ? descriptorIdentity(value) : 'absent';
  let document: MelodyDocument | null = null;
  if (exists) try {
    const row = exactFields(value, (value as { schemaVersion?: unknown } | null)?.schemaVersion === 2
      ? ['schemaVersion', 'revision', 'document'] : ['schemaVersion', 'document']);
    if (row.schemaVersion !== 1 && row.schemaVersion !== 2 || row.schemaVersion === 2 && (typeof row.revision !== 'string' || !uuid.test(row.revision))) throw storageError();
    document = validateDocument(row.document);
  } catch { /* A comparable malformed descriptor remains protected until explicit replacement. */ }
  const metadata = assets.map((row, index) => ({ key: keys[index], ...Object.fromEntries(metadataKeys.filter(key => key !== 'pcm').map(key => [key, row[key]])), pcmBytes: (row.pcm as Blob).size, pcmType: (row.pcm as Blob).type }));
  return { signature: JSON.stringify({ exists, descriptor, metadata }), exists, document, assets };
}

export class ReferenceStorage {
  #factory: IDBFactory;
  #expected: string | null = null;
  #receipts = new WeakMap<SavedCopyReceipt, ReceiptAuthority>();
  #tail: Promise<void> = Promise.resolve();
  #closed = false;
  #connections = new Set<IDBDatabase>();
  #cancelActive: ((error: Error) => void) | null = null;
  constructor(factory: IDBFactory) { this.#factory = factory; }

  #enqueue<T>(action: (op: Operation) => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(closedError());
    const next = this.#tail.then(async () => {
      if (this.#closed) throw closedError();
      const controller = new AbortController();
      const cancel = (error: Error) => {
        controller.abort(error);
        for (const db of this.#connections) this.#release(db);
      };
      this.#cancelActive = cancel;
      const timer = setTimeout(() => cancel(timeoutError()), 10000);
      const op = { signal: controller.signal, check() { if (controller.signal.aborted) throw controller.signal.reason; } };
      let abort: (() => void) | undefined;
      const rejected = new Promise<never>((_resolve, reject) => {
        abort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', abort, { once: true });
      });
      try { return await Promise.race([action(op), rejected]); }
      finally {
        clearTimeout(timer);
        if (abort) controller.signal.removeEventListener('abort', abort);
        if (this.#cancelActive === cancel) this.#cancelActive = null;
      }
    });
    this.#tail = next.then(() => undefined, () => undefined);
    return next;
  }

  #release(db: IDBDatabase): void {
    if (this.#connections.delete(db)) db.close();
  }

  #open(op: Operation): Promise<IDBDatabase> {
    op.check();
    return new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest;
      let settled = false;
      const fail = (error: Error) => { if (!settled) { settled = true; reject(error); } };
      const abort = () => fail(op.signal.reason);
      op.signal.addEventListener('abort', abort, { once: true });
      try { request = this.#factory.open(REFERENCE_DB_NAME, REFERENCE_DB_VERSION); }
      catch { op.signal.removeEventListener('abort', abort); fail(storageError()); return; }
      request.onupgradeneeded = () => {
        try {
          op.check();
          const db = request.result;
          for (const name of ['projects', 'assets']) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        } catch { request.transaction?.abort(); fail(storageError()); }
      };
      request.onerror = () => { op.signal.removeEventListener('abort', abort); fail(storageError()); };
      request.onsuccess = () => {
        op.signal.removeEventListener('abort', abort);
        const db = request.result;
        if (settled || op.signal.aborted || this.#closed) { db.close(); fail(closedError()); return; }
        if (db.version !== REFERENCE_DB_VERSION || db.objectStoreNames.length !== 2 || !db.objectStoreNames.contains('projects') || !db.objectStoreNames.contains('assets')) {
          db.close(); fail(storageError()); return;
        }
        this.#connections.add(db);
        db.onversionchange = () => {
          if (!this.#connections.has(db)) return;
          this.#release(db);
          this.#cancelActive?.(new Error('Project storage changed in another tab. Reopen this page and keep a backup.'));
        };
        settled = true; resolve(db);
      };
    });
  }

  #transaction<T>(db: IDBDatabase, mode: IDBTransactionMode, op: Operation,
    begin: (tx: IDBTransaction, result: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
    op.check();
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = db.transaction(['projects', 'assets'], mode); }
      catch { reject(storageError()); return; }
      let value: T, failure: Error | null = null;
      const abort = () => { failure = op.signal.reason; try { tx.abort(); } catch { /* Already terminal. */ } reject(failure); };
      op.signal.addEventListener('abort', abort, { once: true });
      tx.onabort = () => { op.signal.removeEventListener('abort', abort); reject(failure ?? storageError()); };
      tx.onerror = () => { failure ??= storageError(); };
      tx.oncomplete = () => {
        op.signal.removeEventListener('abort', abort);
        try { op.check(); if (failure) throw failure; resolve(value); } catch (error) { reject(error); }
      };
      const fail = (error: Error) => { failure = error; try { tx.abort(); } catch { reject(failure); } };
      try { begin(tx, next => { value = next; }, fail); }
      catch (error) { failure = error instanceof Error ? error : storageError(); try { tx.abort(); } catch { reject(failure); } }
    });
  }

  #capture(tx: IDBTransaction, op: Operation, result: (value: StoredSnapshot) => void, fail: (error: Error) => void): void {
    const projects = tx.objectStore('projects'), assets = tx.objectStore('assets');
    const existsRequest = projects.getKey('current'), descriptorRequest = projects.get('current');
    const keysRequest = assets.getAllKeys(undefined, REFERENCE_LIMITS.currentAssets + 1);
    const rowsRequest = assets.getAll(undefined, REFERENCE_LIMITS.currentAssets + 1);
    let remaining = 4;
    const complete = () => {
      if (--remaining !== 0) return;
      try {
        op.check();
        result(snapshot(existsRequest.result !== undefined, descriptorRequest.result, keysRequest.result, rowsRequest.result));
      } catch (error) { fail(error instanceof Error ? error : storageError()); }
    };
    for (const request of [existsRequest, descriptorRequest, keysRequest, rowsRequest]) request.onsuccess = complete;
  }

  async #read(op: Operation): Promise<StoredSnapshot> {
    const db = await this.#open(op);
    try { return await this.#transaction<StoredSnapshot>(db, 'readonly', op, (tx, result, fail) => this.#capture(tx, op, result, fail)); }
    finally { this.#release(db); }
  }
  #receipt(kind: ReceiptAuthority['kind'], signature: string): SavedCopyReceipt {
    const receipt = Object.freeze({}) as SavedCopyReceipt;
    this.#receipts.set(receipt, { kind, signature });
    return receipt;
  }
  async #decode(captured: StoredSnapshot, op: Operation): Promise<ReferenceBundle | null> {
    if (!captured.exists) return null;
    if (!captured.document) throw storageError();
    const wanted = new Set(captured.document.references.map(reference => reference.assetId));
    const assets: ReferenceAsset[] = [];
    for (const row of captured.assets) if (wanted.has(row.id as string)) {
      const pcm = new Uint8Array(await (row.pcm as Blob).arrayBuffer()); op.check();
      const asset = validateAsset({ ...Object.fromEntries(metadataKeys.filter(key => key !== 'sha256' && key !== 'pcm').map(key => [key, row[key]])), pcm });
      if (await hashReferencePcm(pcm) !== row.sha256) throw storageError();
      op.check(); assets.push(asset);
    }
    return validateBundle({ document: captured.document, assets });
  }
  load(): Promise<LoadedProject> {
    return this.#enqueue(async op => {
      const captured = await this.#read(op), bundle = await this.#decode(captured, op); op.check();
      return { bundle, receipt: this.#receipt('load', captured.signature) };
    });
  }
  acceptLoad(receipt: SavedCopyReceipt): void {
    if (this.#closed) throw closedError();
    const authority = this.#receipts.get(receipt);
    if (!authority || authority.kind !== 'load') throw new SavedCopyConflict();
    this.#receipts.delete(receipt); this.#expected = authority.signature;
  }
  reviewReplacement(): Promise<ReplacementReview> {
    return this.#enqueue(async op => {
      const captured = await this.#read(op);
      let bundle: ReferenceBundle | null = null, readable = !captured.exists;
      try { bundle = await this.#decode(captured, op); readable = true; }
      catch { op.check(); }
      op.check();
      return { receipt: this.#receipt('replacement', captured.signature), summary: {
        readable, title: bundle?.document.composition.title ?? null,
        tracks: bundle?.document.composition.tracks.length ?? null, references: bundle?.document.references.length ?? null,
      } };
    });
  }

  #write(bundle: ReferenceBundle, reviewed?: string): Promise<void> {
    return this.#enqueue(async op => {
      const expected = reviewed ?? this.#expected;
      if (expected === null) throw new SavedCopyConflict();
      const rows: Record<string, unknown>[] = [];
      for (const asset of bundle.assets) {
        rows.push({ ...referenceMetadata(asset), sha256: await hashReferencePcm(asset.pcm), pcm: new Blob([Uint8Array.from(asset.pcm).buffer]) }); op.check();
      }
      const descriptor = { schemaVersion: 2, revision: crypto.randomUUID(), document: bundle.document };
      const next = snapshot(true, descriptor, rows.map(row => row.id), rows).signature;
      const db = await this.#open(op);
      try {
        await this.#transaction<void>(db, 'readwrite', op, (tx, result, fail) => {
          this.#capture(tx, op, captured => {
            try {
              op.check(); if (captured.signature !== expected) throw new SavedCopyConflict();
              const assets = tx.objectStore('assets'); assets.clear();
              for (const row of rows) assets.put(row, row.id as IDBValidKey);
              tx.objectStore('projects').put(descriptor, 'current'); result(undefined);
            } catch (error) { fail(error instanceof Error ? error : storageError()); }
          }, fail);
        });
        op.check(); this.#expected = next;
      } finally { this.#release(db); }
    });
  }
  save(bundle: ReferenceBundle): Promise<void> {
    if (this.#closed) return Promise.reject(closedError());
    let snapshot: ReferenceBundle;
    try { snapshot = validateBundle(bundle); } catch (error) { return Promise.reject(error); }
    return this.#write(snapshot);
  }
  replace(bundle: ReferenceBundle, receipt: SavedCopyReceipt): Promise<void> {
    if (this.#closed) return Promise.reject(closedError());
    const authority = this.#receipts.get(receipt);
    if (!authority || authority.kind !== 'replacement') return Promise.reject(new SavedCopyConflict());
    let snapshot: ReferenceBundle;
    try { snapshot = validateBundle(bundle); } catch (error) { return Promise.reject(error); }
    this.#receipts.delete(receipt);
    return this.#write(snapshot, authority.signature);
  }

  close(): void { this.#closed = true; this.#expected = null; this.#receipts = new WeakMap(); this.#cancelActive?.(closedError()); for (const db of this.#connections) this.#release(db); }
}
