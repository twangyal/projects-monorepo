import { validateProject, type Project } from './model.ts';
import { validateProjectImages } from './project-media.ts';

const DATABASE_NAME = 'clothing-studio';
const STORE_NAME = 'project';
const PROJECT_KEY = 'current';
const REVISION_KEY = 'current-revision';
let observedRevision: string | null | undefined;
export class ProjectConflictError extends Error {
  constructor() { super('Another tab changed the saved concept. Your current concept is kept in memory. Export its project backup, then reload to open the newer save or explicitly replace it.'); }
}

function storageError(action: string, cause?: DOMException | null): Error {
  return new Error(`Could not ${action} the local project${cause?.message ? `: ${cause.message}` : '. Check browser storage permissions and keep a backup file.'}`);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(storageError('access'));
      return;
    }
    let settled = false;
    // Older unconditional open(v1) writers must refuse after this migration.
    const request = indexedDB.open(DATABASE_NAME, 2);
    let upgradeError: DOMException | null = null;
    request.onupgradeneeded = () => {
      try { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME); }
      catch (error) { upgradeError = error instanceof DOMException ? error : new DOMException('Could not create project storage.'); request.transaction?.abort(); }
    };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => { settled = true; reject(storageError('open', upgradeError ?? request.error)); };
    request.onblocked = () => { settled = true; reject(new Error('Local project storage is blocked by another tab. Close other Clothing Studio tabs and try again.')); };
  });
}

const TRANSACTION_DEADLINE_MS = 10_000;

async function transact<T>(mode: IDBTransactionMode, action: string,
  request: (store: IDBObjectStore, fail: (error: Error) => void) => () => T): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    try { transaction = database.transaction(STORE_NAME, mode); }
    catch { database.close(); reject(storageError(action)); return; }
    let failure: Error | null = null;
    let readResult: (() => T) | undefined;
    // This timer belongs to this native transaction, including time queued
    // behind another connection. Only a native terminal event releases callers.
    const timer = setTimeout(() => {
      const timeout = new Error(`Local project storage timed out after 10 seconds. Keep your current concept open and export a project backup, then retry.`);
      try { transaction.abort(); failure ??= timeout; }
      catch {
        // Native commit/abort may already have won while its callback is delayed.
        // Await that event rather than falsely reporting a committed write lost.
      }
    }, TRANSACTION_DEADLINE_MS);
    const finish = () => { clearTimeout(timer); database.close(); };
    transaction.oncomplete = () => {
      finish();
      if (failure) { reject(failure); return; }
      try { resolve(readResult!()); } catch { reject(storageError(action)); }
    };
    transaction.onabort = () => { finish(); reject(failure ?? storageError(action, transaction.error)); };
    transaction.onerror = () => {
      // An error event precedes rollback. Keep the autosave queue waiting for it.
      failure ??= storageError(action, transaction.error);
    };
    const fail = (error: Error) => { failure = error; try { transaction.abort(); } catch { /* Wait for the native terminal event. */ } };
    try { readResult = request(transaction.objectStore(STORE_NAME),fail); }
    catch {
      failure = storageError(action);
      try { transaction.abort(); } catch { /* Await the actual native terminal outcome. */ }
    }
  });
}

export async function loadProject(): Promise<Project | null> {
  const record = await transact('readonly', 'read', store => {
    const value = store.get(PROJECT_KEY), presence = store.count(PROJECT_KEY), revision = store.get(REVISION_KEY);
    return () => ({ value: value.result as unknown, count: presence.result, revision: revisionValue(revision.result) });
  });
  observedRevision = record.revision;
  if (record.count === 0) return null;
  const project = validateProject(record.value);
  await validateProjectImages(project);
  return project;
}

function revisionValue(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value)) throw storageError('read the revision of');
  return value;
}
/** Capture before a replacement prompt; this does not adopt another tab's save. */
export async function savedProjectRevision(): Promise<string | null> {
  return transact('readonly','read',store=>{const request=store.get(REVISION_KEY);return()=>revisionValue(request.result);});
}
async function initialRevision(): Promise<string | null> {
  if (observedRevision !== undefined) return observedRevision;
  const state=await transact('readonly','read',store=>{const revision=store.get(REVISION_KEY),presence=store.count(PROJECT_KEY);return()=>({revision:revisionValue(revision.result),count:presence.result});});
  if (state.count) throw new ProjectConflictError();
  observedRevision=state.revision;return state.revision;
}
async function write(expected: string | null, project?: Project): Promise<void> {
  // getRandomValues also works where randomUUID requires a secure context.
  const next=revisionToken();
  await transact('readwrite','save',(store,fail)=>{
    const revision=store.get(REVISION_KEY);
    revision.onsuccess=()=>{try{
      if(revisionValue(revision.result)!==expected){fail(new ProjectConflictError());return;}
      if(project)store.put(project,PROJECT_KEY);else store.delete(PROJECT_KEY);
      store.put(next,REVISION_KEY);
    }catch(error){fail(error instanceof Error?error:storageError('save'));}};
    return()=>undefined;
  });
  // Only the native commit grants ownership of this new revision.
  observedRevision=next;
}
function revisionToken(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]!&15)|64; bytes[8]=(bytes[8]!&63)|128;
  const hex=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export async function saveProject(project: Project, expected?: string | null): Promise<void> {
  const revision=expected===undefined?await initialRevision():expected;
  const safe = validateProject(project);
  await validateProjectImages(safe);
  await write(revision,safe);
}

export async function clearProject(): Promise<void> {
  await write(await initialRevision());
}
