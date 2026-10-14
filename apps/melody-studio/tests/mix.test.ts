import test from 'node:test';
import assert from 'node:assert/strict';
import { renderComposition } from '../src/audio.ts';
import { encodeMidi } from '../src/midi.ts';
import { DEFAULT_REVERB, panGains, renderMix, reverb, reverbTail, usesStereoMix, validatePan, validateReverb, validateSend } from '../src/mix.ts';
import { createDemoComposition, serializeComposition, parseComposition, validateComposition } from '../src/model.ts';
import { notesOnly } from '../src/reference-project.ts';
import { encodeWavChannels } from '../src/wav.ts';
import type { Composition } from '../src/types.ts';

const RATE = 8000;
function song(): Composition { return validateComposition(createDemoComposition()); }

test('projects without pan or sends keep the exact legacy mono samples', () => {
  const project = song();
  assert.equal(usesStereoMix(project), false);
  const mixed = renderMix(project, RATE);
  assert.equal(mixed.length, 1);
  assert.deepEqual(mixed[0], renderComposition(project, RATE));
  // A song-level reverb setting alone does not change anything until a track sends to it.
  assert.deepEqual(renderMix({ ...project, reverb: { size: 0.9, level: 1 } }, RATE), mixed);
  // Muted or silent tracks cannot switch the mix to stereo.
  const muted = structuredClone(project); muted.tracks[1]!.pan = -1; muted.tracks[1]!.muted = true;
  assert.equal(usesStereoMix(muted), false);
});

test('pan uses a balance law: centred tracks are unchanged in both channels and panning only attenuates the far side', () => {
  assert.deepEqual(panGains(0), [1, 1]);
  assert.deepEqual(panGains(-1), [1, 0]);
  assert.deepEqual(panGains(0.5), [0.5, 1]);
  const project = song();
  project.tracks[1]!.pan = -1; // Bass fully left, melody centred.
  const [left, right] = renderMix(project, RATE);
  assert.equal(left!.length, right!.length);
  const melodyOnly = structuredClone(project); melodyOnly.tracks[1]!.muted = true;
  const bassOnly = structuredClone(project); bassOnly.tracks[0]!.muted = true;
  const melody = renderComposition(melodyOnly, RATE), bass = renderComposition(bassOnly, RATE);
  let leftError = 0, rightError = 0;
  // Neither stem nor the mix reaches the limiter here, so the sums are exact.
  for (let i = 0; i < left!.length; i++) {
    leftError = Math.max(leftError, Math.abs(left![i]! - ((melody[i] ?? 0) + (bass[i] ?? 0))));
    rightError = Math.max(rightError, Math.abs(right![i]! - (melody[i] ?? 0)));
  }
  assert.ok(leftError < 1e-5 && rightError < 1e-5, `${leftError} ${rightError}`);
});

test('reverb sends add a decorrelated stereo tail after the music and the whole mix stays peak-limited', () => {
  const project = song();
  project.tracks[0]!.reverbSend = 0.6;
  project.reverb = { size: 0.7, level: 0.8 };
  const dry = renderComposition(song(), RATE);
  const [left, right] = renderMix(project, RATE);
  assert.equal(left!.length, dry.length + Math.ceil(reverbTail(project.reverb) * RATE));
  let tail = 0, difference = 0, peak = 0;
  for (let i = dry.length; i < left!.length; i++) tail += Math.abs(left![i]!);
  for (let i = 0; i < left!.length; i++) { difference += Math.abs(left![i]! - right![i]!); peak = Math.max(peak, Math.abs(left![i]!), Math.abs(right![i]!)); }
  assert.ok(tail > 1, `audible tail ${tail}`);
  assert.ok(difference > 1, 'left and right reverb differ');
  assert.ok(peak <= 0.95 + 1e-6);
  assert.deepEqual(renderMix(project, RATE), [left, right], 'deterministic');
  // More size rings longer; zero return level leaves only the dry signal.
  const impulse = new Float32Array(RATE * 3); impulse[0] = 1;
  const energy = (size: number) => reverb(impulse, RATE, { size, level: 1 })[0].slice(RATE * 2).reduce((sum, value) => sum + value * value, 0);
  assert.ok(energy(0.9) > energy(0.2) * 2);
  assert.ok(reverb(impulse, RATE, { size: 0.5, level: 0 })[0].every(value => value === 0));
});

test('mix fields are validated, optional, and survive saved documents and JSON', () => {
  assert.equal(validatePan(-0.35), -0.35);
  for (const bad of [1.01, -2, 0.123, NaN, '0.5']) assert.throws(() => validatePan(bad));
  assert.equal(validateSend(1), 1);
  assert.throws(() => validateSend(-0.05));
  assert.deepEqual(validateReverb({ size: 0.25, level: 1 }), { size: 0.25, level: 1 });
  for (const bad of [{ size: 0.5 }, { size: 0.5, level: 0.5, wet: 1 }, { size: 2, level: 0 }, null, []]) assert.throws(() => validateReverb(bad));
  assert.equal(DEFAULT_REVERB.size, 0.5);

  const project = song();
  project.tracks[0]!.pan = 0.25; project.tracks[1]!.reverbSend = 0.4; project.reverb = { size: 0.3, level: 0.6 };
  const restored = parseComposition(serializeComposition(project));
  assert.deepEqual(restored, project);
  assert.deepEqual(notesOnly(project).composition, project);
  assert.throws(() => notesOnly({ ...project, tracks: [{ ...project.tracks[0]!, pan: 5 }, project.tracks[1]!] }));
  assert.throws(() => notesOnly({ ...project, extra: 1 } as Composition), /unknown fields/);
});

test('stereo WAV and MIDI carry the mix', () => {
  const wav = encodeWavChannels([new Float32Array([0.5, -0.5]), new Float32Array([0, 1])], 22050);
  const view = new DataView(wav.buffer);
  assert.deepEqual([view.getUint16(22, true), view.getUint32(28, true), view.getUint16(32, true), view.getUint32(40, true)], [2, 88200, 4, 8]);
  assert.deepEqual([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true), view.getInt16(50, true)], [16384, 0, -16384, 32767]);
  assert.equal(encodeWavChannels([new Float32Array([0])], 22050)[22], 1, 'mono stays mono');
  assert.throws(() => encodeWavChannels([new Float32Array(2), new Float32Array(3)], 22050));

  const project = song();
  const plain = encodeMidi(project);
  project.tracks[0]!.pan = -1; project.tracks[1]!.reverbSend = 0.5;
  const midi = Array.from(encodeMidi(project));
  const has = (bytes: number[]) => midi.some((_, i) => bytes.every((value, k) => midi[i + k] === value));
  assert.ok(has([0xb0, 10, 1]), 'CC10 hard left');
  assert.ok(has([0xb1, 91, 64]), 'CC91 send');
  assert.ok(!Array.from(plain).some((value, i, all) => value === 0xb0 && all[i + 1] === 10), 'nothing added when unset');
});
