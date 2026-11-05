import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc } from '../src/lrc.ts';
const bytes = (text:string) => new TextEncoder().encode(text);

test('local LRC preserves explicit long holds, timed gaps, repeated lines and Unicode words', () => {
  assert.deepEqual(parseLrc(bytes('\ufeff[ti:Ignored title]\r\n[00:01.125][00:20.50]café 🌗\r\n[00:12.00]\r\n[00:22.00]終わり\r\n[00:24.00]'), 25), [
    {start:1.125,end:12,text:'café 🌗'}, {start:20.5,end:22,text:'café 🌗'}, {start:22,end:24,text:'終わり'},
  ]);
});

test('enhanced word tags are read as line lyrics without claiming to import their word timing', () => {
  assert.deepEqual(parseLrc(bytes('[00:01.00]<00:01.00>Hello <00:02.00>world\n[00:04.00]'), 5), [{start:1,end:4,text:'Hello world'}]);
});

test('invalid local LRC refuses without skipping malformed words, offsets or out-of-clip timing', () => {
  for (const source of ['', '[00:01.00]yes\nuntimed words', '[offset:100]\n[00:01.00]yes', '[00:60.00]bad', '[00:01]a\n[00:01]b', '[00:06]late', '[00:01]a\u0000b', '[00:01]'+ 'a'.repeat(241)]) {
    assert.throws(() => parseLrc(bytes(source), 5), source);
  }
  assert.throws(() => parseLrc(new Uint8Array([255]), 5), /UTF-8/);
  assert.throws(() => parseLrc(new Uint8Array(128*1024+1), 5), /128 KiB/);
});

test('the final line reaches the exact clip end for audio durations between milliseconds', () => {
  for (const duration of [5.0004, 5.0008]) assert.deepEqual(parseLrc(bytes('[00:01.00]Hello'), duration), [{start:1,end:duration,text:'Hello'}]);
});

test('a precise clearing timestamp equal to the clip end does not compare above it', () => {
  assert.deepEqual(parseLrc(bytes('[00:01.001]Last\n[00:01.128]'), 1.128), [{start:1.001,end:1.128,text:'Last'}]);
});
