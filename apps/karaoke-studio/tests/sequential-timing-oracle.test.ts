/** Literal independent expectations authored before producer implementation inspection. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TimingCapture } from '../src/sequential-timing.ts';
import type { Cue } from '../src/lyrics.ts';

const cue = (text: string): Cue => ({ start: NaN, end: -Infinity, text });
const words = ['  first 🌿\nline  ', 'second\r\nverse', 'last & <literal>'];
const invalidAtomic = (capture: TimingCapture, action: () => unknown) => {
  const before = capture.state;
  assert.throws(action);
  assert.deepEqual(capture.state, before);
};

test('oracle captures literal represented gaps and adjacency without changing supplied words', () => {
  const input = words.map(cue), capture = new TimingCapture(input, 10);
  assert.deepEqual(capture.state, { phase: 'start', lineIndex: 0, pendingStart: null, texts: words, completed: [] });
  input[0].text = 'Changed later';
  capture.markStart(.10000000000000002);
  assert.deepEqual(capture.state, { phase: 'end', lineIndex: 0, pendingStart: .10000000000000002, texts: words, completed: [] });
  capture.markEnd(.3333333333333333);
  capture.markStart(.3333333333333333); capture.markEnd(1.0000000000000002);
  capture.markStart(4.125); capture.markEnd(10);
  const expected = [
    { start: .10000000000000002, end: .3333333333333333, text: words[0] },
    { start: .3333333333333333, end: 1.0000000000000002, text: words[1] },
    { start: 4.125, end: 10, text: words[2] },
  ];
  assert.deepEqual(capture.state, { phase: 'review', lineIndex: 3, pendingStart: null, texts: words, completed: expected });
  assert.deepEqual(capture.review(), expected);
});

test('oracle constructor never reads old numeric getters or requires usable old timing', () => {
  let reads = 0;
  const old = { text: 'Keep old raw timing independent' } as Cue;
  for (const key of ['start', 'end']) Object.defineProperty(old, key, { enumerable: true, get() { reads++; throw Error('Old timing accessed'); } });
  const capture = new TimingCapture([old], 1);
  assert.equal(reads, 0); capture.markStart(-0); capture.markEnd(1);
  assert.deepEqual(capture.review(), [{ start: 0, end: 1, text: old.text }]);
  assert.equal(Object.is(capture.review()[0].start, -0), false); assert.equal(reads, 0);
});

test('oracle every exposed graph is detached from source and later state', () => {
  const capture = new TimingCapture([cue('one'), cue('two')], 2);
  capture.markStart(0); capture.markEnd(.5);
  const state = capture.state; state.texts[1] = 'wrong'; state.completed[0].text = 'wrong'; state.completed[0].end = 99; state.pendingStart = 90;
  assert.deepEqual(capture.state, { phase: 'start', lineIndex: 1, pendingStart: null, texts: ['one', 'two'], completed: [{ start: 0, end: .5, text: 'one' }] });
  capture.markStart(.75); capture.markEnd(2);
  const a = capture.review(), b = capture.review(); a[0].text = 'mutated'; a.pop();
  assert.deepEqual(b, [{ start: 0, end: .5, text: 'one' }, { start: .75, end: 2, text: 'two' }]);
  assert.deepEqual(capture.review(), b);
});

test('oracle invalid initial marks and phase misuse leave every state field unchanged', () => {
  const c = new TimingCapture([cue('one'), cue('two')], 2);
  for (const t of [-Number.MIN_VALUE, 2, 3, NaN, Infinity, -Infinity]) invalidAtomic(c, () => c.markStart(t));
  invalidAtomic(c, () => c.markEnd(1)); invalidAtomic(c, () => c.review());
  c.markStart(.25);
  invalidAtomic(c, () => c.markStart(.5));
  for (const t of [0, .25, 2.0000000000000004, NaN, Infinity, -Infinity]) invalidAtomic(c, () => c.markEnd(t));
  invalidAtomic(c, () => c.review()); c.markEnd(.75);
  invalidAtomic(c, () => c.markStart(.7499999999999999));
  invalidAtomic(c, () => c.review());
  c.markStart(.75); c.markEnd(2);
  invalidAtomic(c, () => c.markStart(1)); invalidAtomic(c, () => c.markEnd(2));
});

test('oracle no invented minimum duration or millisecond grid narrows represented positive intervals', () => {
  const c = new TimingCapture([cue('tiny'), cue('one ULP')], 1);
  c.markStart(0); c.markEnd(Number.MIN_VALUE);
  c.markStart(.5); c.markEnd(.5000000000000001);
  assert.deepEqual(c.review(), [{ start: 0, end: Number.MIN_VALUE, text: 'tiny' }, { start: .5, end: .5000000000000001, text: 'one ULP' }]);
});

test('oracle cancel preserves completed lines but drops pending start and is terminal', () => {
  for (const position of ['initial', 'pending', 'partial', 'review']) {
    const c = new TimingCapture([cue('one'), cue('two')], 2);
    if (position !== 'initial') c.markStart(0);
    if (position === 'partial' || position === 'review') { c.markEnd(.5); c.markStart(.75); }
    if (position === 'review') c.markEnd(2);
    const before = c.state; c.cancel(); c.cancel();
    assert.deepEqual(c.state, { ...before, phase: 'cancelled', pendingStart: null, lineIndex: before.completed.length });
    invalidAtomic(c, () => c.markStart(1)); invalidAtomic(c, () => c.markEnd(2)); invalidAtomic(c, () => c.review());
  }
});

test('oracle current Unicode semantics preserve BOM and permitted controls while refusing blank or malformed words', () => {
  const accepted = ['\uFEFF', 'x\t y\r\nz', 'x\u0085y', 'x\u0001y', '😀'.repeat(240)];
  for (const text of accepted) {
    const c = new TimingCapture([cue(text)], 1); c.markStart(0); c.markEnd(1); assert.equal(c.review()[0].text, text);
  }
  for (const text of ['', ' \r\n\t', '\u0085', '\u001c', '\u3000', '\0', 'x\0y', '\ud800', '\udfff', 'x'.repeat(241), '🌿'.repeat(241)]) assert.throws(() => new TimingCapture([cue(text)], 1));
});

test('oracle exact200 lines and20000 Unicode codepoints complete at actual300-second endpoint', () => {
  const texts = Array.from({ length: 200 }, (_, i) => `${String(i).padStart(3, '0')}${'🌿'.repeat(97)}`);
  assert.equal(texts.reduce((sum, text) => sum + [...text].length, 0), 20000);
  const capture = new TimingCapture(texts.map(cue), 300);
  for (let i = 0; i < 200; i++) { capture.markStart(i * 1.5); capture.markEnd((i + 1) * 1.5); }
  const review = capture.review(); assert.equal(review.length, 200);
  assert.deepEqual(review, texts.map((text, i) => ({ start: i * 1.5, end: (i + 1) * 1.5, text })));
  assert.equal(review[199].end, 300);
  assert.throws(() => new TimingCapture([...texts.map(cue), cue('extra')], 300));
  const excessive = texts.map(cue); excessive[199].text += 'x'; assert.throws(() => new TimingCapture(excessive, 300));
});

test('oracle invalid duration and container shapes refuse before any accessor is invoked', () => {
  for (const duration of [0, .9999999999999999, 300.00000000000006, NaN, Infinity]) assert.throws(() => new TimingCapture([cue('one')], duration));
  for (const cues of [[], new Array<Cue>(1), Object.assign(Object.create(Array.prototype), { 0: cue('one'), length: 1 })]) assert.throws(() => new TimingCapture(cues as Cue[], 1));
  let reads = 0;
  const indexGetter: Cue[] = []; Object.defineProperty(indexGetter, '0', { enumerable: true, get() { reads++; return cue('one'); } });
  assert.throws(() => new TimingCapture(indexGetter, 1));
  const textGetter = { start: 0, end: 1 } as Cue; Object.defineProperty(textGetter, 'text', { enumerable: true, get() { reads++; return 'one'; } });
  assert.throws(() => new TimingCapture([textGetter], 1));
  const inherited = Object.create({ text: 'inherited' }) as Cue; assert.throws(() => new TimingCapture([inherited], 1));
  for (const value of [null, {}, { text: 1 }, { text: undefined }]) assert.throws(() => new TimingCapture([value as unknown as Cue], 1));
  assert.equal(reads, 0);
});
