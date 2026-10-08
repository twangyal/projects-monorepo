import test from 'node:test';
import assert from 'node:assert/strict';
import { TimingCapture } from '../src/sequential-timing.ts';
import type { Cue } from '../src/lyrics.ts';

const cues = (texts = ['First', 'Second']): Cue[] => texts.map(text => ({ start: NaN, end: -1, text }));
function unchanged(capture: TimingCapture, action: () => void): void {
  const before = capture.state;
  assert.throws(action);
  assert.deepEqual(capture.state, before);
}

test('literal supplied text admits invalid old timings without reading numeric or unknown getters', () => {
  let reads = 0;
  const input = [{ text: '  First\nnext 🎵  ', get start(): number { reads++; throw Error('Old start'); }, get end(): number { reads++; throw Error('Old end'); }, get unrelated() { reads++; throw Error('Unknown'); } }];
  const capture = new TimingCapture(input, 3);
  assert.deepEqual(capture.state, { phase: 'start', lineIndex: 0, pendingStart: null, texts: ['  First\nnext 🎵  '], completed: [] });
  assert.equal(reads, 0);
  input[0].text = 'Caller changed';
  assert.equal(capture.state.texts[0], '  First\nnext 🎵  ');
});

test('exact native positions retain fractional boundaries, adjacency, gaps and last clip endpoint', () => {
  const capture = new TimingCapture(cues([' A ', 'B\nC', '<last> & 🎵']), 10);
  capture.markStart(.123456789); capture.markEnd(1.1 + 1.2);
  capture.markStart(1.1 + 1.2); capture.markEnd(4.000000000000001);
  capture.markStart(8.123456789); capture.markEnd(10);
  assert.deepEqual(capture.review(), [{ start: .123456789, end: 1.1 + 1.2, text: ' A ' }, { start: 1.1 + 1.2, end: 4.000000000000001, text: 'B\nC' }, { start: 8.123456789, end: 10, text: '<last> & 🎵' }]);
  assert.deepEqual(capture.state, { phase: 'review', lineIndex: 3, pendingStart: null, texts: [' A ', 'B\nC', '<last> & 🎵'], completed: capture.review() });
});

test('start zero canonicalizes negative zero without quantizing any nonzero position', () => {
  const capture = new TimingCapture(cues(['Line']), 1);
  capture.markStart(-0); assert.equal(Object.is(capture.state.pendingStart, -0), false);
  capture.markEnd(.0000000000000001);
  assert.equal(Object.is(capture.review()[0].start, -0), false);
  assert.equal(capture.review()[0].end, .0000000000000001);
});

test('phase misuse and invalid marks leave cursor, completed text and pending start atomic', () => {
  const capture = new TimingCapture(cues(), 5);
  unchanged(capture, () => capture.markEnd(1)); unchanged(capture, () => capture.review());
  for (const time of [NaN, Infinity, -Infinity, -1, 5, 6, '1', null, undefined]) unchanged(capture, () => capture.markStart(time as number));
  capture.markStart(1.234567);
  unchanged(capture, () => capture.markStart(2)); unchanged(capture, () => capture.review());
  for (const time of [NaN, Infinity, -Infinity, -1, 1, 1.234567, 5.000000000000001, '2', null, undefined]) unchanged(capture, () => capture.markEnd(time as number));
  capture.markEnd(2.5);
  unchanged(capture, () => capture.markStart(2.4999999999999996));
  assert.equal(capture.state.lineIndex, 1); assert.equal(capture.state.pendingStart, null);
  capture.markStart(2.5); capture.markEnd(5);
  unchanged(capture, () => capture.markStart(0)); unchanged(capture, () => capture.markEnd(5));
});

test('state and complete review return independent graphs including strings and cue arrays', () => {
  const capture = new TimingCapture(cues(['Line']), 2);
  capture.markStart(.1); capture.markEnd(1.5);
  const state = capture.state, review = capture.review();
  state.texts[0] = 'Changed'; state.completed[0].text = 'Changed'; state.completed.length = 0; state.phase = 'cancelled';
  review[0].start = 0; review[0].text = 'Changed'; review.push({ start: 1.5, end: 2, text: 'Extra' });
  assert.deepEqual(capture.review(), [{ start: .1, end: 1.5, text: 'Line' }]);
  assert.equal(capture.state.phase, 'review'); assert.deepEqual(capture.state.texts, ['Line']);
});

for (const phase of ['start', 'end', 'review'] as const) test(`cancel is terminal/idempotent from ${phase} while retaining only actual completed intervals`, () => {
  const capture = new TimingCapture(cues(), 3);
  capture.markStart(0); capture.markEnd(1);
  if (phase !== 'start') capture.markStart(1.5);
  if (phase === 'review') capture.markEnd(3);
  const before = capture.state;
  capture.cancel(); capture.cancel();
  assert.deepEqual(capture.state, { ...before, phase: 'cancelled', pendingStart: null });
  unchanged(capture, () => capture.markStart(2)); unchanged(capture, () => capture.markEnd(3)); unchanged(capture, () => capture.review());
});

test('complete maximum 200 lines / 20000 Unicode points / 300 seconds is retained verbatim', () => {
  const texts = Array.from({ length: 200 }, (_, i) => i % 2 ? '🎵'.repeat(100) : 'x'.repeat(100));
  const capture = new TimingCapture(cues(texts), 300);
  for (let i = 0; i < 200; i++) { capture.markStart(i * 1.5); capture.markEnd((i + 1) * 1.5); }
  assert.deepEqual(capture.review(), texts.map((text, i) => ({ start: i * 1.5, end: (i + 1) * 1.5, text })));
  const over = [...texts]; over[199] += '🎵'; assert.throws(() => new TimingCapture(cues(over), 300));
  assert.throws(() => new TimingCapture(cues(Array(201).fill('Line')), 300));
});

test('existing Python whitespace, BOM and literal control policy is reused without new normalization', () => {
  const texts = ['\ufeff', ' \u00a0word\u00a0 ', 'line\r\nnext', '\u0001literal\u007f', '<b>not HTML</b> &amp;'];
  const capture = new TimingCapture(cues(texts), 5); assert.deepEqual(capture.state.texts, texts);
  for (const text of ['', '  ', '\u0085\u001f', '\u00a0', '\u2028', 'abc\0def', '\ud800', '\udfff']) assert.throws(() => new TimingCapture(cues([text]), 5));
  const exact = '🎵'.repeat(240); assert.equal(new TimingCapture(cues([exact]), 1).state.texts[0], exact);
  assert.throws(() => new TimingCapture(cues([exact + '🎵']), 1));
});

test('duration and cue collection reject sparse/inherited/accessor admission without invoking readers', () => {
  for (const duration of [.999, 300.001, NaN, Infinity, -Infinity, '1', true, null]) assert.throws(() => new TimingCapture(cues(), duration as number));
  for (const input of [[], new Array(1), null, {}, Object.assign(Object.create(Array.prototype), { length: 1, 0: cues()[0] })]) assert.throws(() => new TimingCapture(input as Cue[], 1));
  let reads = 0;
  const index: Cue[] = []; Object.defineProperty(index, '0', { enumerable: true, get() { reads++; return cues()[0]; } });
  const text = { start: 0, end: 1, get text() { reads++; return 'Line'; } };
  assert.throws(() => new TimingCapture(index, 1)); assert.throws(() => new TimingCapture([text], 1));
  const inherited = Object.create({ text: 'Inherited' }) as Cue;
  assert.throws(() => new TimingCapture([inherited], 1));
  assert.throws(() => new TimingCapture([{ start: 0, end: 1 } as Cue], 1));
  assert.throws(() => new TimingCapture([{ start: 0, end: 1, text: 7 } as unknown as Cue], 1));
  assert.equal(reads, 0);
});
