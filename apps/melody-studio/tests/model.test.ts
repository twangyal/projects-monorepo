import assert from 'node:assert/strict';
import test from 'node:test';
import { compositionDurationBeats, createComposition, createDemoComposition, createNote, createTrack, parseComposition, serializeComposition, validateComposition } from '../src/model.ts';
import type { Composition } from '../src/types.ts';

const fixture = (): Composition => ({ version: 1, title: 'Sketch', tempo: 120, tracks: [{ id: 'track', name: 'Melody', instrument: 'sine', volume: 0.8, muted: false, notes: [{ id: 'note', pitch: 60, start: 0, duration: 1, velocity: 0.75 }] }] });

test('factories produce independent valid compositions, tracks and notes', () => {
  const project = createComposition();
  assert.deepEqual(validateComposition(project), project);
  assert.equal(project.tracks.length, 1);
  const track = createTrack(' Harmony ');
  assert.equal(track.name, 'Harmony');
  const note = createNote(72, 4);
  assert.equal(note.pitch, 72);
  assert.equal(note.start, 4);
  assert.notEqual(note.id, createNote().id);
  assert.notEqual(track.id, createTrack().id);
  assert.notEqual(project.tracks[0].id, createComposition().tracks[0].id);
  assert.throws(() => createNote(128));
  assert.throws(() => createNote(60, 128));
});

test('demo contains distinct layered musical tracks and has an actual duration', () => {
  const demo = createDemoComposition();
  assert.deepEqual(validateComposition(demo), demo);
  assert.ok(demo.tracks.length >= 2);
  assert.ok(demo.tracks.every(track => track.notes.length > 0));
  assert.ok(compositionDurationBeats(demo) > 0);
  assert.equal(compositionDurationBeats(createComposition()), 0);
  const project = fixture();
  project.tracks[0].notes.push({ ...createNote(), start: 5, duration: 2 });
  assert.equal(compositionDurationBeats(project), 7);
});

test('validation reconstructs safe values, trims names, strips extras and avoids aliases', () => {
  const source = { ...fixture(), title: ' Sketch ', injected: true };
  Object.assign(source.tracks[0], { name: ' Melody ', injected: true });
  Object.assign(source.tracks[0].notes[0], { injected: true });
  const valid = validateComposition(source);
  assert.deepEqual(valid, fixture());
  valid.tracks[0].notes[0].pitch = 72;
  assert.equal(source.tracks[0].notes[0].pitch, 60);
  assert.equal(Object.getPrototypeOf(valid), Object.prototype);
});

test('versioned JSON round trips only validated project properties', () => {
  const project = fixture();
  assert.deepEqual(parseComposition(serializeComposition(project)), project);
  const withExtras = Object.assign(project, { untrusted: 'drop' });
  assert.equal(serializeComposition(withExtras).includes('untrusted'), false);
  assert.throws(() => parseComposition('{broken'), /JSON|project|composition/i);
  assert.throws(() => parseComposition(' '.repeat(1_048_577)), /large|size|MiB|limit/i);
  assert.throws(() => parseComposition('"' + 'é'.repeat(524_288) + '"'), /large|size|MiB|limit/i);
  assert.throws(() => serializeComposition({ ...project, tempo: NaN }));
});

test('all bounded values accept exact boundaries', () => {
  const project = fixture();
  project.tempo = 40;
  project.title = 'x'.repeat(80);
  project.tracks[0].volume = 0;
  project.tracks[0].id = 'x'.repeat(100);
  project.tracks[0].notes = [{ id: 'a', pitch: 36, start: 0, duration: 0.25, velocity: 0 }, { id: 'b', pitch: 96, start: 112, duration: 16, velocity: 1 }];
  assert.deepEqual(validateComposition(project), project);
  project.tempo = 240;
  project.tracks[0].volume = 1;
  assert.deepEqual(validateComposition(project), project);
});

test('validation rejects malformed structures, duplicate IDs and every numeric boundary', () => {
  assert.deepEqual(validateComposition(fixture()), fixture());
  const invalid: unknown[] = [null, [], {}, { ...fixture(), version: 2 }, { ...fixture(), title: '' }, { ...fixture(), title: ' ' }, { ...fixture(), title: 'x'.repeat(81) }, { ...fixture(), tracks: [] }, { ...fixture(), tracks: [null] }];
  for (const tempo of [39, 241, NaN, Infinity, '120']) invalid.push({ ...fixture(), tempo });
  for (const field of ['id', 'name', 'instrument', 'volume', 'muted', 'notes']) {
    const values: Record<string, unknown[]> = { id: ['', 'x'.repeat(101)], name: ['', ' ', 'x'.repeat(81)], instrument: ['piano'], volume: [-0.01, 1.01, NaN], muted: [0], notes: [null, {}] };
    for (const value of values[field]) {
      const project = fixture();
      Object.assign(project.tracks[0], { [field]: value });
      invalid.push(project);
    }
  }
  for (const [field, values] of Object.entries({ id: ['', 'x'.repeat(101)], pitch: [35, 97, 60.5, NaN], start: [-0.01, 128, Infinity], duration: [0, 0.24, 16.01, NaN], velocity: [-0.01, 1.01, Infinity] })) {
    for (const value of values) {
      const project = fixture();
      Object.assign(project.tracks[0].notes[0], { [field]: value });
      invalid.push(project);
    }
  }
  const beyondEnd = fixture();
  Object.assign(beyondEnd.tracks[0].notes[0], { start: 127.9, duration: 0.25 });
  invalid.push(beyondEnd);
  const duplicate = fixture();
  duplicate.tracks[0].notes[0].id = 'track';
  invalid.push(duplicate);
  const duplicateAcrossTracks = fixture();
  duplicateAcrossTracks.tracks.push({ ...duplicateAcrossTracks.tracks[0], id: 'another-track' });
  invalid.push(duplicateAcrossTracks);
  for (const value of invalid) assert.throws(() => validateComposition(value));
});

test('track and note limits allow maximum size but reject overflow', () => {
  const project = fixture();
  project.tracks = Array.from({ length: 8 }, (_, track) => ({ ...project.tracks[0], id: `track-${track}`, notes: Array.from({ length: 256 }, (_, note) => ({ ...project.tracks[0].notes[0], id: `note-${track}-${note}` })) }));
  assert.equal(validateComposition(project).tracks.length, 8);
  project.tracks[0].notes.push(createNote());
  assert.throws(() => validateComposition(project));
  project.tracks[0].notes.pop();
  project.tracks.push(createTrack());
  assert.throws(() => validateComposition(project));
});

test('validation rejects sparse arrays instead of reconstructing missing tracks or notes', () => {
  const project = fixture();
  project.tracks = new Array(1);
  assert.throws(() => validateComposition(project));
  const notes = fixture();
  notes.tracks[0].notes = new Array(1);
  assert.throws(() => validateComposition(notes));
});
