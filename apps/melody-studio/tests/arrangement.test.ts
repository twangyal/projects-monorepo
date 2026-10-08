import assert from 'node:assert/strict';
import test from 'node:test';
import { duplicateTrack, repeatTrack, transposeTrack } from '../src/arrangement.ts';
import { validateComposition } from '../src/model.ts';
import type { Composition, Note } from '../src/types.ts';

const note = (id: string, pitch = 60, start = 0, duration = 1): Note => ({ id, pitch, start, duration, velocity: 0.65 });
const noteProperties = ({ pitch, start, duration, velocity }: Note) => ({ pitch, start, duration, velocity });
const fixture = (): Composition => ({
  version: 1, title: 'Arrangement', tempo: 108,
  tracks: [
    { id: 'melody', name: 'Melody', instrument: 'triangle', volume: 0.45, muted: true, notes: [note('first', 60, 2), note('second', 67, 4, 2)] },
    { id: 'bass', name: 'Bass', instrument: 'sawtooth', volume: 0.3, muted: false, notes: [note('bass-note', 48)] },
  ],
});

function freeze(project: Composition): Composition {
  for (const track of project.tracks) {
    track.notes.forEach(Object.freeze);
    Object.freeze(track.notes);
    Object.freeze(track);
  }
  Object.freeze(project.tracks);
  return Object.freeze(project);
}

function assertIndependent(source: Composition, result: Composition): void {
  assert.notEqual(result, source);
  assert.notEqual(result.tracks, source.tracks);
  for (const track of source.tracks) {
    const matching = result.tracks.find(candidate => candidate.id === track.id)!;
    assert.notEqual(matching, track);
    assert.notEqual(matching.notes, track.notes);
    track.notes.forEach((original, index) => assert.notEqual(matching.notes[index], original));
  }
  assert.deepEqual(validateComposition(result), result);
}

test('duplicate inserts an independent copy after the source with fresh IDs and identical sound and notes', () => {
  const project = freeze(fixture());
  const before = structuredClone(project);
  const result = duplicateTrack(project, 'melody');
  const copy = result.tracks[1];
  assert.deepEqual(result.tracks.map(track => track.name), ['Melody', 'Melody copy', 'Bass']);
  assert.equal(copy.instrument, 'triangle');
  assert.equal(copy.volume, 0.45);
  assert.equal(copy.muted, true);
  assert.deepEqual(copy.notes.map(noteProperties), project.tracks[0].notes.map(noteProperties));
  const oldIds = new Set(project.tracks.flatMap(track => [track.id, ...track.notes.map(note => note.id)]));
  for (const id of [copy.id, ...copy.notes.map(note => note.id)]) assert.ok(!oldIds.has(id));
  assert.equal(new Set([copy.id, ...copy.notes.map(note => note.id)]).size, 3);
  assert.notEqual(copy.id, duplicateTrack(project, 'melody').tracks[1].id);
  assertIndependent(project, result);
  result.tracks[0].notes[0].pitch = 72;
  result.tracks[1].notes[1].duration = 3;
  result.tracks[2].volume = 0.9;
  assert.equal(copy.notes[0].pitch, 60);
  assert.deepEqual(project, before);
});

test('duplicate truncates the source name to keep the copy suffix within 80 characters', () => {
  const project = fixture();
  project.tracks[0].name = 'x'.repeat(80);
  assert.equal(duplicateTrack(project, 'melody').tracks[1].name, 'x'.repeat(75) + ' copy');
});

test('duplicate accepts empty tracks and a resulting maximum of eight tracks', () => {
  const project = fixture();
  project.tracks = Array.from({ length: 7 }, (_, index) => ({ ...project.tracks[0], id: `track-${index}`, notes: [] }));
  const result = duplicateTrack(project, 'track-6');
  assert.equal(result.tracks.length, 8);
  assert.deepEqual(result.tracks[7].notes, []);
  assert.equal(result.tracks[7].name, 'Melody copy');
  const before = structuredClone(result);
  assert.throws(() => duplicateTrack(freeze(result), 'track-6'), /8|eight|track.*limit/i);
  assert.deepEqual(result, before);
});

test('transpose permits the four supported intervals and preserves everything except selected pitches', () => {
  for (const semitones of [-12, -1, 1, 12]) {
    const project = freeze(fixture());
    const expected = structuredClone(project);
    expected.tracks[0].notes.forEach(note => { note.pitch += semitones; });
    const result = transposeTrack(project, 'melody', semitones);
    assert.deepEqual(result, expected);
    assertIndependent(project, result);
    assert.deepEqual(project, fixture());
  }
});

test('transpose accepts exact minimum and maximum pitches for octave and semitone shifts', () => {
  for (const [pitch, semitones, expected] of [[48, -12, 36], [37, -1, 36], [95, 1, 96], [84, 12, 96]]) {
    const project = fixture();
    project.tracks[0].notes = [note('boundary', pitch)];
    assert.equal(transposeTrack(project, 'melody', semitones).tracks[0].notes[0].pitch, expected);
  }
});

test('transpose rejects unsupported intervals and empty tracks', () => {
  const project = freeze(fixture());
  for (const semitones of [0, -13, -2, 2, 13, 0.5, NaN, Infinity]) {
    assert.throws(() => transposeTrack(project, 'melody', semitones), /semitone|interval|transpose/i);
  }
  const empty = fixture();
  empty.tracks[0].notes = [];
  assert.throws(() => transposeTrack(empty, 'melody', 1), /empty|note/i);
});

test('transpose rejects any out-of-range note atomically without changing any input', () => {
  for (const [pitch, semitones] of [[36, -1], [47, -12], [96, 1], [85, 12]]) {
    const project = fixture();
    project.tracks[0].notes.push(note('outside', pitch));
    const before = structuredClone(project);
    assert.throws(() => transposeTrack(freeze(project), 'melody', semitones), /pitch|36|96|range/i);
    assert.deepEqual(project, before);
  }
});

test('repeat appends an unsorted polyphonic phrase by its full span and preserves leading rest only once', () => {
  const project = fixture();
  project.tracks[0].notes = [note('late', 72, 6, 2), note('early', 60, 2, 4), note('overlap', 64, 4, 1)];
  const before = structuredClone(project);
  const result = repeatTrack(freeze(project), 'melody');
  const track = result.tracks[0];
  assert.deepEqual(track.notes.slice(0, 3), before.tracks[0].notes);
  assert.deepEqual(track.notes.slice(3).map(noteProperties), [
    { pitch: 72, start: 12, duration: 2, velocity: 0.65 },
    { pitch: 60, start: 8, duration: 4, velocity: 0.65 },
    { pitch: 64, start: 10, duration: 1, velocity: 0.65 },
  ]);
  assert.equal(track.name, 'Melody');
  assert.equal(track.instrument, 'triangle');
  assert.equal(track.volume, 0.45);
  assert.equal(track.muted, true);
  assert.deepEqual(result.tracks[1], before.tracks[1]);
  const ids = result.tracks.flatMap(track => [track.id, ...track.notes.map(note => note.id)]);
  assert.equal(new Set(ids).size, ids.length);
  const again = repeatTrack(project, 'melody');
  track.notes.slice(3).forEach((copy, index) => assert.notEqual(copy.id, again.tracks[0].notes[index + 3].id));
  assertIndependent(project, result);
  result.tracks[0].notes[0].pitch = 80;
  assert.equal(track.notes[3].pitch, 72);
  assert.deepEqual(project, before);
});

test('repeat preserves rests inside a phrase and handles fractional timing', () => {
  const project = fixture();
  project.tracks[0].notes = [note('one', 60, 2.5, 0.25), note('two', 64, 5, 0.5)];
  const result = repeatTrack(project, 'melody');
  assert.deepEqual(result.tracks[0].notes.map(note => note.start), [2.5, 5, 5.5, 8]);
});

test('repeat accepts exactly 256 resulting notes and an end at beat 128', () => {
  const project = fixture();
  project.tracks[0].notes = Array.from({ length: 128 }, (_, index) => note(`note-${index}`, 96, 96, 16));
  const result = repeatTrack(project, 'melody');
  assert.equal(result.tracks[0].notes.length, 256);
  assert.ok(result.tracks[0].notes.slice(128).every(note => note.start === 112 && note.start + note.duration === 128));
  assert.deepEqual(validateComposition(result), result);
});

test('repeat rejects empty tracks, note overflow and beat overflow without partial changes', () => {
  for (const notes of [[], Array.from({ length: 129 }, (_, index) => note(`note-${index}`)), [note('late', 60, 480.25, 16)]]) {
    const project = fixture();
    project.tracks[0].notes = notes;
    const before = structuredClone(project);
    assert.throws(() => repeatTrack(freeze(project), 'melody'), /empty|note|256|128|beat/i);
    assert.deepEqual(project, before);
  }
});

test('all transforms reject missing tracks and validate the entire input composition', () => {
  const transforms = [duplicateTrack, (project: Composition, id: string) => transposeTrack(project, id, 1), repeatTrack];
  for (const transform of transforms) {
    assert.throws(() => transform(freeze(fixture()), 'missing'), /track|found|exist/i);
    for (const invalid of [
      { ...fixture(), tempo: NaN },
      { ...fixture(), tracks: [] },
      { ...fixture(), version: 2 },
      { ...fixture(), title: '' },
    ]) assert.throws(() => transform(invalid as Composition, 'melody'));
    const project = fixture();
    project.tracks[1].notes[0].pitch = 97;
    const before = structuredClone(project);
    assert.throws(() => transform(freeze(project), 'melody'), /pitch|96/i);
    assert.deepEqual(project, before);
    const duplicateId = fixture();
    duplicateId.tracks[1].notes[0].id = 'first';
    assert.throws(() => transform(duplicateId, 'melody'), /ID/i);
  }
});
