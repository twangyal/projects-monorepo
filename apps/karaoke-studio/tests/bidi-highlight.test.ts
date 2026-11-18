import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { framed, joinPieces, lineWords, litWords, sungStretches, type WordPlace } from '../src/bidi-highlight.ts';

const fixture = JSON.parse(readFileSync(new URL('./sung-stretches.json', import.meta.url), 'utf8')) as {
  stretches: [WordPlace[], boolean[], [number | null, number | null][]][];
  lit: [string, number, boolean[]][];
};

test('the sung colour covers the lit words wherever the line shows them, as the video finds them', () => {
  for (const [places, lit, expected] of fixture.stretches) {
    const actual = sungStretches(places, lit);
    assert.equal(actual.length, expected.length, JSON.stringify({ lit, actual }));
    expected.forEach(([low, high], index) => {
      const [a, b] = actual[index]!;
      if (low === null) assert.equal(a, -Infinity); else assert.ok(Math.abs(a - low) < 1e-9, `${a} ${low}`);
      if (high === null) assert.equal(b, Infinity); else assert.ok(Math.abs(b - high) < 1e-9, `${b} ${high}`);
    });
  }
});

test('a word lights once its first character is sung, counting code points and skipping spaces', () => {
  for (const [line, count, expected] of fixture.lit) assert.deepEqual(litWords(line, count), expected, `${line} ${count}`);
  // Offsets are the line's own (UTF-16), so a range over them picks out each word, astral letters included.
  const line = '  𞤀𞤁 abc';
  assert.deepEqual(lineWords(line).map(({ start, end }) => line.slice(start, end)), ['𞤀𞤁', 'abc']);
});

test('pieces of a word that touch join, and the frame is split once between the two colours', () => {
  assert.deepEqual(joinPieces([[168.3, 267.7], [0, 79.1], [79.1, 90]]), [[0, 90], [168.3, 267.7]]);
  // The line starts 400.4 px into a 1280 px frame: the sung stretches, rounded to whole pixels, and the rest between them.
  assert.deepEqual(framed([[-Infinity, 87.85], [210.7, Infinity]], 400.4, 1280), { sung: [[0, 488], [611, 1280]], rest: [[488, 611]] });
  assert.deepEqual(framed([], 400, 1280), { sung: [], rest: [[0, 1280]] });
  assert.deepEqual(framed([[-Infinity, Infinity]], 400, 1280), { sung: [[0, 1280]], rest: [] });
  // A stretch off the frame is dropped.
  assert.deepEqual(framed([[2000, Infinity]], 0, 1280), { sung: [], rest: [[0, 1280]] });
});
