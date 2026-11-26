import { MAX_CUES } from './lyrics.ts';
import { readReviewCheckpoint, serializeReviewCheckpoint } from './review-checkpoint.ts';
import type { ReviewedCue } from './automatic-review.ts';

export const MAX_RECOVERY_RECORDS = 20;
export const RECOVERY_DATABASE = 'karaoke-review-recovery';
export interface RecoveryRecord {
  kind: 'karaoke-review-recovery'; version: 1; projectId: string; source: 'reference' | 'candidate' | 'passage';
  binding: string; count: number; checkpoint: string; revision: string; savedAt: number;
}
const invalid = () => new Error('This browser recovery copy is unreadable. Current review drafts are unchanged.');
export class RecoveryConflictError extends Error {
  constructor() { super('The recovery copy changed in another tab. Current drafts and the newer copy were kept. Reopen the review to choose the saved copy, or download a manual checkpoint.'); }
}
export class RecoveryDeletedError extends Error {
  constructor() { super('This clip was deleted. Its browser recovery cannot be recreated; current draft words stay in this tab.'); }
}
export function parseRecoveryRecord(value: unknown, projectId: string): RecoveryRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join() !== 'binding,checkpoint,count,kind,projectId,revision,savedAt,source,version'
    || row.kind !== 'karaoke-review-recovery' || row.version !== 1 || row.projectId !== projectId
    || typeof projectId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(projectId)
    || !['reference','candidate','passage'].includes(row.source as string)
    || typeof row.binding !== 'string' || !/^[a-f0-9]{64}$/.test(row.binding)
    || typeof row.revision !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(row.revision)
    || !Number.isSafeInteger(row.savedAt) || (row.savedAt as number) < 0
    || !Number.isInteger(row.count) || (row.count as number) < 1 || (row.count as number) > MAX_CUES
    || typeof row.checkpoint !== 'string') throw invalid();
  readReviewCheckpoint(row.checkpoint, row.binding, row.count as number);
  return { ...row } as unknown as RecoveryRecord;
}
export function makeRecoveryRecord(projectId: string, source: RecoveryRecord['source'], binding: string, draft: readonly ReviewedCue[], checked: readonly number[]): RecoveryRecord {
  return parseRecoveryRecord({ kind:'karaoke-review-recovery', version:1, projectId, source, binding, count:draft.length,
    checkpoint:serializeReviewCheckpoint(binding,draft,checked), revision:crypto.randomUUID(), savedAt:Date.now() },projectId);
}
export function readRecoveryDraft(record: RecoveryRecord, binding: string, count: number) {
  const value = parseRecoveryRecord(record,record.projectId);
  return readReviewCheckpoint(value.checkpoint,binding,count);
}

/** A readwrite transaction compares and replaces one clip's copy atomically, including across browser tabs. */
export function createReviewRecoveryStore(factory?: IDBFactory) {
  let opening: Promise<IDBDatabase> | null = null;
  function open(): Promise<IDBDatabase> {
    if (opening) return opening;
    opening = new Promise((resolve,reject) => {
      let request: IDBOpenDBRequest, settled = false;
      try {
        const available = factory ?? globalThis.indexedDB;
        if (!available) throw new Error('Browser recovery storage is unavailable. Download a manual checkpoint before leaving.');
        request = available.open(RECOVERY_DATABASE,1);
      } catch (error) { reject(error); return; }
      request.onupgradeneeded = () => {
        request.result.createObjectStore('copies',{keyPath:'projectId'});
        // Clip IDs are never reused. Keep only the opaque ID, not the deleted private words.
        request.result.createObjectStore('deleted');
      };
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true;
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
      request.onerror = () => { settled = true; reject(request.error ?? new Error('Browser recovery storage could not open.')); };
      request.onblocked = () => { settled = true; reject(new Error('Another tab blocks browser recovery storage. Close older tabs or download a manual checkpoint.')); };
    });
    opening.catch(() => { opening = null; });
    return opening;
  }
  async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value:T)=>void, fail:(error:unknown)=>void, deleted: IDBObjectStore)=>void): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve,reject) => {
      let tx: IDBTransaction, value: T, problem: unknown;
      try { tx = db.transaction(['copies','deleted'],mode); } catch (error) { reject(error); return; }
      const fail = (error: unknown) => { problem = error; try { tx.abort(); } catch { reject(error); } };
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(problem ?? tx.error ?? new Error('Browser recovery could not be saved. Download a manual checkpoint before leaving.'));
      tx.onerror = () => { problem ??= tx.error; };
      try { run(tx.objectStore('copies'), next => { value = next; }, fail,tx.objectStore('deleted')); } catch (error) { fail(error); }
    });
  }
  return {
    async load(projectId: string): Promise<RecoveryRecord | null> {
      return transaction('readonly',(store,result,fail) => {
        const request = store.get(projectId);
        request.onsuccess = () => { try { result(request.result === undefined ? null : parseRecoveryRecord(request.result,projectId)); } catch(error) { fail(error); } };
      });
    },
    async save(record: RecoveryRecord, expectedRevision: string | null, permitted: () => boolean = () => true): Promise<RecoveryRecord> {
      const next = parseRecoveryRecord(record,record.projectId);
      return transaction('readwrite',(store,result,fail,deleted) => {
        const lifetime = deleted.get(next.projectId);
        lifetime.onsuccess = () => {
          if (lifetime.result !== undefined) { fail(new RecoveryDeletedError()); return; }
          const request = store.get(next.projectId);
          request.onsuccess = () => {
            try {
              const current = request.result === undefined ? null : parseRecoveryRecord(request.result,next.projectId);
              if ((current?.revision ?? null) !== expectedRevision) { fail(new RecoveryConflictError()); return; }
              const put = () => { try {
                if (!permitted()) throw new Error('Recovery is off. No new copy was saved.');
                store.put(next); result(next);
              } catch(error) { fail(error); } };
              if (current) put();
              else {
                const count = store.count();
                count.onsuccess = () => { if (count.result >= MAX_RECOVERY_RECORDS) fail(new Error('This browser already holds 20 review recovery copies. Delete an old copy or download a manual checkpoint; nothing was evicted.')); else put(); };
              }
            } catch(error) { fail(error); }
          };
        };
      });
    },
    async remove(projectId: string, expectedRevision: string | null): Promise<void> {
      return transaction('readwrite',(store,result,fail) => {
        const request = store.get(projectId);
        request.onsuccess = () => {
          try {
            const current = request.result === undefined ? null : parseRecoveryRecord(request.result,projectId);
            if ((current?.revision ?? null) !== expectedRevision) { fail(new RecoveryConflictError()); return; }
            store.delete(projectId); result(undefined);
          } catch(error) { fail(error); }
        };
      });
    },
    /** Atomically fence all tabs, including a suspended tab that has never written a copy. */
    async forget(projectId: string): Promise<void> {
      return transaction('readwrite',(store,result,_fail,deleted) => { store.delete(projectId); deleted.put(true,projectId); result(undefined); });
    },
  };
}
export type ReviewRecoveryStore = ReturnType<typeof createReviewRecoveryStore>;
