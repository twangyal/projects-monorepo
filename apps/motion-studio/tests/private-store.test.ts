import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, readdir, rm, stat, symlink, open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SnapshotStore } from '../server/snapshot-store.ts';
import { createProject, validateProject } from '../src/model.ts';
import { MotionError } from '../server/types.ts';

const admitted = (title = 'Original held copper') => {
  const original = createProject(); original.title = title;
  const project = validateProject(original);
  const json = new TextEncoder().encode(JSON.stringify(project));
  return { project, json, sha256: createHash('sha256').update(json).digest('hex') };
};
async function directory(t: { after: (fn: () => Promise<void>) => void }) {
  const parent = await mkdtemp(join(tmpdir(), 'motion110-store-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  return join(parent, 'library');
}

test('empty library uses owned regular permission-bounded files and inspect exposes no authority', async t => {
  const path = await directory(t);
  const store = await SnapshotStore.open(path);
  try {
    assert.deepEqual(await store.inspect(), []);
    assert.equal((await stat(path)).mode & 0o7777, 0o700);
    assert.equal((await stat(join(path, '.server.lock'))).mode & 0o7777, 0o600);
  } finally { await store.close(); }
});

test('publication returns only once, retains exact bytes and independent read/revoke authority across restart', async t => {
  const path = await directory(t);
  let store = await SnapshotStore.open(path);
  t.after(() => store.close());
  const source = admitted();
  const created = await store.publish(source);
  assert.notEqual(created.readToken, created.revokeToken);
  assert.equal(created.projectSha256, source.sha256);
  assert.equal(created.projectBytes, source.json.byteLength);
  const read = await store.read(created.id, created.readToken);
  assert.deepEqual(read.publication, { id: created.id, createdAt: created.createdAt,
    projectSha256: created.projectSha256, projectBytes: created.projectBytes });
  assert.deepEqual(new Uint8Array(await read.file.readFile()), source.json);
  await read.file.close();
  for (const bad of [created.revokeToken, 'a'.repeat(64), 'bad']) {
    await assert.rejects(store.read(created.id, bad), (error: unknown) => error instanceof MotionError && error.code === 'not-found');
  }
  await assert.rejects(store.revoke(created.id, created.readToken), (error: unknown) => error instanceof MotionError && error.code === 'not-found');
  const raw = await readFile(join(path, 'index.json'), 'utf8');
  assert.ok(!raw.includes(created.readToken) && !raw.includes(created.revokeToken));
  await store.close();
  store = await SnapshotStore.open(path);
  try {
    const restored = await store.read(created.id, created.readToken);
    await restored.file.close();
    await store.revoke(created.id, created.revokeToken);
    assert.deepEqual(await store.inspect(), []);
    await assert.rejects(store.read(created.id, created.readToken));
    assert.ok(!(await readdir(path)).includes(`${created.id}.motion.json`));
  } finally { await store.close(); }
  store = await SnapshotStore.open(path);
  try { assert.deepEqual(await store.inspect(), []); } finally { await store.close(); }
});

test('eight immutable publications are retained and ninth refuses without eviction', async t => {
  const path = await directory(t);
  const store = await SnapshotStore.open(path);
  try {
    const results = [];
    for (let i = 0; i < 8; i++) results.push(await store.publish(admitted(`Original ${i}`)));
    await assert.rejects(store.publish(admitted('Ninth')), (error: unknown) => error instanceof MotionError && error.code === 'capacity');
    assert.deepEqual((await store.inspect()).map(item => item.title), Array.from({ length: 8 }, (_, i) => `Original ${i}`));
    for (const result of results) { const read = await store.read(result.id, result.readToken); await read.file.close(); }
  } finally { await store.close(); }
});

test('pre-aborted publication and mismatched canonical bytes never create visible payloads', async t => {
  const path = await directory(t);
  const store = await SnapshotStore.open(path);
  try {
    await assert.rejects(store.publish(admitted(), { signal: AbortSignal.abort() }), (error: unknown) => error instanceof MotionError && error.code === 'cancelled');
    await assert.rejects(store.publish({ ...admitted(), sha256: '0'.repeat(64) }));
    assert.deepEqual(await store.inspect(), []);
    assert.deepEqual((await readdir(path)).filter(name => name.endsWith('.motion.json')), []);
  } finally { await store.close(); }
});

test('unknown files and malformed index refuse startup without repair or source changes', async t => {
  const path = await directory(t);
  const store = await SnapshotStore.open(path); await store.close();
  const bad = '{"schemaVersion":1,"revision":0,"publications":[],"extra":true}';
  await writeFile(join(path, 'index.json'), bad, { mode: 0o600 });
  await assert.rejects(SnapshotStore.open(path));
  assert.equal(await readFile(join(path, 'index.json'), 'utf8'), bad);
  await rm(join(path, 'index.json'));
  await writeFile(join(path, 'unknown.bin'), 'keep', { mode: 0o600 });
  await assert.rejects(SnapshotStore.open(path));
  assert.equal(await readFile(join(path, 'unknown.bin'), 'utf8'), 'keep');
  await rm(join(path, 'unknown.bin'));
  await symlink('missing', join(path, 'index.json'));
  await assert.rejects(SnapshotStore.open(path));
});


test('public revocation without its own capability cannot use operator authority', async t => {
  const path = await directory(t);
  const store = await SnapshotStore.open(path);
  try {
    const created = await store.publish(admitted());
    await assert.rejects(store.revoke(created.id, undefined as unknown as string),
      (error: unknown) => error instanceof MotionError && error.code === 'not-found');
    const retained = await store.read(created.id, created.readToken); await retained.file.close();
    await store.revokeId(created.id);
    await assert.rejects(store.read(created.id, created.readToken));
  } finally { await store.close(); }
});


async function syncPrototype(path: string) {
  const file = await open(join(path, '.server.lock'), 'r');
  try { return Object.getPrototypeOf(file) as FileHandle; } finally { await file.close(); }
}

test('cancellation after durable payload but before index commit removes only unindexed output', async t => {
  const path = await directory(t), store = await SnapshotStore.open(path);
  const prototype = await syncPrototype(path), original = prototype.sync;
  const controller = new AbortController();
  let directories = 0;
  const mock = t.mock.method(prototype, 'sync', async function(this: FileHandle) {
    await original.call(this);
    if ((await this.stat()).isDirectory() && ++directories === 1) controller.abort();
  });
  try {
    await assert.rejects(store.publish(admitted(), { signal: controller.signal }),
      (error: unknown) => error instanceof MotionError && error.code === 'cancelled');
    assert.deepEqual(await store.inspect(), []);
    assert.deepEqual((await readdir(path)).sort(), ['.server.lock']);
  } finally { mock.mock.restore(); await store.close(); }
});

test('post-index fsync failure preserves committed state and refuses automatic retry', async t => {
  const path = await directory(t), store = await SnapshotStore.open(path);
  const prototype = await syncPrototype(path), original = prototype.sync;
  let directories = 0;
  const mock = t.mock.method(prototype, 'sync', async function(this: FileHandle) {
    if ((await this.stat()).isDirectory() && ++directories === 2) throw new Error('Controlled directory sync failure');
    return original.call(this);
  });
  try {
    await assert.rejects(store.publish(admitted()),
      (error: unknown) => error instanceof MotionError && error.code === 'durability');
    await assert.rejects(store.publish(admitted()),
      (error: unknown) => error instanceof MotionError && error.code === 'unavailable');
    const index = JSON.parse(await readFile(join(path, 'index.json'), 'utf8'));
    assert.equal(index.publications.length, 1);
    assert.ok((await readdir(path)).includes(index.publications[0].id + '.motion.json'));
  } finally { mock.mock.restore(); await store.close(); }
  const reopened = await SnapshotStore.open(path);
  try { assert.equal((await reopened.inspect()).length, 1); } finally { await reopened.close(); }
});

test('one active writer refuses busy and close retains lifetime lock until native write finishes', async t => {
  const path = await directory(t), store = await SnapshotStore.open(path);
  const prototype = await syncPrototype(path), original = prototype.sync;
  let release!: () => void, entered!: () => void, intercepted = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const mock = t.mock.method(prototype, 'sync', async function(this: FileHandle) {
    if (!intercepted && (await this.stat()).isFile()) { intercepted = true; entered(); await gate; }
    return original.call(this);
  });
  const publication = store.publish(admitted());
  let close: Promise<void> | undefined;
  try {
    await reached;
    await assert.rejects(store.publish(admitted()),
      (error: unknown) => error instanceof MotionError && error.code === 'busy');
    let closed = false; close = store.close().then(() => { closed = true; });
    await assert.rejects(SnapshotStore.open(path),
      (error: unknown) => error instanceof MotionError && error.code === 'busy');
    assert.equal(closed, false);
    release(); await publication; await close;
  } finally { release(); await publication.catch(() => {}); mock.mock.restore(); await (close ?? store.close()); }
  const reopened = await SnapshotStore.open(path);
  try { assert.equal((await reopened.inspect()).length, 1); } finally { await reopened.close(); }
});
