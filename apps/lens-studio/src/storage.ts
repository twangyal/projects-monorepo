import { LIMITS, type Project, type Raster, type Settings } from './types.ts';
import { validateProject } from './model.ts';
import { decodePhoto } from './images.ts';

export const STORAGE_OPEN_MS = 5_000;
export const STORAGE_OPERATION_MS = 10_000;
export const STORAGE_IMAGE_MS = 30_000;
export const MAX_STORED_BYTES = LIMITS.projectBytes + 80;
export interface SavedCopyReceipt { readonly __savedCopyReceipt: unique symbol }
export interface LoadedProject { project: Project | null; raster: Raster | null; receipt: SavedCopyReceipt }
export interface ReplacementReview {
  receipt: SavedCopyReceipt;
  summary: { present: boolean; readable: boolean; title: string | null;
    width: number | null; height: number | null; mode: Settings['mode'] | null };
}
export class SavedCopyProtected extends Error {
  constructor(message = 'The saved study is protected. Keep your work open, Download project for a backup, then reopen storage and retry recovery.') {
    super(message); this.name = 'SavedCopyProtected';
  }
}
export class SavedCopyConflict extends Error {
  constructor() {
    super('The complete saved study changed in another tab. Your current photo and mask remain here. Download project, then review the saved-copy conflict before replacing it.');
    this.name = 'SavedCopyConflict';
  }
}
export interface ProjectStore {
  load(options?: { signal?: AbortSignal }): Promise<LoadedProject>;
  acceptLoad(receipt: SavedCopyReceipt): void;
  save(project: Project): Promise<void>;
  reviewReplacement(): Promise<ReplacementReview>;
  replace(project: Project, receipt: SavedCopyReceipt): Promise<void>;
  clear(): Promise<void>;
  close(): Promise<void>;
}

const DATABASE = 'lens-studio.v1', STORE = 'projects', KEY = 'current';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/;
const unavailable = () => new SavedCopyProtected('Local storage is unavailable in this browser. Keep your work open, Download project for a backup, then retry.');
const closedError = () => new SavedCopyProtected('This study storage instance is retired or closed. Wait for its owned work to drain, Download project, then reopen storage and retry.');
const protectedError = () => new SavedCopyProtected('The saved study is protected. Download project, then read and accept the saved study or review replacement before saving.');
const invalidError = () => new SavedCopyProtected('Saved project is invalid or corrupt, or its image could not be decoded. Stored data was kept. Download project and review recovery.');
const receiptError = () => new SavedCopyProtected('This study receipt is invalid, stale or already used. Download project, then read or review the saved copy again.');
const timeoutError = (phase: string) => new SavedCopyProtected(`Local storage ${phase} timed out. The saved study is protected. Download project, wait for owned work to drain, then reopen storage and retry.`);
const aborted = () => new DOMException('Study loading was cancelled. Current work and saved data were kept.', 'AbortError');
const rollbackError = () => new Error('Local storage could not complete the transaction. Keep your work open, Download project for a backup, then retry.');
const own = (value: object, key: string): unknown => Object.getOwnPropertyDescriptor(value, key)?.value;
interface Identity { json: string; negativeZeros: string }
interface Snapshot { present: boolean; value: unknown; identity: Identity }
interface Proof { kind: 'load' | 'replacement'; identity: Identity; epoch: number; used: boolean; signal?: AbortSignal }
interface Operation { epoch: number; signal: AbortSignal; check(): void }
const absent: Identity = Object.freeze({ json: 'absent', negativeZeros: '' });
const equal = (left: Identity, right: Identity) => left.json === right.json && left.negativeZeros === right.negativeZeros;

/** Full raw identity before title/decimal normalization, with independent UTF-8
 * JSON budget and negative-zero positions. Never call getters or toJSON hooks.
 */
function identity(value: unknown): Identity {
  if (value === undefined) return { json: 'present-undefined', negativeZeros: '' };
  const maximum = value !== null && typeof value === 'object' && own(value, 'schemaVersion') === 2
    ? MAX_STORED_BYTES : LIMITS.projectBytes;
  let bytes = 0, nodes = 0;
  const parts: string[] = [], negativeZeros: number[] = [], ancestors = new Set<object>();
  const charge = (count: number) => { bytes += count; if (bytes > maximum) throw invalidError(); };
  const append = (text: string) => { charge(text.length); parts.push(text); };
  const quote = (text: string) => {
    charge(2);
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code === 34 || code === 92) charge(2);
      else if (code < 32) charge([8, 9, 10, 12, 13].includes(code) ? 2 : 6);
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { charge(4); index++; } else charge(6);
      } else if (code >= 0xdc00 && code <= 0xdfff) charge(6);
      else charge(code < 128 ? 1 : code < 2048 ? 2 : 3);
    }
    parts.push(JSON.stringify(text));
  };
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 100_000 || depth > LIMITS.jsonDepth) throw invalidError();
    if (item === null || typeof item === 'boolean') { append(String(item)); return; }
    if (typeof item === 'string') { quote(item); return; }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw invalidError();
      if (Object.is(item, -0)) negativeZeros.push(nodes);
      append(JSON.stringify(item)); return;
    }
    if (!item || typeof item !== 'object' || ancestors.has(item)) throw invalidError();
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw invalidError();
    const keys = Reflect.ownKeys(item);
    if (keys.length > 100_000 || array && keys.length !== item.length + 1) throw invalidError();
    const field = (key: string): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw invalidError();
      return descriptor.value;
    };
    ancestors.add(item);
    if (array) {
      append('[');
      for (let index = 0; index < item.length; index++) { if (index) append(','); visit(field(String(index)), depth + 1); }
      append(']');
    } else {
      if (keys.some(key => typeof key !== 'string')) throw invalidError();
      const ordered = (keys as string[]).sort(); append('{');
      for (let index = 0; index < ordered.length; index++) {
        if (index) append(','); quote(ordered[index]); append(':'); visit(field(ordered[index]), depth + 1);
      }
      append('}');
    }
    ancestors.delete(item);
  };
  visit(value, 0);
  return { json: parts.join(''), negativeZeros: negativeZeros.join(',') };
}
function projectFrom(value: unknown): Project {
  if (value !== null && typeof value === 'object' && own(value, 'schemaVersion') === 2) {
    const prototype = Object.getPrototypeOf(value), keys = Reflect.ownKeys(value);
    if (prototype !== Object.prototype && prototype !== null || keys.length !== 3
        || keys.some(key => !['schemaVersion', 'revision', 'project'].includes(key as string))) throw invalidError();
    for (const key of ['schemaVersion', 'revision', 'project']) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) throw invalidError();
    }
    const revision = own(value, 'revision');
    if (typeof revision !== 'string' || !UUID.test(revision)) throw invalidError();
    return validateProject(own(value, 'project'));
  }
  return validateProject(value);
}

class LocalProjectStore implements ProjectStore {
  readonly #database: IDBDatabase;
  readonly #proofs = new WeakMap<SavedCopyReceipt, Proof>();
  readonly #drains = new Set<Promise<void>>();
  #tail: Promise<void> = Promise.resolve();
  #closed = false;
  #retired = false;
  #closing: Promise<void> | null = null;
  #epoch = 0;
  #expected: Identity | null = null;
  #cancelActive: ((error: Error) => void) | null = null;

  constructor(database: IDBDatabase) {
    this.#database = database;
    database.onversionchange = () => this.#retire(new SavedCopyProtected(
      'Study storage changed in another tab. Keep your work open, Download project, then reopen storage and retry.'));
  }
  #protect(): void { this.#epoch++; this.#expected = null; }
  #retire(error: Error): void {
    if (!this.#retired) { this.#retired = true; this.#protect(); }
    this.#cancelActive?.(error);
    this.#database.close();
  }
  #drain(promise: Promise<unknown>): void {
    const drain = promise.then(() => undefined, () => undefined);
    this.#drains.add(drain);
    void drain.then(() => this.#drains.delete(drain));
  }
  #enqueue<T>(action: (operation: Operation) => Promise<T>, admittedEpoch?: number,
    signal?: AbortSignal): Promise<T> {
    if (this.#closed || this.#retired) return Promise.reject(closedError());
    const cancelled = () => this.#retire(aborted());
    if (signal?.aborted) { cancelled(); return Promise.reject(aborted()); }
    signal?.addEventListener('abort', cancelled, { once: true });
    const result = this.#tail.then(async () => {
      if (signal?.aborted) throw aborted();
      if (this.#retired) throw closedError();
      if (admittedEpoch !== undefined && admittedEpoch !== this.#epoch) throw receiptError();
      const epoch = this.#epoch, controller = new AbortController();
      const cancel = (error: Error) => { if (!controller.signal.aborted) controller.abort(error); };
      const operation: Operation = {
        epoch, signal: controller.signal,
        check: () => {
          if (controller.signal.aborted) throw controller.signal.reason;
          if (this.#retired || epoch !== this.#epoch) throw protectedError();
        },
      };
      this.#cancelActive = cancel;
      let abort!: () => void;
      const retired = new Promise<never>((_resolve, reject) => {
        abort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', abort, { once: true });
      });
      try {
        const output = await Promise.race([action(operation), retired]);
        operation.check(); return output;
      } finally {
        controller.signal.removeEventListener('abort', abort);
        if (this.#cancelActive === cancel) this.#cancelActive = null;
      }
    });
    this.#tail = result.then(() => undefined, () => undefined);
    return result.finally(() => signal?.removeEventListener('abort', cancelled));
  }
  #deadline(operation: Operation, deadline: number, phase: string): void {
    operation.check();
    if (performance.now() >= deadline) {
      const error = timeoutError(phase); this.#retire(error); throw error;
    }
  }
  async #decode(project: Project, operation: Operation): Promise<Raster> {
    operation.check();
    const deadline = performance.now() + STORAGE_IMAGE_MS;
    const actual = decodePhoto(project.photo, operation.signal);
    this.#drain(actual);
    let abort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(operation.signal.reason);
      operation.signal.addEventListener('abort', abort, { once: true });
    });
    const timer = setTimeout(() => this.#retire(timeoutError('image validation')), STORAGE_IMAGE_MS);
    try {
      const raster = await Promise.race([actual, cancelled]);
      this.#deadline(operation, deadline, 'image validation'); return raster;
    } finally {
      clearTimeout(timer); operation.signal.removeEventListener('abort', abort);
    }
  }
  #transaction<T>(mode: IDBTransactionMode, operation: Operation,
    action: (store: IDBObjectStore, captured: Snapshot) => T): Promise<T> {
    operation.check();
    const deadline = performance.now() + STORAGE_OPERATION_MS;
    return new Promise((resolve, reject) => {
      let transaction: IDBTransaction;
      try { transaction = this.#database.transaction(STORE, mode); }
      catch { this.#retire(unavailable()); reject(unavailable()); return; }
      let nativeDone!: () => void;
      this.#drain(new Promise<void>(done => { nativeDone = done; }));
      let output: T, ready = false, complete = false, settled = false, failure: Error | null = null;
      const check = () => this.#deadline(operation, deadline, 'transaction');
      const finish = (error?: Error) => {
        if (settled || !error && (!ready || !complete)) return;
        settled = true; clearTimeout(timer);
        operation.signal.removeEventListener('abort', cancelled);
        if (error) reject(error); else resolve(output);
      };
      const cancelled = () => {
        try { transaction.abort(); } catch { /* Keep terminal handlers until native completion. */ }
        finish(operation.signal.reason);
      };
      const timer = setTimeout(() => this.#retire(timeoutError('transaction')), STORAGE_OPERATION_MS);
      const fail = (error: Error) => {
        failure ??= error;
        try { transaction.abort(); }
        catch {
          if (mode === 'readwrite' && !(error instanceof SavedCopyConflict)) {
            this.#retire(protectedError()); finish(protectedError());
          } else finish(error);
        }
      };
      operation.signal.addEventListener('abort', cancelled, { once: true });
      transaction.onerror = () => { failure ??= rollbackError(); };
      transaction.onabort = () => {
        nativeDone();
        if (settled) return;
        // Conflict/corrupt admission has already revoked this operation's epoch.
        // Keep its precise failure, while still retiring any overdue rollback.
        if (performance.now() >= deadline) {
          const error = timeoutError('transaction'); this.#retire(error); finish(error); return;
        }
        const error = failure ?? rollbackError();
        if (!(error instanceof SavedCopyConflict) && !(error instanceof SavedCopyProtected)) {
          try { operation.check(); }
          catch (expired) { finish(expired instanceof Error ? expired : protectedError()); return; }
        }
        if (mode === 'readonly' && !(error instanceof SavedCopyConflict) && !(error instanceof SavedCopyProtected)) {
          this.#protect(); finish(new SavedCopyProtected(error.message));
        } else finish(error);
      };
      transaction.oncomplete = () => {
        nativeDone(); complete = true;
        if (settled) return;
        try { check(); if (failure) throw failure; finish(); }
        catch (error) { finish(error instanceof Error ? error : protectedError()); }
      };
      try {
        const store = transaction.objectStore(STORE), value = store.get(KEY), key = store.getKey(KEY);
        let remaining = 2;
        const read = () => {
          if (settled || --remaining) return;
          try {
            check(); if (failure) throw failure;
            if (mode === 'readwrite' && complete) { this.#retire(protectedError()); throw protectedError(); }
            const present = key.result !== undefined;
            let signature: Identity;
            try { signature = present ? identity(value.result) : absent; }
            catch { this.#protect(); throw invalidError(); }
            check();
            output = action(store, { present, value: value.result as unknown, identity: signature });
            check(); ready = true; finish();
          } catch (error) { fail(error instanceof Error ? error : rollbackError()); }
        };
        value.onsuccess = read; key.onsuccess = read;
      } catch { fail(rollbackError()); }
    });
  }
  #receipt(kind: Proof['kind'], captured: Identity, operation: Operation, signal?: AbortSignal): SavedCopyReceipt {
    operation.check();
    const token = Object.freeze({}) as SavedCopyReceipt;
    this.#proofs.set(token, { kind, identity: captured, epoch: operation.epoch, used: false, signal });
    return token;
  }
  #proof(token: SavedCopyReceipt, kind: Proof['kind']): Proof {
    if (this.#closed || this.#retired) throw closedError();
    const proof = token && typeof token === 'object' ? this.#proofs.get(token) : undefined;
    if (!proof || proof.used || proof.kind !== kind || proof.epoch !== this.#epoch || proof.signal?.aborted) throw receiptError();
    return proof;
  }
  load({ signal }: { signal?: AbortSignal } = {}): Promise<LoadedProject> {
    return this.#enqueue(async operation => {
      const captured = await this.#transaction('readonly', operation, (_store, value) => value);
      operation.check();
      let project: Project | null = null, raster: Raster | null = null;
      if (captured.present) {
        try { project = projectFrom(captured.value); }
        catch { this.#protect(); throw invalidError(); }
        operation.check();
        try { raster = await this.#decode(project, operation); }
        catch (error) {
          operation.check(); this.#protect();
          if (error instanceof SavedCopyProtected) throw error;
          throw invalidError();
        }
      }
      operation.check();
      return { project, raster, receipt: this.#receipt('load', captured.identity, operation, signal) };
    }, this.#epoch, signal);
  }
  acceptLoad(receipt: SavedCopyReceipt): void {
    const proof = this.#proof(receipt, 'load'); proof.used = true; this.#expected = proof.identity;
  }
  #write(project: Project | null, expected: Identity, operation: Operation): Promise<Identity> {
    const row = project === null ? null : { schemaVersion: 2, revision: crypto.randomUUID(), project };
    const next = row === null ? absent : identity(row);
    operation.check();
    return this.#transaction('readwrite', operation, (store, captured) => {
      if (!equal(captured.identity, expected)) { this.#protect(); throw new SavedCopyConflict(); }
      operation.check();
      if (row === null) store.delete(KEY); else store.put(row, KEY);
      return next;
    });
  }
  save(project: Project): Promise<void> {
    if (this.#closed || this.#retired) return Promise.reject(closedError());
    let captured: Project;
    try { captured = validateProject(project); } catch (error) { return Promise.reject(error); }
    return this.#enqueue(async operation => {
      if (!this.#expected) throw protectedError();
      const expected = this.#expected;
      await this.#decode(captured, operation); operation.check();
      const next = await this.#write(captured, expected, operation);
      operation.check(); this.#expected = next;
    });
  }
  clear(): Promise<void> {
    return this.#enqueue(async operation => {
      if (!this.#expected) throw protectedError();
      const next = await this.#write(null, this.#expected, operation);
      operation.check(); this.#expected = next;
    });
  }
  reviewReplacement(): Promise<ReplacementReview> {
    return this.#enqueue(async operation => {
      const captured = await this.#transaction('readonly', operation, (_store, value) => value);
      operation.check();
      let project: Project | null = null;
      if (captured.present) try { project = projectFrom(captured.value); }
      catch { /* Comparable malformed data receives replacement-only authority. */ }
      operation.check();
      return { receipt: this.#receipt('replacement', captured.identity, operation), summary: {
        present: captured.present, readable: !captured.present || project !== null,
        title: project?.title ?? null, width: project?.photo.width ?? null,
        height: project?.photo.height ?? null, mode: project?.settings.mode ?? null,
      } };
    }, this.#epoch);
  }
  replace(project: Project, receipt: SavedCopyReceipt): Promise<void> {
    if (this.#closed || this.#retired) return Promise.reject(closedError());
    let captured: Project, proof: Proof;
    try { captured = validateProject(project); proof = this.#proof(receipt, 'replacement'); }
    catch (error) { return Promise.reject(error); }
    proof.used = true;
    return this.#enqueue(async operation => {
      await this.#decode(captured, operation); operation.check();
      const next = await this.#write(captured, proof.identity, operation);
      operation.check(); this.#expected = next;
    }, proof.epoch);
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#closing = this.#tail.then(async () => {
      this.#database.close();
      await Promise.all([...this.#drains]);
    });
    return this.#closing;
  }
}

export async function openProjectStore(): Promise<ProjectStore> {
  let factory: IDBFactory | undefined;
  try { factory = globalThis.indexedDB; } catch { throw unavailable(); }
  if (!factory) throw unavailable();
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try { request = factory.open(DATABASE, 2); } catch { reject(unavailable()); return; }
    const deadline = performance.now() + STORAGE_OPEN_MS;
    let settled = false, cause: Error | null = null;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      try { request.transaction?.abort(); } catch { /* Upgrade may already be terminal. */ }
      reject(error);
    };
    const check = () => {
      if (performance.now() >= deadline) fail(timeoutError('open'));
      return !settled;
    };
    const timer = setTimeout(() => fail(timeoutError('open')), STORAGE_OPEN_MS);
    request.onblocked = () => fail(new SavedCopyProtected(
      'Local storage is blocked by another open tab. Close older Lens Studio tabs, Download project and retry.'));
    request.onerror = () => fail(cause ?? unavailable());
    request.onupgradeneeded = event => {
      try {
        if (!check()) { request.transaction?.abort(); return; }
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) {
          if (event.oldVersion !== 0) {
            cause = new SavedCopyProtected('Saved project storage has an incompatible schema. Existing data was preserved. Download project and retry recovery.');
            request.transaction?.abort(); return;
          }
          database.createObjectStore(STORE);
        }
      } catch {
        cause = unavailable();
        try { request.transaction?.abort(); } catch { fail(cause); }
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (!check()) { database.close(); return; }
      if (database.version !== 2 || !database.objectStoreNames.contains(STORE)) {
        database.close(); fail(new SavedCopyProtected('Saved project storage has an incompatible schema. Existing data was preserved. Download project and retry recovery.')); return;
      }
      settled = true; clearTimeout(timer); resolve(new LocalProjectStore(database));
    };
  });
}
