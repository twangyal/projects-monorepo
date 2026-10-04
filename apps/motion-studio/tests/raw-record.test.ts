import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as recovery from '../src/storage.ts';

// Guard the actual export boundary: neither unknown keys nor literal text may
// disappear, and unsupported structured-clone values must never become JSON.
function serialize(value: unknown): string {
  assert.equal(typeof recovery.serializeRawRecord, 'function');
  return recovery.serializeRawRecord(value);
}
test('raw backup preserves every JSON value and unknown property literally', () => {
  const raw = { schemaVersion: 99, ['__proto__']: 'literal', extra: ['日本語', null, false, 0], text: '<script>\u0000' };
  assert.equal(serialize(raw), JSON.stringify(raw));
  assert.deepEqual(JSON.parse(serialize(raw)), raw);
});
test('raw backup rejects lossy structured-clone values', () => {
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  const hole = new Array(2); hole[1] = null;
  for (const value of [undefined, { x: undefined }, Infinity, NaN, -0, new Date(0), new Map(), new Set(), new Uint8Array(2), 1n, cycle, hole, { toJSON() { return 'changed'; } }]) {
    assert.throws(() => serialize(value), /JSON|unsafe|cannot/i);
  }
});
test('raw backup accepts shared noncyclic values without mutating them', () => {
  const shared = Object.freeze({ x: 1 }); const raw = Object.freeze([shared, shared]);
  assert.equal(serialize(raw), '[{"x":1},{"x":1}]');
});
test('raw backup measures UTF-8 and rejects oversize before a download', () => {
  assert.equal(new TextEncoder().encode(serialize('x'.repeat(6 * 1024 * 1024 - 2))).length, 6 * 1024 * 1024);
  assert.throws(() => serialize('x'.repeat(6 * 1024 * 1024 - 1)), /6 MiB/i);
  assert.throws(() => serialize('語'.repeat(2 * 1024 * 1024)), /6 MiB/i);
});
