import { LIMITS, type Project } from './types.ts';
import { validateProject } from './domain.ts';

export const STORAGE_OPERATION_MS = 10_000;
export const MAX_STORED_BYTES = LIMITS.projectBytes + 80;
export interface SavedCopyReceipt { readonly __savedCopyReceipt: unique symbol }
export interface LoadedProject { project: Project | null; receipt: SavedCopyReceipt }
export interface ReplacementReview {
  receipt: SavedCopyReceipt;
  summary: { present: boolean; readable: boolean; title: string | null;
    pieces: number | null; examples: number | null; looks: number | null; photos: number | null };
}
export class SavedCopyProtected extends Error {
  constructor(message = 'The saved profile is protected. Reopen storage and keep a complete profile backup before reading or reviewing replacement.') {
    super(message); this.name = 'SavedCopyProtected';
  }
}
export class SavedCopyConflict extends Error {
  constructor() {
    super('The saved profile changed in another tab. Keep your complete profile backup and review the saved-copy conflict before replacing it.');
    this.name = 'SavedCopyConflict';
  }
}
export interface ProjectStore {
  load(): Promise<LoadedProject>;
  acceptLoad(receipt: SavedCopyReceipt): void;
  save(project: Project): Promise<void>;
  reviewReplacement(): Promise<ReplacementReview>;
  replace(project: Project, receipt: SavedCopyReceipt): Promise<void>;
  clear(): Promise<void>;
  close(): Promise<void>;
}

const UNAVAILABLE = 'Browser storage (IndexedDB) is unavailable. Continue in memory-only mode and export your profile as a backup.';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/;
const own = (value: object, key: string): unknown => Object.getOwnPropertyDescriptor(value, key)?.value;
const closedError = () => new SavedCopyProtected('This profile storage connection is closed. Reopen storage or export your current in-memory profile.');
const protectedError = () => new SavedCopyProtected('The saved profile is protected. Read and accept the saved profile, or review replacement after exporting your current profile.');
const timeoutError = () => new SavedCopyProtected('Profile storage timed out after 10 seconds. The saved copy is protected; reopen storage and keep a complete profile backup.');
const invalidError = () => new SavedCopyProtected('The saved style profile is invalid or corrupt. Existing browser data was preserved. Continue editing in memory and export a complete profile backup before reviewing replacement.');
const receiptError = () => new SavedCopyProtected('This saved-copy receipt is invalid, stale or already used. Read or review the saved profile again.');
function storageError(error?: unknown): Error {
  const full = error instanceof DOMException && error.name === 'QuotaExceededError';
  return new Error(`${full ? 'Browser storage is full.' : 'The local profile could not be saved or read.'} Your current edits remain in memory. Export your profile as a backup and retry local storage.`);
}

interface Identity { json: string; negativeZeros: string }
interface Snapshot { present: boolean; value: unknown; identity: Identity }
interface Proof { kind: 'load' | 'replacement'; identity: Identity; epoch: number; used: boolean }
interface Operation { epoch: number; signal: AbortSignal; check(): void }
const absent: Identity = Object.freeze({ json: 'absent', negativeZeros: '' });
const equal = (left: Identity, right: Identity) => left.json === right.json && left.negativeZeros === right.negativeZeros;

/** Identify all raw fields, never normalize saved values or invoke accessors.
 * Charge expanded JSON separately from the small negative-zero position table.
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
    if (++nodes > 100_000 || depth > 32) throw invalidError();
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
      for (let index = 0; index < item.length; index++) {
        if (index) append(',');
        visit(field(String(index)), depth + 1);
      }
      append(']');
    } else {
      if (keys.some(key => typeof key !== 'string')) throw invalidError();
      const ordered = (keys as string[]).sort();
      append('{');
      for (let index = 0; index < ordered.length; index++) {
        if (index) append(',');
        quote(ordered[index]); append(':'); visit(field(ordered[index]), depth + 1);
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
  #tail: Promise<void> = Promise.resolve();
  #closed = false;
  #unavailable = false;
  #closing: Promise<void> | null = null;
  #epoch = 0;
  #expected: Identity | null = null;
  #cancelActive: ((error: Error) => void) | null = null;

  constructor(database: IDBDatabase) {
    this.#database = database;
    database.onversionchange = () => {
      const error = new SavedCopyProtected('Profile storage changed in another tab. Reopen storage and keep a complete profile backup.');
      if (this.#cancelActive) this.#cancelActive(error);
      else { this.#protect(); this.#unavailable = true; database.close(); }
    };
  }
  #protect(): void { this.#epoch++; this.#expected = null; }
  #enqueue<T>(action: (operation: Operation) => Promise<T>, admittedEpoch?: number): Promise<T> {
    if (this.#closed || this.#unavailable) return Promise.reject(closedError());
    const result = this.#tail.then(async () => {
      if (this.#unavailable) throw closedError();
      if (admittedEpoch !== undefined && admittedEpoch !== this.#epoch) throw receiptError();
      const epoch = this.#epoch, deadline = performance.now() + STORAGE_OPERATION_MS;
      const controller = new AbortController();
      const fail = (error: Error) => {
        if (controller.signal.aborted) return;
        this.#protect(); this.#unavailable = true;
        controller.abort(error); this.#database.close();
      };
      const operation: Operation = {
        epoch, signal: controller.signal,
        check: () => {
          if (controller.signal.aborted) throw controller.signal.reason;
          if (performance.now() >= deadline) { const error = timeoutError(); fail(error); throw error; }
          if (epoch !== this.#epoch || this.#unavailable) throw protectedError();
        },
      };
      this.#cancelActive = fail;
      const timer = setTimeout(() => fail(timeoutError()), STORAGE_OPERATION_MS);
      let abort!: () => void;
      const retired = new Promise<never>((_resolve, reject) => {
        abort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', abort, { once: true });
      });
      try {
        const output = await Promise.race([action(operation), retired]);
        operation.check(); return output;
      } finally {
        clearTimeout(timer); controller.signal.removeEventListener('abort', abort);
        if (this.#cancelActive === fail) this.#cancelActive = null;
      }
    });
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }
  #transaction<T>(mode: IDBTransactionMode, operation: Operation,
    action: (store: IDBObjectStore, captured: Snapshot) => T): Promise<T> {
    operation.check();
    return new Promise((resolve, reject) => {
      let transaction: IDBTransaction;
      try { transaction = this.#database.transaction('profiles', mode); }
      catch (error) { this.#protect(); reject(new SavedCopyProtected(storageError(error).message)); return; }
      let output: T, ready = false, complete = false, settled = false, failure: Error | null = null;
      const finish = (error?: Error) => {
        if (settled || !error && (!ready || !complete)) return;
        settled = true; operation.signal.removeEventListener('abort', cancelled);
        if (error) reject(error); else resolve(output);
      };
      const cancelled = () => {
        try { transaction.abort(); } catch { /* Native terminal may already have happened. */ }
        finish(operation.signal.reason);
      };
      const fail = (error: Error) => {
        failure ??= error;
        try { transaction.abort(); }
        catch { if (mode === 'readwrite') this.#protect(); finish(failure); }
      };
      operation.signal.addEventListener('abort', cancelled, { once: true });
      transaction.onerror = event => { failure ??= storageError((event.target as IDBRequest).error || transaction.error); };
      transaction.onabort = () => {
        const error = failure ?? storageError(transaction.error);
        if (!(error instanceof SavedCopyConflict) && !(error instanceof SavedCopyProtected)) {
          try { operation.check(); }
          catch (expired) { finish(expired instanceof Error ? expired : protectedError()); return; }
        }
        if (mode === 'readonly') { this.#protect(); finish(new SavedCopyProtected(error.message)); }
        else finish(error);
      };
      transaction.oncomplete = () => {
        complete = true;
        try { operation.check(); if (failure) throw failure; finish(); }
        catch (error) { finish(error instanceof Error ? error : storageError()); }
      };
      try {
        const store = transaction.objectStore('profiles');
        const value = store.get('current'), key = store.getKey('current');
        let remaining = 2;
        const read = () => {
          if (settled || --remaining) return;
          try {
            operation.check(); if (failure) throw failure;
            if (mode === 'readwrite' && complete) throw protectedError();
            const present = key.result !== undefined;
            let signature: Identity;
            try { signature = present ? identity(value.result) : absent; }
            catch (error) { this.#protect(); throw error; }
            operation.check();
            output = action(store, { present, value: value.result as unknown, identity: signature });
            operation.check(); ready = true; finish();
          } catch (error) { fail(error instanceof Error ? error : storageError()); }
        };
        value.onsuccess = read; key.onsuccess = read;
      } catch (error) { fail(storageError(error)); }
    });
  }
  #receipt(kind: Proof['kind'], captured: Identity, operation: Operation): SavedCopyReceipt {
    operation.check();
    const token = Object.freeze({}) as SavedCopyReceipt;
    this.#proofs.set(token, { kind, identity: captured, epoch: operation.epoch, used: false });
    return token;
  }
  #proof(token: SavedCopyReceipt, kind: Proof['kind']): Proof {
    if (this.#closed || this.#unavailable) throw closedError();
    const proof = token && typeof token === 'object' ? this.#proofs.get(token) : undefined;
    if (!proof || proof.used || proof.kind !== kind || proof.epoch !== this.#epoch) throw receiptError();
    return proof;
  }
  load(): Promise<LoadedProject> {
    return this.#enqueue(async operation => {
      const captured = await this.#transaction('readonly', operation, (_store, value) => value);
      operation.check();
      let project: Project | null = null;
      if (captured.present) try { project = projectFrom(captured.value); }
      catch { this.#protect(); throw invalidError(); }
      operation.check();
      return { project, receipt: this.#receipt('load', captured.identity, operation) };
    }, this.#epoch);
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
      if (row === null) store.delete('current'); else store.put(row, 'current');
      return next;
    });
  }
  save(project: Project): Promise<void> {
    if (this.#closed || this.#unavailable) return Promise.reject(closedError());
    let captured: Project;
    try { captured = validateProject(project); } catch (error) { return Promise.reject(error); }
    return this.#enqueue(async operation => {
      if (!this.#expected) throw protectedError();
      const next = await this.#write(captured, this.#expected, operation);
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
      catch { /* Bounded unreadable ordinary data can receive replacement-only authority. */ }
      operation.check();
      return { receipt: this.#receipt('replacement', captured.identity, operation), summary: {
        present: captured.present, readable: !captured.present || project !== null,
        title: project?.title ?? null, pieces: project?.pieces.length ?? null,
        examples: project?.examples.length ?? null, looks: project?.looks.length ?? null, photos: project?.photos.length ?? null,
      } };
    }, this.#epoch);
  }
  replace(project: Project, receipt: SavedCopyReceipt): Promise<void> {
    if (this.#closed || this.#unavailable) return Promise.reject(closedError());
    let captured: Project, proof: Proof;
    try { captured = validateProject(project); proof = this.#proof(receipt, 'replacement'); }
    catch (error) { return Promise.reject(error); }
    proof.used = true;
    return this.#enqueue(async operation => {
      const next = await this.#write(captured, proof.identity, operation);
      operation.check(); this.#expected = next;
    }, proof.epoch);
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#closing = this.#tail.then(() => { this.#database.close(); });
    return this.#closing;
  }
}

export async function openProjectStore(): Promise<ProjectStore> {
  let factory: IDBFactory | undefined;
  try { factory = globalThis.indexedDB; } catch { throw new SavedCopyProtected(UNAVAILABLE); }
  if (!factory) throw new SavedCopyProtected(UNAVAILABLE);
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try { request = factory.open('style-studio', 2); } catch { reject(new SavedCopyProtected(UNAVAILABLE)); return; }
    const deadline = performance.now() + STORAGE_OPERATION_MS;
    let settled = false, cause: Error | null = null;
    const fail = (error: Error) => { if (settled) return; settled = true; clearTimeout(timer); reject(error); };
    const check = () => { if (performance.now() >= deadline) fail(timeoutError()); return !settled; };
    const timer = setTimeout(() => fail(timeoutError()), STORAGE_OPERATION_MS);
    request.onblocked = () => fail(new SavedCopyProtected('Profile storage is blocked by another open tab. Close older Style Studio tabs and retry. Your edits remain in memory; export a backup.'));
    request.onerror = () => fail(cause ?? new SavedCopyProtected(UNAVAILABLE));
    request.onupgradeneeded = event => {
      try {
        if (!check()) { request.transaction?.abort(); return; }
        const database = request.result;
        if (!database.objectStoreNames.contains('profiles')) {
          if (event.oldVersion !== 0) {
            cause = new SavedCopyProtected('The saved profile database has an incompatible schema. Existing storage was preserved; export your current profile.');
            request.transaction?.abort(); return;
          }
          database.createObjectStore('profiles');
        }
      } catch {
        cause = new SavedCopyProtected(UNAVAILABLE);
        try { request.transaction?.abort(); } catch { fail(cause); }
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (!check()) { database.close(); return; }
      if (database.version !== 2 || !database.objectStoreNames.contains('profiles')) {
        database.close(); fail(new SavedCopyProtected('The saved profile database has an incompatible schema. Existing storage was preserved. Continue in memory and export your current profile.')); return;
      }
      settled = true; clearTimeout(timer); resolve(new LocalProjectStore(database));
    };
  });
}
