import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecognitionPreview } from '../src/recognition-preview.ts';

const transcript = { available: true, model: 'local', words: 1, cues: [{ start: 1, end: 2, text: 'hello', confidence: 0.9, words: [{ text: 'hello', start: 1, end: 2, confidence: 0.9 }] }] };
const preview = { available: true, candidateId: 'a'.repeat(64), referenceId: 'b'.repeat(64), current: transcript, candidate: transcript };
test('recognition comparison parses two bounded readings and an absent candidate', () => {
  assert.deepEqual(parseRecognitionPreview(preview, 4), preview);
  assert.deepEqual(parseRecognitionPreview({ available: false }, 4), { available: false });
});
test('recognition comparison refuses malformed identities and unbounded or invalid words', () => {
  for (const candidateId of ['', 'x'.repeat(64), 3, null]) assert.throws(() => parseRecognitionPreview({ ...preview, candidateId }, 4));
  assert.throws(() => parseRecognitionPreview({ ...preview, extra: true }, 4));
  assert.throws(() => parseRecognitionPreview({ ...preview, candidate: { ...transcript, cues: [{ ...transcript.cues[0], text: 'x'.repeat(241) }] } }, 4));
  assert.throws(() => parseRecognitionPreview(preview, 1));
});
test('a first staged reading may have no accepted reference but must contain a candidate', () => {
  assert.deepEqual(parseRecognitionPreview({ ...preview, referenceId: null, current: { available: false } }, 4), { ...preview, referenceId: null, current: { available: false } });
  assert.throws(() => parseRecognitionPreview({ ...preview, candidate: { available: false } }, 4));
});
