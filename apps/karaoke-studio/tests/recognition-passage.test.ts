import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecognitionPassage, recognitionRange } from '../src/recognition-passage.ts';

const candidate = { available: true, model: 'local', words: 1, cues: [{ start: 5, end: 6, text: 'hello', confidence: 0.9, words: [{ text: 'hello', start: 5.1, end: 5.9, confidence: 0.9 }] }] };
const passage = { available: true, candidateId: 'a'.repeat(64), start: 5, end: 10, candidate };
test('passage preview keeps absolute song times within the selected passage', () => {
  assert.deepEqual(parseRecognitionPassage(passage, 20), passage);
  assert.deepEqual(parseRecognitionPassage({ available: false }, 20), { available: false });
  for (const bad of [
    { ...passage, start: 6 }, { ...passage, end: 4 }, { ...passage, end: 21 },
    { ...passage, candidateId: '' }, { ...passage, extra: true },
    { ...passage, candidate: { available: false } },
    { ...passage, candidate: { ...candidate, cues: [{ ...candidate.cues[0], words: [{ ...candidate.cues[0].words[0], start: 4 }] }] } },
  ]) assert.throws(() => parseRecognitionPassage(bad, 20));
});
test('passage controls reject blank, nonfinite and out-of-clip times and bound the retry to 1–60 seconds', () => {
  assert.deepEqual(recognitionRange('5', '10', 20), { start: 5, end: 10 });
  assert.deepEqual(recognitionRange('0', '60', 80), { start: 0, end: 60 });
  for (const [a, b] of [['', '5'], ['0', ''], ['NaN', '5'], ['0', 'Infinity'], ['-1', '5'], ['5', '5'], ['0', '.5'], ['0', '61'], ['5', '21']]) assert.throws(() => recognitionRange(a, b, 20));
});
