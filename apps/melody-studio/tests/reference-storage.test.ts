import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReferenceStorage, SavedCopyConflict, type SavedCopyReceipt, REFERENCE_DB_NAME, REFERENCE_DB_VERSION } from '../src/reference-storage.ts';
import { notesOnly } from '../src/reference-project.ts';
import { createComposition } from '../src/model.ts';

function failedFactory() {
  let opens = 0;
  const factory = { open(name: string, version: number) {
    assert.equal(name, REFERENCE_DB_NAME); assert.equal(version, REFERENCE_DB_VERSION); opens++;
    const request = { onerror: null as (() => void) | null, error: new Error('PRIVATE DATABASE PATH') };
    queueMicrotask(() => request.onerror?.());
    return request;
  } } as unknown as IDBFactory;
  return { factory, opens: () => opens };
}

test('failed read never reports proven absence and queue recovers', async () => {
  const fake = failedFactory(); const store = new ReferenceStorage(fake.factory);
  for (let i = 0; i < 2; i++) await assert.rejects(store.load(), error => {
    assert.ok(error instanceof Error); assert.doesNotMatch(error.message, /PRIVATE/); return true;
  });
  assert.equal(fake.opens(), 2); store.close();
});

test('closed instance rejects without opening another database', async () => {
  const fake = failedFactory(); const store = new ReferenceStorage(fake.factory);
  store.close(); store.close(); await assert.rejects(store.load(), /clos/i);
  assert.equal(fake.opens(), 0);
});

test('close cancels an outstanding open and closes its late successful connection', async () => {
  let request: { onsuccess?: () => void; onerror?: () => void; result?: IDBDatabase } | undefined;
  let closes = 0;
  const factory = { open() { request = {}; return request; } } as unknown as IDBFactory;
  const store = new ReferenceStorage(factory);
  const pending = store.load();
  await Promise.resolve(); store.close();
  await assert.rejects(pending, /clos/i);
  assert.ok(request);
  request.result = { close() { closes++; } } as unknown as IDBDatabase;
  request.onsuccess?.(); assert.equal(closes, 1);
});

test('open timeout is bounded and a late connection is not retained', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let request: { onsuccess?: () => void; result?: IDBDatabase } | undefined;
  let closes = 0;
  const factory = { open() { request = {}; return request; } } as unknown as IDBFactory;
  const store = new ReferenceStorage(factory); const pending = store.load();
  const rejected = assert.rejects(pending, /time|10 second/i);
  await Promise.resolve(); context.mock.timers.tick(10000); await rejected;
  assert.ok(request); request.result = { close() { closes++; } } as unknown as IDBDatabase;
  request.onsuccess?.(); assert.equal(closes, 1); store.close();
});

function connectedFactory() {
  let closes = 0, aborts = 0;
  const tx = { abort() { aborts++; }, objectStore() { return { get() { return {}; }, getKey() { return {}; }, getAll() { return {}; }, getAllKeys() { return {}; } }; } };
  const db = { version: 1, objectStoreNames: { length: 2, contains: () => true },
    close() { closes++; }, transaction() { return tx; }, onversionchange: null as (() => void) | null };
  const factory = { open() {
    const request = { result: db, onsuccess: null as (() => void) | null };
    queueMicrotask(() => request.onsuccess?.()); return request;
  } } as unknown as IDBFactory;
  return { factory, db, closes: () => closes, aborts: () => aborts };
}

test('close immediately releases an opened database and aborts its pending read', async () => {
  const fake = connectedFactory(); const store = new ReferenceStorage(fake.factory);
  const pending = store.load(); const rejected = assert.rejects(pending, /clos/i);
  for (let i = 0; i < 4; i++) await Promise.resolve();
  store.close();
  assert.equal(fake.closes(), 1); assert.equal(fake.aborts(), 1);
  await rejected;
});

test('a queued versionchange from an already released database cannot cancel a newer read', async () => {
  const first = connectedFactory(), second = connectedFactory(); let opens = 0;
  const factory = { open(name: string, version: number) { return (++opens === 1 ? first : second).factory.open(name, version); } } as unknown as IDBFactory;
  const store = new ReferenceStorage(factory);
  const oldRead = store.load(); const oldRejected = assert.rejects(oldRead, /another tab|changed/i);
  for (let i = 0; i < 4; i++) await Promise.resolve();
  first.db.onversionchange?.(); await oldRejected;
  const newRead = store.load(); const newRejected = assert.rejects(newRead, /clos/i);
  for (let i = 0; i < 4; i++) await Promise.resolve();
  first.db.onversionchange?.();
  assert.equal(second.closes(), 0); assert.equal(second.aborts(), 0);
  store.close(); await newRejected;
});

test('ordinary writes require accepted saved-copy authority before opening or clearing assets', async () => {
  const fake = failedFactory(), store = new ReferenceStorage(fake.factory);
  const bundle = { document: notesOnly(createComposition()), assets: [] };
  await assert.rejects(store.save(bundle), SavedCopyConflict);
  assert.equal(fake.opens(), 0);
  await assert.rejects(store.load());
  await assert.rejects(store.save(bundle), SavedCopyConflict);
  assert.equal(fake.opens(), 1);
  store.close();
});

test('forged load and replacement receipts never establish write authority', async () => {
  const fake = failedFactory(), store = new ReferenceStorage(fake.factory);
  const bundle = { document: notesOnly(createComposition()), assets: [] };
  const forged = Object.freeze({}) as SavedCopyReceipt;
  assert.throws(() => store.acceptLoad(forged), SavedCopyConflict);
  await assert.rejects(store.replace(bundle, forged), SavedCopyConflict);
  await assert.rejects(store.save(bundle), SavedCopyConflict);
  assert.equal(fake.opens(), 0);
  store.close();assert.throws(() => store.acceptLoad(forged), /clos/i);
});

test('failed replacement review cannot mint authority and leaves the queue usable', async () => {
  const fake = failedFactory(), store = new ReferenceStorage(fake.factory);
  for (let i = 0; i < 2; i++) await assert.rejects(store.reviewReplacement(), error => {
    assert.ok(error instanceof Error);assert.doesNotMatch(error.message, /PRIVATE/);return true;
  });
  assert.equal(fake.opens(), 2);store.close();
});
