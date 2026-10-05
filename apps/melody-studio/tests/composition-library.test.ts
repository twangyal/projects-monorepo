import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeProjectBackup } from '../src/reference-backup.ts';
import { ReferenceHistory } from '../src/reference-project.ts';
import type { ReferenceBundle } from '../src/reference-types.ts';

import { CompositionLibrary } from '../src/composition-library.ts';
const library = async (factory: IDBFactory) => new CompositionLibrary(factory);
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
function bundle(n = 1, frames = 10): ReferenceBundle {
  return { document: { schemaVersion: 1, composition: { version: 1, title: 'A\0\ud800 take', tempo: 120,
    tracks: [{ id: 'track-1', name: 'Lead', instrument: 'sine', volume: 0.8, muted: false,
      notes: [{ id: 'note-1', pitch: 60, start: 0, duration: 1, velocity: 0.8 }] }] },
    references: [{ trackId: 'track-1', assetId: uuid(n) }] }, assets: [{ id: uuid(n), kind: 'audio-file', captureTempo: 108,
    decodedSampleRate: 22050, decodedChannels: 1, decodedFrames: frames, analyzedFrames: frames, frameCount: frames,
    pcm: new Uint8Array(frames * 2).fill(n % 256) }] };
}

/** Native scheduling stand-in for Node (which has no IDBFactory). Real-browser
 * serialization and rollback are independently exercised by the native oracle. */
function database() {
  const rows = new Map<string, Record<string, unknown>>();
  const metrics = { opens: 0, transactions: 0, aborts: 0, closes: 0, reads: [] as number[] };
  let holdOpen = false, holdTerminal = false, failWrite = false;
  const opens: (() => void)[] = [], terminals: (() => void)[] = [], jobs: (() => void)[] = [];
  let busy = false;
  const pump = () => { if (!busy && jobs.length) { busy = true; queueMicrotask(jobs.shift()!); } };
  const factory = { open(name: string, version: number) {
    assert.equal(name, 'melody-studio.library'); assert.equal(version, 1); metrics.opens++;
    const db = { version: 1, objectStoreNames: { length: 1, contains: (name: string) => name === 'copies' },
      close() { metrics.closes++; }, onversionchange: null,
      transaction(names: string | string[], mode: string) {
        assert.deepEqual(typeof names === 'string' ? [names] : names, ['copies']); metrics.transactions++;
        let local = new Map<string, Record<string, unknown>>(), pending = 0, aborted = false, started = false, terminal = false;
        const operations: (() => void)[] = [];
        const finish = () => {
          if (!started || pending || terminal) return; terminal = true;
          const done = () => {
            if (aborted) tx.onabort?.();
            else { if (mode === 'readwrite') { rows.clear(); for (const [key, row] of local) rows.set(key, row); } tx.oncomplete?.(); }
            busy = false; pump();
          };
          if (holdTerminal) terminals.push(done); else queueMicrotask(done);
        };
        const request = (action: () => unknown) => {
          const req = { result: undefined as unknown, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
          pending++;
          const run = () => {
            if (!aborted) { req.result = action(); req.onsuccess?.(); }
            pending--; finish();
          };
          if (started) queueMicrotask(run); else operations.push(run);
          return req;
        };
        const tx = { oncomplete: null as (() => void) | null, onabort: null as (() => void) | null,
          onerror: null as (() => void) | null,
          abort() { metrics.aborts++; aborted = true; finish(); },
          objectStore(name: string) {
            assert.equal(name, 'copies');
            return { keyPath: 'id', getAll(_query: unknown, count: number) {
              metrics.reads.push(count); return request(() => [...local.values()].slice(0, count).map(row => structuredClone(row)));
            }, get(id: string) { return request(() => structuredClone(local.get(id))); },
            put(row: Record<string, unknown>) { return request(() => {
              if (failWrite) { aborted = true; tx.onerror?.(); return undefined; }
              local.set(row.id as string, structuredClone(row)); return row.id;
            }); }, delete(id: string) { return request(() => { local.delete(id); }); } };
          } };
        jobs.push(() => { started = true; local = new Map([...rows].map(([key, row]) => [key, structuredClone(row)]));
          for (const run of operations) queueMicrotask(run); finish(); }); pump(); return tx;
      } };
    const request = { result: db, onsuccess: null as (() => void) | null, onerror: null,
      onupgradeneeded: null, onblocked: null };
    const success = () => request.onsuccess?.();
    if (holdOpen) opens.push(success); else queueMicrotask(success);
    return request;
  } } as unknown as IDBFactory;
  return { factory, rows, metrics, setHoldOpen(value: boolean) { holdOpen = value; },
    releaseOpen() { holdOpen = false; for (const open of opens.splice(0)) open(); },
    setHoldTerminal(value: boolean) { holdTerminal = value; },
    releaseTerminal() { holdTerminal = false; for (const done of terminals.splice(0)) done(); },
    failWrites(value: boolean) { failWrite = value; } };
}
const turns = async (n = 16) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

test('create preserves exact canonical backup and separate trimmed label with immutable authority', async () => {
  const db = database(), store = await library(db.factory), input = bundle();
  const original = structuredClone(input), bytes = await encodeProjectBackup(original);
  const saving = store.create('  First take  ', input); input.assets[0].pcm.fill(99); input.document.composition.title = 'Changed later';
  const entry = await saving; assert.equal(entry.label, 'First take'); assert.equal(entry.title, original.document.composition.title);
  assert.match(entry.id, /^[a-f0-9-]{36}$/); assert.notEqual(entry.id, entry.revision);
  assert.ok(Object.isFrozen(entry)); assert.ok(Object.isFrozen(entry.receipt)); assert.deepEqual(Object.keys(entry.receipt), []);
  const entries = await store.list(); assert.ok(Object.isFrozen(entries)); assert.ok(Object.isFrozen(entries[0]));
  const review = await store.review(entry.receipt); assert.ok(Object.isFrozen(review)); assert.equal(review.error, null);
  assert.deepEqual(new Uint8Array(await review.backup.arrayBuffer()), bytes); assert.deepEqual(review.bundle, original);
  review.bundle!.assets[0].pcm.fill(98); review.bundle!.document.composition.title = 'Returned mutation';
  assert.deepEqual((await store.review(entry.receipt)).bundle, original); await store.close();
});

test('labels and invalid bundles refuse before any native open; duplicate labels remain distinct', async () => {
  const db = database(), store = await library(db.factory);
  for (const label of ['', '   ', 'a'.repeat(81), '\ud800', '\udfff', 'a\0b', 'a\u0085b', 'a\u2028b', 'a\u2029b']) {
    await assert.rejects(store.create(label, bundle()), /label/i);
  }
  const malformed = bundle(); malformed.assets = []; await assert.rejects(store.create('Valid', malformed)); assert.equal(db.metrics.opens, 0);
  const first = await store.create('Same', bundle()), second = await store.create('Same', bundle(2)); assert.notEqual(first.id, second.id);
  const edge = await store.create('😀'.repeat(40), bundle(3)); assert.equal(edge.label.length, 80); await store.close();
});

test('forged, cloned and wrong-instance receipts refuse without opening native storage', async () => {
  const db = database(), store = await library(db.factory), other = await library(db.factory), entry = await store.create('Take', bundle());
  const opens = db.metrics.opens;
  for (const receipt of [{} as typeof entry.receipt, structuredClone(entry.receipt)]) {
    await assert.rejects(store.review(receipt), /refresh|receipt|changed/i);
    await assert.rejects(store.update(receipt, 'Replace', bundle()), /refresh|receipt|changed/i);
    await assert.rejects(store.remove(receipt), /refresh|receipt|changed/i);
  }
  await assert.rejects(other.remove(entry.receipt), /refresh|receipt|changed/i); assert.equal(db.metrics.opens, opens);
  await store.close(); await other.close();
});

test('two instances creating the last slot yield eight complete copies and one refusal', async () => {
  const db = database(), first = await library(db.factory), second = await library(db.factory);
  for (let n = 1; n <= 7; n++) await first.create(`Take ${n}`, bundle(n));
  const outcomes = await Promise.allSettled([first.create('Last A', bundle(8)), second.create('Last B', bundle(9))]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1); assert.equal(outcomes.filter(o => o.status === 'rejected').length, 1);
  assert.equal((await first.list()).length, 8); assert.equal(db.rows.size, 8); await first.close(); await second.close();
});

test('independent updates survive; stale same-entry authority and deleted entries cannot resurrect', async () => {
  const db = database(), first = await library(db.factory), second = await library(db.factory);
  const a = await first.create('A', bundle()), b = await first.create('B', bundle(2));
  const staleA = (await second.list()).find(e => e.id === a.id)!;
  const [nextA, nextB] = await Promise.all([first.update(a.receipt, 'A2', bundle(3)), first.update(b.receipt, 'B2', bundle(4))]);
  assert.notEqual(nextA.revision, a.revision); assert.notEqual(nextB.revision, b.revision);
  assert.deepEqual((await second.list()).map(e => e.label).sort(), ['A2', 'B2']);
  await assert.rejects(second.remove(staleA.receipt), /changed|refresh/i); await assert.rejects(second.update(staleA.receipt, 'Stale', bundle()), /changed|refresh/i);
  await first.remove(nextA.receipt); await assert.rejects(first.update(nextA.receipt, 'Resurrect', bundle()), /changed|refresh/i);
  assert.equal(db.rows.has(a.id), false); await first.close(); await second.close();
});

test('failed native put rolls back exact bytes and consumes destructive authority', async () => {
  const db = database(), store = await library(db.factory), a = await store.create('A', bundle());
  const sibling = (await store.list())[0];
  const before = new Uint8Array(await (db.rows.get(a.id)!.backup as Blob).arrayBuffer()); db.failWrites(true);
  await assert.rejects(store.update(a.receipt, 'B', bundle(2))); db.failWrites(false);
  assert.deepEqual(new Uint8Array(await (db.rows.get(a.id)!.backup as Blob).arrayBuffer()), before);
  await assert.rejects(store.remove(a.receipt), /changed|refresh/i);
  await assert.rejects(store.remove(sibling.receipt), /changed|refresh/i); const fresh = (await store.list())[0]; await store.remove(fresh.receipt);
  assert.equal(db.rows.size, 0); await store.close();
});

test('metadata changes invalidate revision CAS even when revision is dishonestly retained', async () => {
  const db = database(), store = await library(db.factory), a = await store.create('A', bundle());
  db.rows.get(a.id)!.label = 'Another label'; await assert.rejects(store.update(a.receipt, 'B', bundle(2)), /changed|refresh/i);
  assert.equal(db.rows.get(a.id)!.label, 'Another label'); await store.close();
});

test('listing reads bounded metadata only and malformed catalog protects every write', async () => {
  const db = database(), store = await library(db.factory), a = await store.create('A', bundle());
  let contentReads = 0; const original = Blob.prototype.arrayBuffer;
  Blob.prototype.arrayBuffer = function () { contentReads++; return original.call(this); };
  try { const entries = await store.list(); assert.equal(entries.length, 1); assert.equal(contentReads, 0); assert.equal(db.metrics.reads.at(-1), 9); }
  finally { Blob.prototype.arrayBuffer = original; }
  db.rows.set(uuid(999), { schemaVersion: 1, id: uuid(999), backup: new Blob(['PRIVATE']) });
  await assert.rejects(store.list()); await assert.rejects(store.create('B', bundle(2))); await assert.rejects(store.remove(a.receipt));
  assert.equal(db.rows.size, 2); await store.close();
});

test('same-size corrupt bytes retain exact bounded download but refuse an Open bundle', async () => {
  const db = database(), store = await library(db.factory), a = await store.create('A', bundle());
  const row = db.rows.get(a.id)!, bytes = new Uint8Array(await (row.backup as Blob).arrayBuffer());
  // Keep the plausible complete-project header while corrupting a later byte.
  bytes[bytes.length - 5] ^= 1; row.backup = new Blob([bytes], { type: 'application/json' });
  const reviewed = await store.review(a.receipt); assert.equal(reviewed.bundle, null); assert.ok(reviewed.error);
  assert.doesNotMatch(reviewed.error!, /PRIVATE|SyntaxError|Unexpected token/); assert.deepEqual(new Uint8Array(await reviewed.backup.arrayBuffer()), bytes);
  await store.remove(a.receipt); assert.equal(db.rows.size, 0); await store.close();
});

test('selected decoding rechecks the saved identity before delivering a bundle', async () => {
  const db = database(), store = await library(db.factory), a = await store.create('A', bundle());
  const original = Blob.prototype.arrayBuffer; let changed = false;
  Blob.prototype.arrayBuffer = async function () { const bytes = await original.call(this);
    if (!changed) { changed = true; db.rows.get(a.id)!.revision = uuid(999); } return bytes; };
  try { await assert.rejects(store.review(a.receipt), /changed|refresh/i); }
  finally { Blob.prototype.arrayBuffer = original; } await store.close();
});

test('timeout keeps blocked native open owned and close waits for its late drain', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const db = database(), store = await library(db.factory); db.setHoldOpen(true);
  const first = store.list(), rejected = assert.rejects(first, /time|10 seconds/i); await turns(); context.mock.timers.tick(10000); await rejected;
  assert.equal(store.nativePending, true); const controller = new AbortController(); const second = store.list({ signal: controller.signal });
  const secondRejected = assert.rejects(second, /cancel|abort/i); await turns(); assert.equal(db.metrics.opens, 1); controller.abort(); await secondRejected;
  let closed = false; const closing = store.close().then(() => { closed = true; }); await turns(); assert.equal(closed, false);
  db.releaseOpen(); await closing; assert.equal(store.nativePending, false); assert.equal(db.metrics.closes, 1);
  await assert.rejects(store.list(), /clos/i); assert.equal(db.metrics.opens, 1);
});

test('canceling held native transaction retires logical work but blocks a later write until terminal', async () => {
  const db = database(), store = await library(db.factory); await store.create('Initial', bundle());
  db.setHoldTerminal(true); const controller = new AbortController(); const reading = store.list({ signal: controller.signal });
  const rejected = assert.rejects(reading, /cancel|abort/i); await turns(); assert.equal(store.nativePending, true); controller.abort(); await rejected;
  const later = store.list(); await turns(); const opens = db.metrics.opens; assert.equal(opens, 2);
  db.releaseTerminal(); await later; assert.equal(store.nativePending, false); await store.close();
});

test('cancel after put never reports success before native transaction completion', async () => {
  const db = database(), store = await library(db.factory), a = await store.create('A', bundle());
  const changed = bundle(2); db.setHoldTerminal(true); const controller = new AbortController();
  const writing = store.update(a.receipt, 'B', changed, { signal: controller.signal }); const rejected = assert.rejects(writing, /cancel|abort/i);
  // Wait for actual crypto preparation, not an arbitrary microtask count.
  while (db.metrics.transactions < 2) await new Promise<void>(resolve => setImmediate(resolve));
  await turns(); controller.abort(); await rejected; assert.equal(store.nativePending, true);
  db.releaseTerminal(); await store.close(); assert.equal(db.rows.get(a.id)!.label, 'A');
});

test('reviewed audio still meets unchanged history collision and 64 MiB admission contracts', async () => {
  const db = database(), store = await library(db.factory), initial = bundle(), history = new ReferenceHistory(initial);
  const collision = bundle(); collision.assets[0].pcm[0] = 19; const a = await store.create('Collision', collision), reviewed = await store.review(a.receipt);
  const before = history.snapshot(); assert.throws(() => history.commit(reviewed.bundle!.document, reviewed.bundle!.assets), /conflict/i);
  assert.deepEqual(history.snapshot(), before); assert.equal(history.canUndo, false);
  // Seventy-seven distinct assets exactly consume the established audio budget.
  const full = new ReferenceHistory(bundle(100, 441000));
  for (let n = 101; n <= 175; n++) {
    // Keep eight assets reachable per state while remaining below history's 51 states.
    if (n % 2 !== 0) continue;
    const pair = [bundle(n - 1, 441000), bundle(n, 441000)];
    const next = pair[0]; const secondTrack = structuredClone(next.document.composition.tracks[0]);
    secondTrack.id = 'track-2'; secondTrack.notes[0].id = 'note-2'; next.document.composition.tracks.push(secondTrack);
    next.document.references.push({ trackId: 'track-2', assetId: pair[1].assets[0].id }); next.assets.push(pair[1].assets[0]); full.commit(next.document, next.assets);
  }
  const seventySixth = bundle(175, 441000); full.commit(seventySixth.document, seventySixth.assets);
  const remainingFrames = (64 * 1024 * 1024 - full.assetBytes) / 2;
  const final = bundle(176, remainingFrames); full.commit(final.document, final.assets); assert.equal(full.assetBytes, 64 * 1024 * 1024);
  const tiny = bundle(177, 1), saved = await store.create('One more frame', tiny), ready = (await store.review(saved.receipt)).bundle!;
  const retained = full.snapshot(); assert.throws(() => full.commit(ready.document, ready.assets), /64 MiB/i); assert.deepEqual(full.snapshot(), retained);
  await store.close();
});
