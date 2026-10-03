import assert from 'node:assert/strict';
import test from 'node:test';
import { clockOffset, estimatedPosition, type SyncSnapshot } from '../src/sync.ts';

function snapshot(playing = true, position = 2): SyncSnapshot {
  return {
    serverTime: 10_000,
    playback: { trackId: 'a'.repeat(32), playing, position, revision: 1 },
    tracks: [{ id: 'a'.repeat(32), title: 'Native fixture', artist: '', duration: 10, uploadedBy: 'host', createdAt: 0 }],
  };
}

test('clock offset uses the request midpoint and preserves its sign', () => {
  assert.equal(clockOffset(1100, 900, 1100), 100);
  assert.equal(clockOffset(900, 900, 1100), -100);
  assert.equal(clockOffset(1000, 1000, 1000), 0);
});

test('clock offset rejects nonfinite and reversed request timestamps', () => {
  for (const [server, start, end] of [[NaN, 0, 1], [0, Infinity, 1], [0, 0, -Infinity], [0, 2, 1]]) {
    assert.throws(() => clockOffset(server, start, end), /finite|timestamp|request/i);
  }
});

test('playing positions extrapolate server time while paused positions stay fixed', () => {
  assert.equal(estimatedPosition(snapshot(), 12_500), 4.5);
  assert.equal(estimatedPosition(snapshot(false), 12_500), 2);
  assert.equal(estimatedPosition(snapshot(), 9000), 2);
});

test('positions clamp at the selected duration and unavailable tracks return zero', () => {
  assert.equal(estimatedPosition(snapshot(), 30_000), 10);
  assert.equal(estimatedPosition(snapshot(false, -5), 10_000), 0);
  assert.equal(estimatedPosition(snapshot(false, 50), 10_000), 10);
  const missing = snapshot();
  missing.tracks = [];
  assert.equal(estimatedPosition(missing, 20_000), 0);
  missing.playback.trackId = null;
  assert.equal(estimatedPosition(missing, 20_000), 0);
});

test('position estimation validates finite timing and selected track duration', () => {
  for (const bad of [
    { ...snapshot(), serverTime: NaN },
    { ...snapshot(), playback: { ...snapshot().playback, position: Infinity } },
    { ...snapshot(), tracks: [{ ...snapshot().tracks[0], duration: 0 }] },
    { ...snapshot(), tracks: [{ ...snapshot().tracks[0], duration: NaN }] },
  ]) assert.throws(() => estimatedPosition(bad, 20_000), /finite|duration/i);
  assert.throws(() => estimatedPosition(snapshot(), Infinity), /finite|time/i);
});

test('estimating a position never changes the supplied snapshot', () => {
  const source = snapshot();
  const original = structuredClone(source);
  estimatedPosition(source, 20_000);
  assert.deepEqual(source, original);
});
