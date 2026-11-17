import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cueWords, parseWordTiming, splitSung, sungCharacters } from '../src/word-timing.ts';

const cues = [{ start: 1, end: 4, text: 'Hello  darling\nwhere' }, { start: 5, end: 6, text: 'é 漢字' }];
const reply = { recognized: true, lines: [
  [{ text: 'Hello', start: 1.2, heard: true }, { text: 'darling', start: 1.6, heard: true }, { text: 'where', start: 2.5, heard: false }],
  [{ text: 'é', start: 5.1, heard: false }, { text: '漢', start: 5.4, heard: false }, { text: '字', start: 5.6, heard: false }],
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

test('lyric words split like the studio: spaceless scripts by character, Tibetan by syllable', () => {
  // The same examples are checked against karaoke/lyrics_auto.py in tests/test_lyrics_auto.py.
  const cases = JSON.parse(readFileSync(new URL('./lyric-words.json', import.meta.url), 'utf8')) as [string, string[]][];
  for (const [text, words] of cases) assert.deepEqual(cueWords(text), words, text);
});

test('the sung prefix counts code points of words already started and skips spaces', () => {
  const lines = parseWordTiming(reply, cues).lines;
  assert.deepEqual([0, 1.2, 1.7, 3].map(t => sungCharacters(lines[0], t)), [0, 5, 12, 17]);
  assert.equal(sungCharacters(lines[1], 5.5), 2, 'é and 漢 have started');
  assert.equal(sungCharacters(lines[1], 5.7), 3, 'é, 漢 and 字 are three code points');
  assert.deepEqual(splitSung('Hello darling', 5), ['Hello', ' darling']);
  assert.deepEqual(splitSung('darling', 0), ['', 'darling']);
  assert.deepEqual(splitSung('é 漢字', 3), ['é 漢字', '']);
  assert.deepEqual(splitSung('😀 ok', 1), ['😀', ' ok'], 'emoji are never cut in half');
});

test('a line in another script comes with how it is said, a piece per word, lit as its words are sung', async () => {
  const { saidCharacters, saidLine } = await import('../src/word-timing.ts');
  const korean = [{ start: 1, end: 4, text: '사랑해 너를' }, { start: 5, end: 6, text: 'hello' }];
  const said = { recognized: true, lines: [[{ text: '사랑해', start: 1.2, heard: true }, { text: '너를', start: 2, heard: true }], [{ text: 'hello', start: 5.2, heard: true }]],
    said: [['saranghae', 'neoreul'], null] };
  const timing = parseWordTiming(said, korean);
  assert.deepEqual(timing.said, [['saranghae', 'neoreul'], null]);
  assert.equal(saidLine(timing.said[0]!), 'saranghae neoreul');
  assert.deepEqual([1, 1.5, 2.5].map(t => saidCharacters(timing.said[0]!, timing.lines[0]!, t)), [0, 9, 16]);
  // A Japanese word's later characters are said with its first: their pieces are empty.
  assert.equal(saidLine(['toukyou', '', 'e', 'ikou', '', '']), 'toukyou e ikou');
  // Replies from a studio without pronunciations still read; pieces that do not match the words are refused.
  assert.deepEqual(parseWordTiming({ recognized: true, lines: said.lines }, korean).said, [null, null]);
  for (const bad of [[['saranghae'], null], [['saranghae', 'neoreul']], [['saranghae', 7], null]]) {
    assert.throws(() => parseWordTiming({ ...said, said: bad }, korean), Error, JSON.stringify(bad));
  }
});
