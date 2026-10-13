import test from 'node:test';
import assert from 'node:assert/strict';
import { cueWords, parseWordTiming, splitSung, sungCharacters } from '../src/word-timing.ts';

const cues = [{ start: 1, end: 4, text: 'Hello  darling\nwhere' }, { start: 5, end: 6, text: 'é 漢字' }];
const reply = { recognized: true, lines: [
  [{ text: 'Hello', start: 1.2, heard: true }, { text: 'darling', start: 1.6, heard: true }, { text: 'where', start: 2.5, heard: false }],
  [{ text: 'é', start: 5.1, heard: false }, { text: '漢字', start: 5.4, heard: false }],
] };

test('word timing replies are accepted only for exactly the requested words, in order and inside each line', () => {
  assert.deepEqual(cueWords(cues[0].text), ['Hello', 'darling', 'where']);
  assert.equal(parseWordTiming(reply, cues).lines[0][2].start, 2.5);
  const broken: [string, (r: typeof reply) => void][] = [
    ['other words', r => { r.lines[0][1].text = 'darlin'; }],
    ['missing word', r => { r.lines[0].pop(); }],
    ['backwards', r => { r.lines[0][1].start = 1.1; }],
    ['before line', r => { r.lines[0][0].start = 0.5; }],
    ['after line', r => { r.lines[1][1].start = 6.5; }],
    ['not a number', r => { (r.lines[0][0] as Record<string, unknown>).start = '1.2'; }],
    ['extra key', r => { (r as Record<string, unknown>).extra = 1; }],
    ['line count', r => { r.lines.pop(); }],
  ];
  for (const [label, mutate] of broken) { const copy = structuredClone(reply); mutate(copy); assert.throws(() => parseWordTiming(copy, cues), Error, label); }
});

test('the sung prefix counts code points of words already started and skips spaces', () => {
  const lines = parseWordTiming(reply, cues).lines;
  assert.deepEqual([0, 1.2, 1.7, 3].map(t => sungCharacters(lines[0], t)), [0, 5, 12, 17]);
  assert.equal(sungCharacters(lines[1], 5.5), 3, 'é and 漢字 are three code points');
  assert.deepEqual(splitSung('Hello darling', 5), ['Hello', ' darling']);
  assert.deepEqual(splitSung('darling', 0), ['', 'darling']);
  assert.deepEqual(splitSung('é 漢字', 3), ['é 漢字', '']);
  assert.deepEqual(splitSung('😀 ok', 1), ['😀', ' ok'], 'emoji are never cut in half');
});
