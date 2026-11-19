import test from 'node:test';
import assert from 'node:assert/strict';
import { TRIAL_KEY, startTrial } from '../src/web/trial-tasks.js';
import { LOG_SETTINGS } from '../src/web/session-log.js';
import { createTrialStore } from '../src/web/trial-store.js';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(initial = startTrial(['One', 'Two'], 1000)) {
  const data = { [TRIAL_KEY]: initial, [LOG_SETTINGS]: { on: false, words: true }, 'unrelated': 42 };
  let gate = null, ids = 0;
  const storage = {
    async get(key) { return structuredClone(key == null ? data : typeof key === 'string' ? { [key]: data[key] } : Object.fromEntries(key.map(k => [k, data[k]]))); },
    async set(items) { if (gate) { const waiting = gate; gate = null; await waiting.promise; } Object.assign(data, structuredClone(items)); },
    async remove(keys) { for (const key of keys) delete data[key]; },
  };
  assert.equal(typeof createTrialStore, 'function', 'ordered durable trial storage is available');
  return { data, run: createTrialStore({ storage, now: () => 2000, id: () => `trial-${++ids}` }), delay() { return gate = deferred(); } };
}

test('a task result is acknowledged only after storage succeeds; duplicate requests advance once', async () => {
  const f = fixture(), expected = structuredClone(f.data[TRIAL_KEY]), gate = f.delay();
  let answered = false;
  const first = f.run({ op: 'finish', expected, outcome: 'done' }).then(result => { answered = true; return result; });
  const duplicate = f.run({ op: 'finish', expected, outcome: 'skipped' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(answered, false); assert.equal(f.data[TRIAL_KEY].current, 0);
  gate.resolve();
  assert.equal((await first).finished.number, 1);
  const stale = await duplicate;
  assert.equal(stale.ok, false); assert.equal(stale.trial.current, 1);
  assert.equal(f.data[TRIAL_KEY].results.length, 1);
});

test('a failed save preserves the task and does not poison the queue', async () => {
  const f = fixture(), expected = structuredClone(f.data[TRIAL_KEY]), gate = f.delay();
  const failed = f.run({ op: 'finish', expected, outcome: 'done' });
  gate.reject(new Error('disk unavailable'));
  await assert.rejects(failed, /disk unavailable/);
  assert.deepEqual(f.data[TRIAL_KEY], expected);
  assert.equal((await f.run({ op: 'finish', expected, outcome: 'done' })).ok, true);
});

test('end, clear and a replacement trial cannot be overwritten by a stale completion', async () => {
  const f = fixture(), expected = structuredClone(f.data[TRIAL_KEY]);
  const ended = await f.run({ op: 'end', expected });
  assert.equal(ended.trial.endedAt, 2000);
  assert.equal((await f.run({ op: 'finish', expected, outcome: 'done' })).ok, false);
  const restarted = await f.run({ op: 'start', expected: ended.trial, tasks: ['Replacement'] });
  assert.equal(restarted.ok, true); assert.equal(restarted.trial.tasks[0], 'Replacement');
  assert.equal(f.data[LOG_SETTINGS].on, true); assert.equal(f.data[LOG_SETTINGS].words, true);
  assert.equal((await f.run({ op: 'finish', expected, outcome: 'done' })).ok, false);
  const old = restarted.trial;
  assert.equal((await f.run({ op: 'clear', expected: old })).ok, true);
  assert.equal(TRIAL_KEY in f.data, false); assert.equal(f.data.unrelated, 42);
  assert.equal((await f.run({ op: 'finish', expected: old, outcome: 'done' })).ok, false);
  const second = await f.run({ op: 'start', expected: null, tasks: ['Replacement'] });
  assert.notEqual(second.trial.id, old.id, 'same clock and same tasks still identify a fresh trial');
  assert.equal((await f.run({ op: 'finish', expected: old, outcome: 'done' })).ok, false);
});

test('mutations read durable state again after a service-worker restart and reject invalid requests', async () => {
  const f = fixture(), expected = structuredClone(f.data[TRIAL_KEY]);
  await f.run({ op: 'finish', expected, outcome: 'done' });
  const next = fixture(f.data[TRIAL_KEY]);
  assert.equal((await next.run({ op: 'finish', expected, outcome: 'done' })).ok, false);
  assert.equal((await next.run({ op: 'finish', expected: next.data[TRIAL_KEY], outcome: 'maybe' })).ok, false);
  assert.equal((await next.run({ op: 'start', expected: next.data[TRIAL_KEY], tasks: ['Other'] })).ok, false, 'an open trial cannot be replaced');
});

test('a queued end cannot roll back a finishing task, and stale clearing cannot delete a new trial', async () => {
  const f = fixture(), expected = structuredClone(f.data[TRIAL_KEY]), gate = f.delay();
  const finishing = f.run({ op: 'finish', expected, outcome: 'done' });
  const ending = f.run({ op: 'end', expected });
  gate.resolve();
  const finished = await finishing;
  assert.equal((await ending).ok, false);
  assert.equal(f.data[TRIAL_KEY].results.length, 1);
  const ended = await f.run({ op: 'end', expected: finished.trial });
  const fresh = await f.run({ op: 'start', expected: ended.trial, tasks: ['New'] });
  assert.equal((await f.run({ op: 'clear', expected: ended.trial })).ok, false);
  assert.deepEqual(f.data[TRIAL_KEY], fresh.trial);
});

test('starting with logging already on does not rewrite consent to keep spoken words', async () => {
  let writes;
  const trial = startTrial(['Old'], 1000); trial.endedAt = 1500;
  const storage = {
    get: async key => ({ [key]: key === TRIAL_KEY ? trial : { on: true, words: true } }),
    set: async items => { writes = items; },
  };
  const run = createTrialStore({ storage });
  await run({ op: 'start', expected: trial, tasks: ['New'] });
  assert.equal(LOG_SETTINGS in writes, false, 'starting while logging is on never rewrites transcript consent');
});

test('logging changes and trial start share the queue and preserve the latest choices', async () => {
  const f = fixture(null), gate = f.delay();
  f.data[LOG_SETTINGS] = { on: false, words: true };
  const starting = f.run({ op: 'start', expected: null, tasks: ['New'] });
  const optingOut = f.run({ op: 'logging', key: 'words', value: false });
  gate.resolve();
  assert.equal((await starting).ok, true);
  assert.equal((await optingOut).ok, true);
  assert.deepEqual(f.data[LOG_SETTINGS], { on: true, words: false });
  assert.equal((await f.run({ op: 'logging', key: 'on', value: false })).ok, true);
  assert.deepEqual(f.data[LOG_SETTINGS], { on: false, words: false });
  assert.equal((await f.run({ op: 'logging', key: 'words', value: 'true' })).ok, false);
});
