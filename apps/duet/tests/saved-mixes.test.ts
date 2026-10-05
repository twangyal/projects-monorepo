import assert from 'node:assert/strict';
import test from 'node:test';
import { mixCommand, playlistChange, validateSavedMixFields, type MixSnapshot } from '../src/saved-mixes.ts';
const a = 'a'.repeat(32), b = 'b'.repeat(32), c = 'c'.repeat(32);
function fields() { return { savedMixesRevision: 7, savedMixes: [{ id: c, name: '  Trip 🎵  ', entries: [{ trackId: a, title: '<song>', artist: '' }, { trackId: b, title: 'Two', artist: 'Artist' }] }] }; }
function snapshot(): MixSnapshot { return { ...fields(), playlist: [b, a], playlistRevision: 11, playback: { revision: 13 }, tracks: [{ id: a }] }; }
test('literal fields retain order, labels, Unicode and missing references while detaching', () => {
  const original = fields(), admitted = validateSavedMixFields(original);
  assert.deepEqual(admitted, original); original.savedMixes[0].entries[0].title = 'changed';
  assert.equal(admitted.savedMixes[0].entries[0].title, '<song>');
});
test('eight mixes and twelve distinct references are admitted; exceeded and duplicate bounds reject', () => {
  const maximum = { savedMixesRevision: Number.MAX_SAFE_INTEGER, savedMixes: Array.from({ length: 8 }, (_, i) => ({ id: i.toString(16).padStart(32, '0'), name: '🎵'.repeat(80), entries: Array.from({ length: 12 }, (_, j) => ({ trackId: j.toString(16).padStart(32, '0'), title: 'x', artist: '' })) })) };
  assert.equal(validateSavedMixFields(maximum).savedMixes.length, 8);
  assert.throws(() => validateSavedMixFields({ ...maximum, savedMixes: [...maximum.savedMixes, maximum.savedMixes[0]] }));
  const bad = structuredClone(maximum); bad.savedMixes[0].entries.push(bad.savedMixes[0].entries[0]); assert.throws(() => validateSavedMixFields(bad));
  bad.savedMixes[0].entries.pop(); bad.savedMixes[1].id = bad.savedMixes[0].id; assert.throws(() => validateSavedMixFields(bad));
});
test('exact keys, safe revisions, literal text and nonempty mixes reject malformed public data', () => {
  for (const bad of [null, { ...fields(), savedMixesRevision: -1 }, { ...fields(), savedMixesRevision: 1.5 }, { ...fields(), extra: 0 }, { ...fields(), savedMixes: [{ ...fields().savedMixes[0], available: true }] }]) assert.throws(() => validateSavedMixFields(bad));
  for (const name of ['', ' \t ', 'x'.repeat(81), '\u0000', '\ud800']) assert.throws(() => validateSavedMixFields({ ...fields(), savedMixes: [{ ...fields().savedMixes[0], name }] }));
  assert.throws(() => validateSavedMixFields({ ...fields(), savedMixes: [{ ...fields().savedMixes[0], entries: [] }] }));
  const bad = fields(); (bad.savedMixes[0].entries[0] as Record<string, unknown>).available = false; assert.throws(() => validateSavedMixFields(bad));
});
test('save and update capture displayed playlist and library revisions, never client labels', () => {
  const source = snapshot(), save = mixCommand(source, 'save', undefined, '  Date  '), update = mixCommand(source, 'update', c);
  assert.deepEqual(save, { suffix: '/mixes', method: 'POST', body: { name: '  Date  ', playlistRevision: 11, savedMixesRevision: 7 } });
  assert.deepEqual(update, { suffix: `/mixes/${c}/playlist`, method: 'PUT', body: { playlistRevision: 11, savedMixesRevision: 7 } });
  source.playlistRevision = 99; source.savedMixesRevision = 99; assert.equal(save.body.playlistRevision, 11);
  assert.throws(() => mixCommand({ ...source, playlist: [] }, 'save', undefined, 'Empty'));
});
test('rename/delete leave active revisions out; load captures all three and explicit consent', () => {
  assert.deepEqual(mixCommand(snapshot(), 'rename', c, 'New').body, { name: 'New', savedMixesRevision: 7 });
  assert.deepEqual(mixCommand(snapshot(), 'delete', c).body, { savedMixesRevision: 7 });
  assert.throws(() => mixCommand(snapshot(), 'load', c), /unavailable/i);
  assert.deepEqual(mixCommand(snapshot(), 'load', c, undefined, true).body, { savedMixesRevision: 7, playlistRevision: 11, playbackRevision: 13, availableOnly: true });
  assert.throws(() => mixCommand({ ...snapshot(), tracks: [] }, 'load', c, undefined, true), /available/i);
  assert.throws(() => mixCommand(snapshot(), 'delete', a), /selected/i);
});
test('current membership/reorder returns captured detached order and no-op bounds never mutate', () => {
  const original = [a, b]; assert.deepEqual(playlistChange(original, 9, c, 'add'), { trackIds: [a, b, c], revision: 9 });
  assert.deepEqual(playlistChange(original, 9, a, 'remove'), { trackIds: [b], revision: 9 });
  assert.deepEqual(playlistChange(original, 9, b, 'up'), { trackIds: [b, a], revision: 9 });
  assert.equal(playlistChange(original, 9, a, 'up'), null); assert.equal(playlistChange(original, 9, a, 'add'), null); assert.deepEqual(original, [a, b]);
});
