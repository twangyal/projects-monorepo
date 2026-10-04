import { validateBundle, validateDocument, validateAsset } from './reference-project.ts';
import { REFERENCE_LIMITS, type ReferenceBundle, type ReferenceAsset } from './reference-types.ts';
import { exactFields, referenceMetadata, admitReferenceMetadata, hashReferencePcm } from './reference-backup.ts';

export const REFERENCE_DB_NAME = 'melody-studio.projects';
export const REFERENCE_DB_VERSION = 1;
const closedError = () => new Error('Project storage is closed. Reopen the page or choose a complete backup.');
const storageError = () => new Error('The complete saved project could not be accessed. Keep a project backup and retry storage.');
const timeoutError = () => new Error('Project storage timed out after 10 seconds. Keep a complete backup and retry.');
const metadataKeys = ['id', 'kind', 'captureTempo', 'decodedSampleRate', 'decodedChannels', 'decodedFrames', 'analyzedFrames', 'frameCount', 'sha256', 'pcm'];
interface Operation { signal: AbortSignal; check(): void }

export class ReferenceStorage {
  #factory: IDBFactory;
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
    begin: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
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
      try { begin(tx, next => { value = next; }); }
      catch (error) { failure = error instanceof Error ? error : storageError(); try { tx.abort(); } catch { reject(failure); } }
    });
  }

  load(): Promise<ReferenceBundle | null> {
    return this.#enqueue(async op => {
      const db = await this.#open(op);
      try {
        const captured = await this.#transaction<{ document: unknown; assets: unknown[] } | null>(db, 'readonly', op, (tx, result) => {
          const request = tx.objectStore('projects').get('current');
          request.onsuccess = () => {
            try {
              op.check();
              if (request.result === undefined) { result(null); return; }
              const row = exactFields(request.result, ['schemaVersion', 'document']);
              if (row.schemaVersion !== 1) throw storageError();
              const document = validateDocument(row.document);
              const ids = [...new Set(document.references.map(ref => ref.assetId))];
              const assets: unknown[] = new Array(ids.length);
              result({ document, assets });
              for (const [i, id] of ids.entries()) {
                const assetRequest = tx.objectStore('assets').get(id);
                assetRequest.onsuccess = () => { assets[i] = assetRequest.result; };
              }
            } catch { tx.abort(); }
          };
        });
        op.check();
        if (captured === null) return null;
        const assets: ReferenceAsset[] = [];
        for (const value of captured.assets) {
          const row = exactFields(value, metadataKeys);
          admitReferenceMetadata(row);
          if (!(row.pcm instanceof Blob) || row.pcm.type !== '' || row.pcm.size !== (row.frameCount as number) * 2
            || row.pcm.size > REFERENCE_LIMITS.assetBytes || typeof row.sha256 !== 'string' || row.sha256.length !== 64 || !/^[a-f0-9]{64}$/.test(row.sha256)) throw storageError();
          const pcm = new Uint8Array(await row.pcm.arrayBuffer()); op.check();
          const asset = validateAsset({ ...Object.fromEntries(metadataKeys.filter(key => key !== 'sha256' && key !== 'pcm').map(key => [key, row[key]])), pcm });
          if (await hashReferencePcm(pcm) !== row.sha256) throw storageError(); op.check(); assets.push(asset);
        }
        return validateBundle({ document: captured.document, assets });
      } finally { this.#release(db); }
    });
  }

  save(bundle: ReferenceBundle): Promise<void> {
    if (this.#closed) return Promise.reject(closedError());
    let snapshot: ReferenceBundle;
    try { snapshot = validateBundle(bundle); } catch (error) { return Promise.reject(error); }
    return this.#enqueue(async op => {
      const rows: Record<string, unknown>[] = [];
      for (const asset of snapshot.assets) {
        rows.push({ ...referenceMetadata(asset), sha256: await hashReferencePcm(asset.pcm), pcm: new Blob([Uint8Array.from(asset.pcm).buffer]) }); op.check();
      }
      const db = await this.#open(op);
      try {
        await this.#transaction<void>(db, 'readwrite', op, (tx, result) => {
          const assets = tx.objectStore('assets'); assets.clear();
          for (const row of rows) assets.put(row, row.id as IDBValidKey);
          tx.objectStore('projects').put({ schemaVersion: 1, document: snapshot.document }, 'current'); result(undefined);
        });
      } finally { this.#release(db); }
    });
  }

  close(): void { this.#closed = true; this.#cancelActive?.(closedError()); for (const db of this.#connections) this.#release(db); }
}
