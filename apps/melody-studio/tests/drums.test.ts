import test from 'node:test';
import assert from 'node:assert/strict';
import { renderComposition, renderDry } from '../src/audio.ts';
import { basicBeat, copyBarForward, DRUM_ROWS, drumName, drumSeconds, drumVoice, gridBars, stepNote, toggleStep } from '../src/drums.ts';
import { encodeMidi } from '../src/midi.ts';
import { renderMix } from '../src/mix.ts';
import { createDemoComposition, parseComposition, serializeComposition, validateComposition } from '../src/model.ts';
import { notesOnly } from '../src/reference-project.ts';
import type { Composition, Track } from '../src/types.ts';

const RATE = 22050;
function drumTrack(notes: Track['notes'] = basicBeat()): Track {
  return { id: 'drums', name: 'Drums', instrument: 'drums', volume: 0.8, muted: false, notes };
}
function song(track = drumTrack()): Composition { return validateComposition({ version: 1, title: 'Groove', tempo: 120, tracks: [track] }); }
function hit(pitch: number, start = 0, duration = 0.25, velocity = 0.8) { return { id: `h${pitch}-${start}`, pitch, start, duration, velocity }; }
/** Zero crossings per second: a coarse brightness measure that separates a kick from a hi-hat. */
function crossings(samples: ArrayLike<number>, from: number, to: number) {
  let count = 0;
  for (let i = from + 1; i < to; i++) if ((samples[i - 1]! < 0) !== (samples[i]! < 0)) count++;
  return count / ((to - from) / RATE);
}

test('the synthesized kit is deterministic, normalized and sounds like its pieces', () => {
  for (const { pitch } of DRUM_ROWS) {
    const voice = drumVoice(pitch, RATE);
    assert.equal(voice.length, Math.ceil(drumSeconds(pitch) * RATE));
    assert.ok(Math.abs(Math.max(...voice.map(Math.abs)) - 1) < 1e-9, `${drumName(pitch)} peaks at 1`);
    assert.ok(voice.every(Number.isFinite));
  }
  assert.equal(drumVoice(38, RATE), drumVoice(38, RATE), 'voices are cached');
  const kick = drumVoice(36, RATE), hat = drumVoice(42, RATE), snare = drumVoice(38, RATE);
  const span = Math.floor(0.03 * RATE);
  assert.ok(crossings(kick, 0, span) < 400, `kick is low ${crossings(kick, 0, span)}`);
  assert.ok(crossings(hat, 0, span) > 4000, `hat is bright ${crossings(hat, 0, span)}`);
  assert.ok(crossings(snare, 0, span) > crossings(kick, 0, span) * 3, 'snare is noisier than kick');
  // Open hats and crashes ring far longer than closed hats.
  assert.ok(drumSeconds(46) > drumSeconds(42) * 3 && drumSeconds(49) > 1);
  assert.equal(drumName(36), 'Kick'); assert.equal(drumName(90), 'Tuned percussion 90');
  // Low sample rates stay finite (cutoffs clamp below Nyquist).
  assert.ok(drumVoice(49, 8000).every(Number.isFinite));
});

test('drum tracks render each hit as a one-shot: duration and envelope do not change the sound, the tail is kept', () => {
  const short = renderDry(song(drumTrack([hit(49)])), RATE);
  assert.equal(short.length, Math.ceil(drumSeconds(49) * RATE), 'the crash tail outlasts the sixteenth note');
  const held = renderDry(song(drumTrack([hit(49, 0, 4)])), RATE);
  assert.equal(held.length, 4 * 0.5 * RATE, 'a long note still covers its whole duration');
  for (let i = 0; i < short.length; i++) assert.equal(held[i], short[i]);
  const enveloped = renderDry(song({ ...drumTrack([hit(49)]), envelope: { attack: 1, decay: 0, sustain: 1, release: 2 } }), RATE);
  assert.deepEqual(enveloped, short);
  // Gain follows volume × velocity × 0.4 like the oscillators.
  assert.ok(Math.abs(Math.max(...short.map(Math.abs)) - 0.8 * 0.8 * 0.4) < 1e-6);
  const groove = renderComposition(song(), RATE);
  assert.deepEqual(renderComposition(song(), RATE), groove, 'deterministic');
  // The last hat starts on beat 3.5 and its note ends at beat 3.75 (1.875 s at 120 BPM).
  assert.equal(groove.length, Math.ceil(3.75 * 0.5 * RATE));
});

test('drums mix with melodic tracks, pan and send to reverb like any track', () => {
  const project = validateComposition(createDemoComposition());
  const drums = drumTrack(); drums.pan = -1;
  project.tracks.push(drums);
  const [left, right] = renderMix(project, 8000);
  const onlyDrums = structuredClone(project); onlyDrums.tracks[0]!.muted = true; onlyDrums.tracks[1]!.muted = true;
  const [drumLeft, drumRight] = renderMix(onlyDrums, 8000);
  assert.ok(drumRight!.every(value => value === 0) && drumLeft!.some(value => value !== 0), 'hard-left drums leave the right channel silent');
  assert.ok(right!.some(value => value !== 0) && left!.length === right!.length);
});

test('steps toggle sixteenth hits within the limits; bars copy forward; the starter beat is a valid groove', () => {
  const track = drumTrack([]);
  assert.equal(toggleStep(track, 36, 1.25), true);
  assert.deepEqual(stepNote(track, 36, 1.25), { ...track.notes[0]!, pitch: 36, start: 1.25, duration: 0.25, velocity: 0.8 });
  assert.equal(toggleStep(track, 36, 1.25), false);
  assert.equal(track.notes.length, 0);
  assert.throws(() => toggleStep(track, 36, 1.1), /sixteenth/);
  assert.throws(() => toggleStep(track, 36, 511.75 + 0.25), /512/);
  assert.throws(() => toggleStep(track, 20, 0), /kit/);
  const full = drumTrack(Array.from({ length: 256 }, (_, i) => hit(42, i * 0.25)));
  assert.throws(() => toggleStep(full, 36, 0), /256/);
  assert.equal(toggleStep(full, 42, 0), false, 'removing still works at the limit');

  const groove = drumTrack();
  assert.equal(groove.notes.length, 13);
  assert.equal(validateComposition(song(groove)).tracks[0]!.notes.length, 13);
  assert.equal(gridBars(groove), 2, 'one bar of hits plus one empty bar to grow into');
  copyBarForward(groove, 0);
  assert.equal(groove.notes.length, 26);
  assert.deepEqual(groove.notes.filter(note => note.start >= 4).map(note => [note.pitch, note.start - 4, note.velocity]),
    groove.notes.filter(note => note.start < 4).map(note => [note.pitch, note.start, note.velocity]));
  assert.equal(new Set(groove.notes.map(note => note.id)).size, 26);
  toggleStep(groove, 49, 4);
  copyBarForward(groove, 0);
  assert.equal(stepNote(groove, 49, 4), undefined, 'copying replaces the next bar');
  assert.throws(() => copyBarForward(drumTrack([]), 0), /no hits/);
  assert.throws(() => copyBarForward(groove, 127), /room/);
});

test('drum tracks survive saved documents, and MIDI puts them on General MIDI channel 10', () => {
  const project = validateComposition(createDemoComposition());
  project.tracks.push(drumTrack());
  assert.deepEqual(parseComposition(serializeComposition(project)), project);
  assert.deepEqual(notesOnly(project).composition, project);
  assert.throws(() => validateComposition({ ...project, tracks: [{ ...project.tracks[0]!, instrument: 'kazoo' }] }), /drums/);

  const midi = Array.from(encodeMidi(project));
  const has = (bytes: number[]) => midi.some((_, i) => bytes.every((value, k) => midi[i + k] === value));
  assert.ok(has([0x99, 36, Math.round(0.9 * 127)]), 'kick note-on on channel 10');
  assert.ok(has([0x99, 42]), 'hats on channel 10');
  assert.ok(has([0xc0, 80]) && has([0xc1, 73]), 'melodic tracks keep their own channels');
  assert.ok(!has([0xc2, 0]) && !midi.some((value, i) => value === 0x92 && i > 0), 'nothing uses the drum track’s index channel');
});
