import assert from 'node:assert/strict';
import test from 'node:test';
import { CompositionHistory } from '../src/history.ts';
import { serializeComposition } from '../src/model.ts';
import {
  applyContinuation, auditionComposition, fitEnding, selectEnding, suggestEnding,
} from '../src/continuation.ts';
import type { Composition, Note } from '../src/types.ts';

function fixture(count = 8, start = 0): Composition {
  const notes: Note[] = Array.from({ length: count }, (_, i) => ({
    id: `note-${i}`, pitch: i % 2 ? 62 : 60, start: start + i * .5,
    duration: .5, velocity: (i % 8 + 1) / 10,
  }));
  return { version: 1, title: 'Original test motif', tempo: 120, tracks: [
    { id: 'melody', name: 'Ending', instrument: 'triangle', volume: .7, muted: false, notes },
    { id: 'other', name: 'Other part', instrument: 'sawtooth', volume: .4, muted: false,
      notes: [{ id: 'bass', pitch: 48, start: 0, duration: 2, velocity: .8 }] },
  ] };
}

test('selects exactly the chronological suffix without changing source order or values', () => {
  const project = fixture(10);
  project.tracks[0].notes.reverse();
  const before = structuredClone(project);
  const selection = selectEnding(project, 'melody', 8);
  assert.deepEqual(selection.notes.map(note => note.id), Array.from({ length: 8 }, (_, i) => `note-${i + 2}`));
  assert.equal(selection.startTick, 4);
  assert.equal(selection.endTick, 20);
  assert.equal(selection.count, 8);
  selection.notes[0].pitch = 70;
  assert.deepEqual(project, before);
});

test('accepts eight and sixty-four notes but rejects count range, fractions and unavailable tracks', () => {
  const maximum = fixture(64);
  maximum.tracks[0].notes.forEach((note, i) => { note.start = i * .25; note.duration = .25; });
  assert.equal(selectEnding(maximum, 'melody', 64).count, 64);
  for (const count of [7, 65, 8.5, NaN]) assert.throws(() => selectEnding(fixture(), 'melody', count), /8.*64|count/i);
  assert.throws(() => selectEnding(fixture(7), 'melody', 8), /enough|at least|8/i);
  assert.throws(() => selectEnding(fixture(), 'absent', 8), /track/i);
});

test('rejects exact off-grid starts and durations without quantizing accepted notes', () => {
  for (const field of ['start', 'duration'] as const) {
    const project = fixture();
    project.tracks[0].notes[1][field] += Number.EPSILON;
    assert.throws(() => selectEnding(project, 'melody', 8), /quarter|grid/i);
  }
});

test('rejects chords, overlaps and a sustaining unselected earlier note', () => {
  const chord = fixture();
  chord.tracks[0].notes[1].start = 0;
  assert.throws(() => selectEnding(chord, 'melody', 8), /overlap|simultaneous|monophonic/i);
  const overlap = fixture();
  overlap.tracks[0].notes[0].duration = .75;
  assert.throws(() => selectEnding(overlap, 'melody', 8), /overlap|monophonic/i);
  const intrusion = fixture(9);
  intrusion.tracks[0].notes[0].duration = 1;
  assert.throws(() => selectEnding(intrusion, 'melody', 8), /earlier|overlap|monophonic/i);
});

test('rejects silent seed notes and seed spans beyond sixteen beats', () => {
  const silent = fixture();
  silent.tracks[0].notes[0].velocity = 0;
  assert.throws(() => selectEnding(silent, 'melody', 8), /silent|velocity/i);
  const long = fixture();
  long.tracks[0].notes.forEach((note, i) => { note.start = i * 3; });
  assert.throws(() => selectEnding(long, 'melody', 8), /16|span/i);
});

test('fits hand-counted joint events and contexts with no final-to-first transition', () => {
  const selection = selectEnding(fixture(), 'melody', 8);
  const fitted = fitEnding(selection);
  assert.deepEqual(fitted.tokens, [[2, 2, 0], [-2, 2, 0], [2, 2, 0], [-2, 2, 0], [2, 2, 0], [-2, 2, 0], [2, 2, 0]]);
  assert.equal(fitted.transitionCount, 7);
  assert.equal(fitted.sourceNoteCount, 8);
  assert.equal(fitted.medianVelocity, .45);
  assert.deepEqual(fitted.tables[0], {
    order: 0, context: [], contextRawSupport: 7,
    outcomes: [{ token: [-2, 2, 0], count: 3 }, { token: [2, 2, 0], count: 4 }],
  });
  assert.deepEqual(fitted.tables.find(row => row.order === 2 && row.context[0][0] === -2), {
    order: 2, context: [[-2, 2, 0], [2, 2, 0]], contextRawSupport: 2,
    outcomes: [{ token: [-2, 2, 0], count: 2 }],
  });
});

test('preserves jointly observed duration and rest rather than recombining their marginals', () => {
  const project = fixture();
  let end = 0;
  project.tracks[0].notes.forEach((note, i) => {
    note.start = end + (i % 2 ? .25 : 0);
    note.duration = i % 2 ? .5 : .25;
    end = note.start + note.duration;
  });
  const fitted = fitEnding(selectEnding(project, 'melody', 8));
  assert.deepEqual(fitted.tables[0].outcomes, [
    { token: [-2, 1, 0], count: 3 }, { token: [2, 2, 1], count: 4 },
  ]);
  const proposal = suggestEnding(project, 'melody', 8, 4, 1);
  assert.deepEqual(proposal.notes.map(note => note.duration), [.25, .5, .25, .5]);
  assert.deepEqual(proposal.notes.map((note, i) => note.start - (i ? proposal.notes[i - 1].start + proposal.notes[i - 1].duration : end)), [0, .25, 0, .25]);
});

test('fitEnding revalidates caller-created selections', () => {
  const good = selectEnding(fixture(), 'melody', 8);
  for (const change of [
    (selection: typeof good) => { selection.count = 7; },
    (selection: typeof good) => { selection.startTick++; },
    (selection: typeof good) => { selection.notes[0].duration = .3; },
    (selection: typeof good) => { selection.notes[0].velocity = 0; },
    (selection: typeof good) => { selection.notes.reverse(); },
  ]) {
    const bad = structuredClone(good);
    change(bad);
    assert.throws(() => fitEnding(bad));
  }
});

test('suggests deterministic supported-context continuation with disclosed median velocity', () => {
  const project = fixture();
  const before = structuredClone(project);
  const proposal = suggestEnding(project, 'melody', 8, 4, 1);
  assert.deepEqual(proposal.notes, [
    { pitch: 60, start: 4, duration: .5, velocity: .45 },
    { pitch: 62, start: 4.5, duration: .5, velocity: .45 },
    { pitch: 60, start: 5, duration: .5, velocity: .45 },
    { pitch: 62, start: 5.5, duration: .5, velocity: .45 },
  ]);
  assert.deepEqual(proposal.steps, [2, 3, 2, 3].map(contextRawSupport => ({
    order: 2, contextRawSupport, eligibleWeight: contextRawSupport, eligibleCount: 1,
  })));
  assert.deepEqual(suggestEnding(project, 'melody', 8, 4, 1), proposal);
  proposal.base.tracks[0].notes[0].pitch = 70;
  assert.deepEqual(project, before);
});

test('rejects zero, fractional, negative and overflow uint32 seeds and unsupported output lengths', () => {
  for (const seed of [0, -1, .5, 2 ** 32, NaN, Infinity]) assert.throws(() => suggestEnding(fixture(), 'melody', 8, 4, seed), /seed|uint32/i);
  assert.equal(suggestEnding(fixture(), 'melody', 8, 8, 0xffffffff).notes.length, 8);
  assert.throws(() => suggestEnding(fixture(), 'melody', 8, 5 as 4, 1), /4.*8|length/i);
});

test('fails atomically when pitch or end-beat bounds remove all observed events', () => {
  const ascending = fixture();
  ascending.tracks[0].notes.forEach((note, i) => { note.pitch = 89 + i; });
  const before = structuredClone(ascending);
  assert.throws(() => suggestEnding(ascending, 'melody', 8, 4, 1), /pitch|range/i);
  assert.deepEqual(ascending, before);
  assert.throws(() => suggestEnding(fixture(8, 507.75), 'melody', 8, 4, 1), /time|beat|space/i);
});

test('rejects insufficient note capacity before generating', () => {
  const project = fixture(253);
  assert.throws(() => suggestEnding(project, 'melody', 8, 4, 1), /256|capacity|notes/i);
});

test('learned counts depend on selected notes; transposition and onset shifts preserve events', () => {
  const project = fixture();
  const changed = structuredClone(project);
  changed.tracks[0].notes[3].pitch = 65;
  assert.notDeepEqual(fitEnding(selectEnding(changed, 'melody', 8)).tables, fitEnding(selectEnding(project, 'melody', 8)).tables);
  const shifted = fixture(8, 2);
  shifted.tracks[0].notes.forEach(note => { note.pitch += 12; });
  const base = suggestEnding(project, 'melody', 8, 4, 41);
  const other = suggestEnding(shifted, 'melody', 8, 4, 41);
  assert.deepEqual(other.notes.map(note => ({ ...note, pitch: note.pitch - 12, start: note.start - 2 })), base.notes);
  assert.deepEqual(other.steps, base.steps);
});

test('Apply appends once with fresh IDs, preserving unrelated tracks and exact source array order', () => {
  const project = fixture();
  project.tracks[0].notes.reverse();
  const before = structuredClone(project);
  const proposal = suggestEnding(project, 'melody', 8, 4, 1);
  const result = applyContinuation(project, proposal);
  assert.deepEqual(result.tracks[0].notes.slice(0, 8), before.tracks[0].notes);
  assert.deepEqual(result.tracks[1], before.tracks[1]);
  assert.deepEqual(result.tracks[0].notes.slice(8).map(({ pitch, start, duration, velocity }) => ({ pitch, start, duration, velocity })), proposal.notes);
  const ids = result.tracks.flatMap(track => [track.id, ...track.notes.map(note => note.id)]);
  assert.equal(new Set(ids).size, ids.length);
  assert.throws(() => applyContinuation(result, proposal), /changed|stale|snapshot/i);
  assert.deepEqual(project, before);
});

test('Apply rejects any changed canonical project snapshot and a modified proposal', () => {
  const project = fixture();
  const proposal = suggestEnding(project, 'melody', 8, 4, 1);
  for (const change of [
    (value: Composition) => { value.title = 'Changed'; },
    (value: Composition) => { value.tempo++; },
    (value: Composition) => { value.tracks[1].notes[0].velocity = .2; },
    (value: Composition) => { value.tracks[0].notes.reverse(); },
  ]) {
    const changed = structuredClone(project);
    change(changed);
    assert.throws(() => applyContinuation(changed, proposal), /changed|stale|snapshot/i);
  }
  const altered = structuredClone(proposal);
  altered.notes[0].pitch = 65;
  assert.throws(() => applyContinuation(project, altered), /proposal|modified/i);
});

test('one Apply integrates as one undo/redo edit, retaining generated IDs on redo', () => {
  const project = fixture();
  const history = new CompositionHistory(project);
  const proposal = suggestEnding(project, 'melody', 8, 4, 1);
  assert.equal(history.canUndo, false);
  const accepted = applyContinuation(history.current, proposal);
  history.commit(accepted);
  assert.deepEqual(history.undo(), project);
  assert.equal(history.canUndo, false);
  assert.deepEqual(history.redo(), accepted);
});

test('audition solos and shifts seed plus proposal while preserving all sound settings', () => {
  const project = fixture(8, 12);
  project.tempo = 40;
  project.tracks[0].muted = true;
  project.tracks[0].volume = 0;
  const before = structuredClone(project);
  const proposal = suggestEnding(project, 'melody', 8, 4, 1);
  const audition = auditionComposition(proposal);
  assert.equal(audition.tracks.length, 1);
  assert.equal(audition.tempo, 40);
  assert.equal(audition.tracks[0].instrument, 'triangle');
  assert.equal(audition.tracks[0].muted, true);
  assert.equal(audition.tracks[0].volume, 0);
  assert.deepEqual(audition.tracks[0].notes.slice(0, 8), project.tracks[0].notes.map(note => ({ ...note, start: note.start - 12 })));
  assert.deepEqual(audition.tracks[0].notes.slice(8).map(({ pitch, start, duration, velocity }) => ({ pitch, start, duration, velocity })), proposal.notes.map(note => ({ ...note, start: note.start - 12 })));
  assert.equal(new Set(audition.tracks[0].notes.map(note => note.id)).size, 12);
  assert.deepEqual(project, before);
  assert.equal(serializeComposition(project), serializeComposition(proposal.base));
});

test('scratch IDs avoid colliding with source IDs without reserving applied UUIDs', () => {
  const project = fixture();
  project.tracks[0].notes[0].id = 'continuation-scratch-0';
  project.tracks[1].id = 'continuation-scratch-1';
  const proposal = suggestEnding(project, 'melody', 8, 4, 1);
  const audition = auditionComposition(proposal);
  assert.equal(audition.tracks[0].notes.length, 12);
  assert.equal(new Set([audition.tracks[0].id, ...audition.tracks[0].notes.map(note => note.id)]).size, 13);
});

test('Apply retries a UUID collision but fails boundedly without mutation on a broken provider', t => {
  const project = fixture();
  const realUuid = crypto.randomUUID.bind(crypto);
  const collision = realUuid();
  project.tracks[1].id = collision;
  const proposal = suggestEnding(project, 'melody', 8, 4, 1);
  let calls = 0;
  const replacement = t.mock.method(crypto, 'randomUUID', () => ++calls === 1 ? collision : realUuid());
  const accepted = applyContinuation(project, proposal);
  assert.equal(calls, 5);
  assert.equal(new Set(accepted.tracks.flatMap(track => [track.id, ...track.notes.map(note => note.id)])).size, 15);
  replacement.mock.restore();
  const before = structuredClone(project);
  calls = 0;
  t.mock.method(crypto, 'randomUUID', () => { calls++; return collision; });
  assert.throws(() => applyContinuation(project, proposal), /distinct.*IDs|allocate/i);
  assert.equal(calls, 16);
  assert.deepEqual(project, before);
});
