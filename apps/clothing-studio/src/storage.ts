import { validateProject, type Project } from './model.ts';
import { validatePhoto } from './media.ts';

const DATABASE_NAME = 'clothing-studio';
const STORE_NAME = 'project';
const PROJECT_KEY = 'current';

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
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => { settled = true; reject(storageError('open', request.error)); };
    request.onblocked = () => { settled = true; reject(new Error('Local project storage is blocked by another tab. Close other Clothing Studio tabs and try again.')); };
  });
}

function complete(transaction: IDBTransaction, action: string): Promise<void> {
  const result = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(storageError(action, transaction.error));
    transaction.onerror = () => reject(storageError(action, transaction.error));
  });
  // A synchronous object-store operation can throw before its caller awaits us.
  // Preserve rejection for that caller without leaving an orphaned transaction.
  void result.catch(() => {});
  return result;
}

export async function loadProject(): Promise<Project | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const completed = complete(transaction, 'read');
    const request = transaction.objectStore(STORE_NAME).get(PROJECT_KEY);
    const requested = new Promise<unknown>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(storageError('read', request.error));
    });
    const [value] = await Promise.all([requested, completed]);
    if (value === undefined) return null;
    const project = validateProject(value);
    await validatePhoto(project.photo);
    return project;
  } finally { database.close(); }
}

export async function saveProject(project: Project): Promise<void> {
  const safe = validateProject(project);
  await validatePhoto(safe.photo);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const completed = complete(transaction, 'save');
    transaction.objectStore(STORE_NAME).put(safe, PROJECT_KEY);
    await completed;
  } finally { database.close(); }
}

export async function clearProject(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const completed = complete(transaction, 'clear');
    transaction.objectStore(STORE_NAME).delete(PROJECT_KEY);
    await completed;
  } finally { database.close(); }
}
