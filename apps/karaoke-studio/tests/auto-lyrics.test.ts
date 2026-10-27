import test from 'node:test';
import assert from 'node:assert/strict';
import { correction, correctionSummary, parseAlignment, parseTranscript, recognizerName, uncertainSummary, unsureSummary, type AlignedCue } from '../src/auto-lyrics.ts';
import { draftLines } from '../src/lyrics.ts';

const cue = (start: number, end: number, text: string, matched?: number) => (matched === undefined ? { start, end, text } : { start, end, text, matched });

test('transcript replies are validated like saved lyrics before they can be reviewed', () => {
  assert.deepEqual(parseTranscript({ available: false }, 30), { available: false });
  // Each line lists its words, one per second of the line here.
  const recognized = (start: number, end: number, text: string, confidence: number) => ({ start, end, text, confidence,
    words: text.split(' ').filter(Boolean).map((word, index) => ({ text: word, start: start + index * 0.5, end: start + index * 0.5 + 0.4, confidence })) });
  const reply = { available: true, model: 'parakeet-tdt-0.6b-v2-int8+silero-vad', words: 7, cues: [recognized(1, 3, 'Hello little world', 0.95), recognized(4, 6, 'This is our chorus', 0.42)] };
  const parsed = parseTranscript(reply, 30);
  assert.deepEqual(parsed, reply);
  assert.equal(parsed.available && unsureSummary(parsed.cues), 'line 2');
  const line = reply.cues[0]!, word = line.words[0]!;
  for (const words of [undefined, [{ ...word, confidence: 1.5 }], [{ ...word, end: 31 }], [{ ...word, start: 2, end: 1 }], [{ ...word, text: ' ' }], [{ ...word, extra: 1 }], Array(401).fill(word)]) {
    assert.throws(() => parseTranscript({ ...reply, cues: [{ ...line, words }] }, 30), /unreadable/);
  }
  assert.equal(recognizerName(reply.model), 'the English recognition model');
  assert.equal(recognizerName('parakeet-tdt-0.6b-v3-int8+silero-vad'), 'the multilingual recognition model');
  assert.equal(recognizerName('sensevoice-small-int8+silero-vad'), 'the East Asian recognition model');
  assert.equal(recognizerName('whisper-turbo-int8+parakeet-tdt-0.6b-v3-timing'), 'Whisper, timed by the multilingual recognition model');
  assert.equal(recognizerName('something-else'), 'the local recognition model');
  for (const bad of [{ available: false, extra: 1 }, { ...reply, words: -1 }, { ...reply, cues: [recognized(3, 1, 'backwards', 1)] }, { ...reply, cues: [recognized(1, 40, 'past the clip', 1)] },
    { ...reply, cues: [{ ...cue(1, 2, 'x'), matched: 1 }] }, { ...reply, cues: [cue(1, 2, 'no confidence')] }, { ...reply, cues: [recognized(1, 2, 'x', 2)] }, { ...reply, cues: [recognized(1, 2, '', 1)] }, { ...reply, extra: true }, [], null]) {
    assert.throws(() => parseTranscript(bad, 30), /unreadable|Line 1|between/);
  }
});

test('aligned lines must keep the exact supplied text, in order', () => {
  const lines = draftLines('  Hello, little world!\n\nThis is our chorus  \n');
  assert.deepEqual(lines, ['Hello, little world!', 'This is our chorus']);
  const aligned = parseAlignment({ cues: [cue(0.85, 2.75, lines[0], 1), cue(3.85, 5.95, lines[1], 0.25)] }, 30, lines);
  assert.equal(aligned[1].matched, 0.25);
  assert.throws(() => parseAlignment({ cues: [cue(0.85, 2.75, 'Hello little world', 1), cue(3.85, 5.95, lines[1], 1)] }, 30, lines), /changed the supplied/);
  assert.throws(() => parseAlignment({ cues: [cue(0.85, 2.75, lines[0], 1)] }, 30, lines), /changed the supplied/);
  assert.throws(() => parseAlignment({ cues: [cue(0.85, 2.75, lines[0], 1.5), cue(3.85, 5.95, lines[1], 1)] }, 30, lines), /unreadable/);
  assert.throws(() => parseAlignment({ cues: [], more: 1 }, 30, lines), /unreadable/);
});

test('uncertain lines are named so people know where to listen', () => {
  const make = (shares: number[]): AlignedCue[] => shares.map((matched, index) => ({ start: index, end: index + 0.5, text: `line ${index}`, matched }));
  assert.equal(uncertainSummary(make([1, 0.8, 0.5])), '');
  assert.equal(uncertainSummary(make([1, 0.2, 1])), 'line 2');
  assert.equal(uncertainSummary(make([0, 1, 0.4, 0.1])), 'lines 1, 3 and 4');
  assert.equal(uncertainSummary(make(Array(15).fill(0))), 'lines 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 and 3 more');
});

test('corrections of automatic lyrics count changed words and moved line starts', () => {
  const automatic = [{ start: 1, end: 3, text: 'Hello little world' }, { start: 4, end: 6, text: 'This is our chorus' }, { start: 8, end: 10, text: 'Sing it back to me' }];
  assert.deepEqual(correction(automatic, automatic), { words: 12, changed: 0, lines: 3, moved: 0 });
  assert.equal(correctionSummary(correction(automatic, automatic)), 'Your saved lyrics are the automatic lyrics unchanged.');
  // Case and punctuation are not corrections; a changed, an added and a removed word are, and so is a moved line.
  const saved = [{ start: 1.2, end: 3, text: 'Hello, little world!' }, { start: 4, end: 6, text: 'This is my big chorus' }, { start: 9, end: 10, text: 'Sing it back' }];
  assert.deepEqual(correction(automatic, saved), { words: 12, changed: 4, lines: 3, moved: 1 });
  assert.equal(correctionSummary(correction(automatic, saved)), 'Compared with them, your saved lyrics changed 4 of 12 words (33%) and moved 1 of 3 line starts by over half a second.');
  // Spaceless scripts count characters as words.
  assert.equal(correction([{ start: 0, end: 2, text: '今夜的月光' }], [{ start: 0, end: 2, text: '今夜的阳光' }]).changed, 1);
  assert.equal(correctionSummary(correction([], saved)), '');
});
