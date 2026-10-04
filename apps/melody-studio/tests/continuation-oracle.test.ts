import assert from 'node:assert/strict';
import test from 'node:test';
import { selectEnding, fitEnding, suggestEnding, applyContinuation, auditionComposition } from '../src/continuation.ts';
import { CompositionHistory } from '../src/history.ts';
import { serializeComposition } from '../src/model.ts';
import type { Composition, Note } from '../src/types.ts';
import type { JointToken } from '../src/continuation.ts';

// These fixtures encode authored event sequences, not a second fitting/generation implementation.
const A: JointToken = [2, 1, 0];
const B: JointToken = [-2, 2, 1];
function phrase(tokens: JointToken[], firstPitch = 60, firstStart = 2): Composition {
  const notes: Note[] = [{ id: 'n0', pitch: firstPitch, start: firstStart, duration: 0.25, velocity: 0.5 }];
  for (const [interval, duration, rest] of tokens) {
    const previous = notes.at(-1)!;
    notes.push({ id: `n${notes.length}`, pitch: previous.pitch + interval,
      start: previous.start + previous.duration + rest / 4, duration: duration / 4, velocity: 0.5 });
  }
  return { version: 1, title: 'Independent continuation oracle', tempo: 80,
    tracks: [{ id: 'lead', name: 'Lead', instrument: 'triangle', volume: 0.6, muted: false, notes },
      { id: 'other', name: 'Other', instrument: 'sawtooth', volume: 0.3, muted: false,
        notes: [{ id: 'bass', pitch: 48, start: 0, duration: 2, velocity: 0.7 }] }] };
}
const alternating = () => phrase([A, B, A, B, A, B, A]);
const geometry = (notes: Omit<Note, 'id'>[]) => notes.map(({ pitch, start, duration }) => [pitch, start, duration]);

// Altering context counting, learning an artificial wraparound, or splitting joint tokens fails this table.
test('oracle counts ABABABA at all orders without an end-to-start transition', () => {
  const project = alternating();
  project.tracks[0].notes.forEach((note, i) => { note.velocity = (i + 1) / 8; });
  const before = structuredClone(project);
  const fitted = fitEnding(selectEnding(project, 'lead', 8));
  assert.equal(fitted.sourceNoteCount, 8);
  assert.equal(fitted.transitionCount, 7);
  assert.deepEqual(fitted.tokens, [A, B, A, B, A, B, A]);
  assert.equal(fitted.medianVelocity, 0.5625);
  assert.deepEqual(fitted.tables, [
    { order: 0, context: [], contextRawSupport: 7, outcomes: [{ token: B, count: 3 }, { token: A, count: 4 }] },
    { order: 1, context: [B], contextRawSupport: 3, outcomes: [{ token: A, count: 3 }] },
    { order: 1, context: [A], contextRawSupport: 3, outcomes: [{ token: B, count: 3 }] },
    { order: 2, context: [B, A], contextRawSupport: 2, outcomes: [{ token: B, count: 2 }] },
    { order: 2, context: [A, B], contextRawSupport: 3, outcomes: [{ token: A, count: 3 }] },
  ]);
  assert.equal(fitted.tables.reduce((sum, row) => sum + row.contextRawSupport, 0), 18);
  assert.deepEqual(project, before);
});

test('oracle extends the joint interval-duration-rest pattern with raw support two then three', () => {
  const project = alternating();
  const proposal = suggestEnding(project, 'lead', 8, 4, 1);
  assert.deepEqual(geometry(proposal.notes), [[60, 5.75, 0.5], [62, 6.25, 0.25], [60, 6.75, 0.5], [62, 7.25, 0.25]]);
  assert.deepEqual(proposal.steps, [2, 3, 2, 3].map(support => ({ order: 2, contextRawSupport: support, eligibleWeight: support, eligibleCount: 1 })));
  assert.deepEqual(proposal.notes.map(note => note.velocity), [0.5, 0.5, 0.5, 0.5]);
});

// The final BA context appears once, so even its deterministic successor must be ignored.
test('oracle requires two raw observations before retaining a higher-order context', () => {
  const C: JointToken = [0, 1, 0];
  const project = phrase([A, B, A, C, A, B, A]);
  const result = suggestEnding(project, 'lead', 8, 4, 1);
  assert.deepEqual(result.steps, [
    { order: 1, contextRawSupport: 3, eligibleWeight: 3, eligibleCount: 2 },
    { order: 2, contextRawSupport: 2, eligibleWeight: 2, eligibleCount: 1 },
    { order: 1, contextRawSupport: 3, eligibleWeight: 3, eligibleCount: 2 },
    { order: 2, contextRawSupport: 2, eligibleWeight: 2, eligibleCount: 1 },
  ]);
  // Four +2 events and two -2 events leave the seed at64; continuation starts at62.
  assert.deepEqual(result.notes.map(note => note.pitch), [62, 64, 62, 64]);
});

test('oracle weighted draws obey strict cumulative boundaries and numeric tuple ordering', () => {
  const flat: JointToken = [0, 1, 0];
  const rise: JointToken = [1, 2, 1];
  const fall: JointToken = [-1, 3, 0];
  // Eight observations: fall=1, flat=6, rise=1. Final context has no successor.
  const project = phrase([flat, flat, flat, rise, flat, flat, flat, fall]);
  // Seeds were obtained by reversing the three specified XOR operations independently.
  // First states are 2^29-1, 2^29, 2^29+1, 7*2^29-1, 7*2^29, 7*2^29+1.
  const cases = [
    [2959903975, 59, 5.25, 0.75], [570429440, 60, 5.25, 0.25], [3501561129, 60, 5.25, 0.25],
    [2087513319, 60, 5.25, 0.25], [3993006080, 61, 5.5, 0.5], [481686825, 61, 5.5, 0.5],
  ];
  for (const [seed, pitch, start, duration] of cases) {
    const result = suggestEnding(project, 'lead', 9, 4, seed);
    assert.deepEqual(geometry(result.notes)[0], [pitch, start, duration], `seed ${seed}`);
    assert.deepEqual(result.steps[0], { order: 0, contextRawSupport: 8, eligibleWeight: 8, eligibleCount: 3 });
  }
});

test('oracle sorts positive intervals numerically rather than as string keys', () => {
  const project = phrase([2, 2, -12, 2, 2, 2, 10, 0].map(interval => [interval, 1, 0] as JointToken));
  const result = suggestEnding(project, 'lead', 9, 4, 3993006080);
  // First draw7/8: cumulative counts [-12:1,0:1,2:5] end exactly there; choose+10.
  assert.equal(result.notes[0].pitch, 78);
  assert.deepEqual(result.steps[0], { order: 0, contextRawSupport: 8, eligibleWeight: 8, eligibleCount: 4 });
});

test('oracle exposes raw support separately from eligible weights after a pitch-bound filter', () => {
  const up: JointToken = [1, 1, 0];
  const down: JointToken = [-3, 1, 0];
  const project = phrase([up, up, up, down, up, up, up], 93);
  const result = suggestEnding(project, 'lead', 8, 4, 1);
  // PP has two P outcomes and one M; P would move 96 to97 and is removed.
  assert.equal(result.notes[0].pitch, 93);
  assert.deepEqual(result.steps[0], { order: 2, contextRawSupport: 3, eligibleWeight: 1, eligibleCount: 1 });
});

test('oracle outputs depend on authored source events and remain transposition/onset equivariant away from bounds', () => {
  const project = alternating();
  const original = suggestEnding(project, 'lead', 8, 4, 123456789);
  const shifted = structuredClone(project);
  shifted.tracks[0].notes.forEach(note => { note.pitch += 7; note.start += 30.25; });
  const shiftedResult = suggestEnding(shifted, 'lead', 8, 4, 123456789);
  assert.deepEqual(geometry(shiftedResult.notes), geometry(original.notes).map(([pitch, start, duration]) => [pitch + 7, start + 30.25, duration]));
  assert.deepEqual(shiftedResult.steps, original.steps);
  const other = phrase([[3, 2, 1], [-3, 1, 0], [3, 2, 1], [-3, 1, 0], [3, 2, 1], [-3, 1, 0], [3, 2, 1]]);
  const otherFit = fitEnding(selectEnding(other, 'lead', 8));
  assert.deepEqual(otherFit.tables[0].outcomes, [{ token: [-3, 1, 0], count: 3 }, { token: [3, 2, 1], count: 4 }]);
  assert.notDeepEqual(geometry(suggestEnding(other, 'lead', 8, 4, 123456789).notes), geometry(original.notes));
  const altered = alternating();
  altered.tracks[0].notes[7].duration = 0.5;
  assert.deepEqual(fitEnding(selectEnding(altered, 'lead', 8)).tables[0].outcomes,
    [{ token: B, count: 3 }, { token: A, count: 3 }, { token: [2, 2, 0], count: 1 }]);
});

test('oracle rejects a late pitch failure atomically instead of clipping or returning three notes', () => {
  const project = phrase(Array.from({ length: 7 }, (): JointToken => [1, 1, 0]), 86);
  const before = serializeComposition(project);
  // Last source pitch93 permits94,95,96, then no legal fourth event exists.
  assert.throws(() => suggestEnding(project, 'lead', 8, 4, 1), /pitch|bound|continuation|eligible/i);
  assert.equal(serializeComposition(project), before);
});

test('oracle applies one history change, excludes unsaved proposals, and auditions only the shifted seed and proposal', () => {
  const project = alternating();
  // Deliberate source array permutation must not reorder the committed original notes.
  project.tracks[0].notes.reverse();
  const original = structuredClone(project);
  const saved = serializeComposition(project);
  const proposal = suggestEnding(project, 'lead', 8, 4, 1);
  assert.equal(serializeComposition(project), saved);
  const audition = auditionComposition(proposal);
  assert.equal(audition.tracks.length, 1);
  assert.equal(audition.tempo, project.tempo);
  assert.equal(audition.tracks[0].instrument, 'triangle');
  assert.equal(audition.tracks[0].volume, 0.6);
  assert.equal(audition.tracks[0].notes.length, 12);
  assert.equal(audition.tracks[0].notes[0].start, 0);
  assert.deepEqual(geometry(audition.tracks[0].notes.slice(8)), geometry(proposal.notes).map(([pitch, start, duration]) => [pitch, start - 2, duration]));
  const applied = applyContinuation(project, proposal);
  assert.deepEqual(applied.tracks[0].notes.slice(0, 8), original.tracks[0].notes);
  assert.deepEqual(applied.tracks[1], original.tracks[1]);
  const ids = applied.tracks.flatMap(track => [track.id, ...track.notes.map(note => note.id)]);
  assert.equal(new Set(ids).size, ids.length);
  assert.throws(() => applyContinuation(applied, proposal), /changed|stale|match|current/i);
  const history = new CompositionHistory(project);
  assert.equal(history.commit(applied), true);
  assert.deepEqual(history.undo(), original);
  assert.equal(history.canUndo, false);
  assert.deepEqual(history.redo(), applied);
  assert.deepEqual(project, original);
  audition.tracks[0].notes[0].pitch = 36;
  applied.tracks[0].notes[0].pitch = 96;
  assert.deepEqual(project, original);
  assert.equal(serializeComposition(proposal.base), saved);
});

test('oracle accepts exact64-note seed,256-note output and128-beat endpoint together', () => {
  const project = phrase(Array.from({ length: 63 }, (): JointToken => [0, 1, 0]), 60, 110);
  project.tracks[0].notes.unshift(...Array.from({ length: 184 }, (_, i): Note => ({ id: `prefix${i}`, pitch: 50, start: i / 4, duration: 0.25, velocity: 0.5 })));
  const selection = selectEnding(project, 'lead', 64);
  assert.equal(selection.startTick, 440);
  assert.equal(selection.endTick, 504);
  assert.equal(fitEnding(selection).tables.reduce((sum, row) => sum + row.contextRawSupport, 0), 186);
  const proposal = suggestEnding(project, 'lead', 64, 8, 0xffffffff);
  assert.deepEqual(proposal.notes.map(note => note.start), [126, 126.25, 126.5, 126.75, 127, 127.25, 127.5, 127.75]);
  const applied = applyContinuation(project, proposal);
  assert.equal(applied.tracks[0].notes.length, 256);
  assert.equal(applied.tracks[0].notes.at(-1)!.start + applied.tracks[0].notes.at(-1)!.duration, 128);
  const tooMany = structuredClone(project);
  tooMany.tracks[0].notes.unshift({ id: 'extra', pitch: 48, start: 0, duration: 0.25, velocity: 0.5 });
  assert.throws(() => suggestEnding(tooMany, 'lead', 64, 8, 1), /256|capacity|notes|limit/i);
  const tooLate = structuredClone(project);
  tooLate.tracks[0].notes.slice(-64).forEach(note => { note.start += 0.25; });
  assert.throws(() => suggestEnding(tooLate, 'lead', 64, 8, 1), /time|beat|bound|continuation|eligible/i);
});

test('oracle permits a16-beat seed followed by a16-beat generated phrase without shortening', () => {
  const project = phrase(Array.from({ length: 7 }, (): JointToken => [0, 8, 0]), 60, 0);
  project.tracks[0].notes.forEach((note, i) => { note.start = i * 2; note.duration = 2; });
  const proposal = suggestEnding(project, 'lead', 8, 8, 1);
  assert.deepEqual(proposal.notes.map(note => [note.start, note.duration]), [[16, 2], [18, 2], [20, 2], [22, 2], [24, 2], [26, 2], [28, 2], [30, 2]]);
  const scratch = auditionComposition(proposal);
  assert.equal(scratch.tracks[0].notes.at(-1)!.start + scratch.tracks[0].notes.at(-1)!.duration, 32);
});
