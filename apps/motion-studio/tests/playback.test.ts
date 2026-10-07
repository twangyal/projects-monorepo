import assert from 'node:assert/strict';
import test from 'node:test';
import { playbackFrame } from '../src/playback.ts';

test('playback keeps its starting frame when the first callback precedes its clock', () => {
  assert.equal(playbackFrame(0, -.1), 0);
  assert.equal(playbackFrame(5, -100), 5);
});
test('playback advances from the selected frame without changing endpoint or loop arithmetic', () => {
  assert.equal(playbackFrame(0, 0), 0);
  assert.equal(playbackFrame(0, 250), 3);
  assert.equal(playbackFrame(5, 250), 8);
  assert.equal(playbackFrame(0, 1000), 12);
});
