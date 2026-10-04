import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SRT_BYTES, parseSrt } from '../src/srt.ts';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const first = '1\n00:00:00,125 --> 00:00:01,250\nFirst line';
const one = (text: string): string => `1\n00:00:00,000 --> 00:00:01,000\n${text}`;
function numbered(count: number, text: string): string {
  return Array.from({ length: count }, (_, index) => {
    const stamp = (seconds: number): string => `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')},000`;
    return `${index + 1}\n${stamp(index)} --> ${stamp(index + 1)}\n${text}`;
  }).join('\n\n');
}

test('literal millisecond times preserve adjacency, gaps and multiline spacing', () => {
  const source = `${first}\n  Second 🎵 line\t\n\n2\n00:00:01,250 --> 00:00:02,001\nNext\n\n3\n00:00:03,999 --> 00:00:05,000\nLast`;
  assert.deepEqual(parseSrt(encode(source), 5), [
    { start: .125, end: 1.25, text: 'First line\n  Second 🎵 line\t' },
    { start: 1.25, end: 2.001, text: 'Next' },
    { start: 3.999, end: 5, text: 'Last' },
  ]);
});

test('one leading BOM and CRLF are admitted, with blank ASCII separators', () => {
  assert.deepEqual(parseSrt(encode(`\ufeff \t\r\n\r\n${first.replaceAll('\n', '\r\n')}\r\n \t\r\n`), 2), [
    { start: .125, end: 1.25, text: 'First line' },
  ]);
  assert.throws(() => parseSrt(encode(`\ufeff\ufeff${first}`), 2));
  assert.throws(() => parseSrt(encode(`1\n\ufeff00:00:00,125 --> 00:00:01,250\nText`), 2));
  assert.equal(parseSrt(encode(one('Body\ufeff text')), 1)[0].text, 'Body\ufeff text');
});

test('only the three exporter entities decode once while other ampersands remain literal', () => {
  assert.equal(parseSrt(encode(one('&lt;literal&gt; &amp; &amp;lt; &quot; &#60; &unknown;')), 1)[0].text,
    '<literal> & &lt; &quot; &#60; &unknown;');
  for (const text of ['<b>word</b>', 'word > next', '<script>alert(1)</script>']) {
    assert.throws(() => parseSrt(encode(one(text)), 1), /plain text|&lt;/i);
  }
});

test('raw forbidden controls and splitlines separators are refused, tab stays literal', () => {
  for (const code of [...Array.from({ length: 32 }, (_, i) => i).filter(i => i !== 9 && i !== 10), 127, 133, 0x2028, 0x2029]) {
    assert.throws(() => parseSrt(encode(one(`a${String.fromCharCode(code)}b`)), 1), `code ${code}`);
  }
  assert.equal(parseSrt(encode(one('a\tb')), 1)[0].text, 'a\tb');
});

test('fatal UTF-8 decoding refuses damaged sequences without inventing replacement text', () => {
  const prefix = encode(one(''));
  for (const bad of [[0xc3], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xff]]) {
    assert.throws(() => parseSrt(new Uint8Array([...prefix, ...bad]), 1), /UTF-8/i);
  }
  assert.equal(parseSrt(encode(one('literal � text')), 1)[0].text, 'literal � text');
});

test('indices are canonical contiguous decimal and cannot hide extra blocks', () => {
  for (const index of ['0', '01', '+1', ' 1', '1 ', '2', '1.0', '１']) {
    assert.throws(() => parseSrt(encode(first.replace(/^1/, index)), 2));
  }
  for (const index of ['1', '3', '02']) {
    assert.throws(() => parseSrt(encode(`${first}\n\n${index}\n00:00:01,250 --> 00:00:02,000\nSecond`), 2));
  }
  assert.throws(() => parseSrt(encode(`${first}\n\nUnexpected trailing prose`), 2));
});

test('timestamps require the exact full SubRip form without settings or repairs', () => {
  for (const timeline of [
    '00:00:00.125 --> 00:00:01.250', '0:00:00,125 --> 00:00:01,250',
    '00:60:00,125 --> 00:00:01,250', '00:00:60,125 --> 00:00:01,250',
    '00:00:00,12 --> 00:00:01,250', '00:00:00,0125 --> 00:00:01,250',
    '00:00:00,125-->00:00:01,250', '00:00:00,125  --> 00:00:01,250',
    '00:00:00,125 --> 00:00:01,250 X1:10', '00:00:00,125 --> 00:00:01,250 ',
  ]) assert.throws(() => parseSrt(encode(`1\n${timeline}\nText`), 2));
  assert.throws(() => parseSrt(encode(`WEBVTT\n\n${first}`), 2));
});

test('all cue intervals are validated atomically against exact selected duration', () => {
  assert.deepEqual(parseSrt(encode('1\n00:00:00,999 --> 00:00:01,000\nOne millisecond'), 1), [
    { start: .999, end: 1, text: 'One millisecond' },
  ]);
  for (const timeline of ['00:00:01,000 --> 00:00:01,000', '00:00:01,001 --> 00:00:01,000', '00:00:00,000 --> 00:00:01,001']) {
    assert.throws(() => parseSrt(encode(`1\n${timeline}\nBad`), 1));
  }
  assert.throws(() => parseSrt(encode(`${first}\n\n2\n00:00:01,249 --> 00:00:02,000\nOverlap`), 2));
  assert.throws(() => parseSrt(encode(one('Fractional clip boundary')), .999999999));
  for (const duration of [NaN, Infinity, -.1, .999, 300.001]) assert.throws(() => parseSrt(encode(first), duration));
});

test('blank content and bare CR are rejected, and internal blanks separate blocks', () => {
  for (const source of ['', '\ufeff', ' \t\n\n', '1\n00:00:00,000 --> 00:00:01,000', one('  \t'), one('\u00a0'), first.replaceAll('\n', '\r')]) {
    assert.throws(() => parseSrt(encode(source), 2));
  }
  assert.throws(() => parseSrt(encode(`${first}\n \t\nAnother lyric line`), 2));
  assert.throws(() => parseSrt(encode(`${first}\n\u00a0\nLast line`), 2), /blank|whitespace/i);
  assert.throws(() => parseSrt(encode(`${first}\n\u2003\u3000\nLast line`), 2), /blank|whitespace/i);
  assert.equal(parseSrt(encode(one('\u00a0Actual text\u00a0')), 1)[0].text, '\u00a0Actual text\u00a0');
});

test('240 Unicode points are counted after entity decode and include multiline LF', () => {
  const text = `${'🎵'.repeat(119)}\n${'🎵'.repeat(120)}`;
  assert.equal(parseSrt(encode(one(text)), 1)[0].text, text);
  assert.throws(() => parseSrt(encode(one(text + '🎵')), 1));
  assert.equal(parseSrt(encode(one('&amp;'.repeat(240))), 1)[0].text, '&'.repeat(240));
  assert.throws(() => parseSrt(encode(one('&amp;'.repeat(241))), 1));
});

test('200 cues and 20000 total Unicode points pass; next cue or point fails', () => {
  const source = numbered(200, '🎵'.repeat(100));
  const cues = parseSrt(encode(source), 300);
  assert.equal(cues.length, 200);
  assert.deepEqual(cues[199], { start: 199, end: 200, text: '🎵'.repeat(100) });
  assert.throws(() => parseSrt(encode(source + '🎵'), 300));
  assert.throws(() => parseSrt(encode(numbered(201, 'x')), 300));
});

test('exact 128 KiB whitespace-padded input passes and one extra byte fails', () => {
  assert.equal(MAX_SRT_BYTES, 131072);
  const core = `${first}\n\n`;
  const bytes = encode(core + ' '.repeat(MAX_SRT_BYTES - encode(core).byteLength));
  assert.equal(bytes.byteLength, MAX_SRT_BYTES);
  assert.equal(parseSrt(bytes, 2)[0].text, 'First line');
  assert.throws(() => parseSrt(new Uint8Array([...bytes, 32]), 2), /128|KiB|size|bytes/i);
});

test('input subarray byte range is honored and successful outputs are detached', () => {
  const source = encode(first);
  const backing = new Uint8Array(source.length + 2);
  backing[0] = 255;
  backing.set(source, 1);
  backing[backing.length - 1] = 255;
  const view = backing.subarray(1, -1);
  const before = backing.slice();
  const a = parseSrt(view, 2), b = parseSrt(view, 2);
  a[0].text = 'edited';
  assert.equal(b[0].text, 'First line');
  assert.deepEqual(backing, before);
  assert.throws(() => parseSrt(null as unknown as Uint8Array, 2));
});
