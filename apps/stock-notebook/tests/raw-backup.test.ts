import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeRawRecord } from '../src/raw-backup.ts';
import { LIMITS } from '../src/types.ts';

test('raw text stays literal and valid Unicode at the current notebook byte boundary', () => {
  for (const raw of ['', ' \n{"x":1,"x":2}\n', '{broken', 'é🐟']) assert.equal(serializeRawRecord(raw), raw);
  const exact = 'é'.repeat(LIMITS.notebookBytes / 2);
  assert.equal(serializeRawRecord(exact), exact);
  assert.throws(() => serializeRawRecord(exact + 'x'), /too large|exceeds/i);
  for (const raw of ['\ud800', '\udfff', 'x\ud800y']) assert.throws(() => serializeRawRecord(raw), /invalid Unicode/i);
});

test('literal JSON objects preserve escapes, lone code units, special keys and small shared subtrees', () => {
  const leaf = ['é🐟', '\u0000\b\t\n\f\r"\\', '\ud800'];
  const value = { a: leaf, b: leaf, '\n"': { number: 1.25, yes: true, no: false, empty: null } };
  const json = serializeRawRecord(value);
  assert.deepEqual(JSON.parse(json), value);
  const special = Object.create(null) as Record<string, unknown>;
  special.__proto__ = 'literal';
  assert.equal(serializeRawRecord(special), '{"__proto__":"literal"}');
  assert.equal(serializeRawRecord([null, true, false, 0, 1e21]), '[null,true,false,0,1e+21]');
});

const unsafe: [string, unknown][] = [
  ['undefined', undefined], ['bigint', 1n], ['function', () => 1], ['symbol', Symbol('x')],
  ['infinity', Infinity], ['NaN', NaN], ['negative zero', -0], ['omitted object field', { x: undefined }],
  ['undefined array element', [undefined]], ['nonfinite field', { x: Infinity }], ['Date', new Date(0)],
  ['Map', new Map([['x', 1]])], ['Set', new Set([1])], ['typed array', new Uint8Array([1])],
  ['RegExp', /x/], ['sparse array', new Array(2)], ['extended array', Object.assign([1], { extra: 'x' })],
  ['nonenumerable', Object.defineProperty({}, 'hidden', { value: 1 })], ['symbol field', { [Symbol('x')]: 1 }],
];
for (const [name, value] of unsafe) test(`lossy ${name} cannot masquerade as a JSON recovery backup`, () => {
  assert.throws(() => serializeRawRecord(value), /lossless|unsafe|serializ/i);
});

test('computed fields and toJSON are rejected without executing user hooks', () => {
  let calls = 0;
  const getter = Object.defineProperty({}, 'x', { enumerable: true, get: () => { calls++; return 1; } });
  const hook = { toJSON: () => { calls++; return {}; } };
  assert.throws(() => serializeRawRecord(getter), /lossless|unsafe|serializ/i);
  assert.throws(() => serializeRawRecord(hook), /lossless|unsafe|serializ/i);
  assert.equal(calls, 0);
});

test('cycles and overdeep shared paths fail without overflowing the call stack', () => {
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  assert.throws(() => serializeRawRecord(cycle), /cyclic/i);
  let deep: unknown = null;
  for (let level = 0; level < 514; level++) deep = [deep];
  assert.throws(() => serializeRawRecord(deep), /depth|deep|unsafe/i);
  let shared: unknown = ['x'];
  const leaf = shared;
  for (let level = 0; level < 512; level++) shared = [shared];
  assert.throws(() => serializeRawRecord({ shallow: leaf, deep: shared }), /depth|deep|unsafe/i);
});

test('compact shared graphs are rejected before final JSON expansion', () => {
  let graph: unknown = 'x';
  for (let level = 0; level < 40; level++) graph = [graph, graph];
  const original = JSON.stringify;
  let expanded = false;
  JSON.stringify = ((value: unknown) => {
    if (Array.isArray(value)) { expanded = true; return '[]'; }
    return original(value);
  }) as typeof original;
  try { assert.throws(() => serializeRawRecord(graph), /too large|exceeds/i); }
  finally { JSON.stringify = original; }
  assert.equal(expanded, false);
});

test('escaped object UTF-8 byte accounting accepts the exact boundary and rejects one more byte', () => {
  const value = { x: 'é'.repeat((LIMITS.notebookBytes - 8) / 2) };
  const json = serializeRawRecord(value);
  assert.equal(Buffer.byteLength(json), LIMITS.notebookBytes);
  assert.equal((JSON.parse(json) as { x: string }).x, value.x);
  assert.throws(() => serializeRawRecord({ x: value.x + 'x' }), /too large|exceeds/i);
  const control = { x: '\u0000'.repeat(Math.floor((LIMITS.notebookBytes - 8) / 6)) };
  assert.equal(Buffer.byteLength(serializeRawRecord(control)), 8 + 6 * control.x.length);
  assert.throws(() => serializeRawRecord({ x: control.x + '\u0000' }), /too large|exceeds/i);
});
