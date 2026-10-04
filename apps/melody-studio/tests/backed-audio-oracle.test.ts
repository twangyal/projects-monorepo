/** Independent literal timing/data expectations, authored before producer inspection. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { backingComposition, backedFramePlan } from '../src/backing.ts';
import { BackedFrames } from '../src/backed-frames.ts';
import type { Composition } from '../src/types.ts';

const original = (): Composition => ({ version: 1, title: 'Independent count-in', tempo: 137, tracks: [
  { id: 'target', name: 'Replace this', instrument: 'sawtooth', volume: 1, muted: false, notes: [{ id: 'old', pitch: 96, start: 0, duration: 4, velocity: 1 }] },
  { id: 'backing', name: 'Keep exactly', instrument: 'sine', volume: .375, muted: false, notes: [{ id: 'low', pitch: 60, start: 1.125, duration: .75, velocity: .625 }] },
  { id: 'muted', name: 'Muted sentinel', instrument: 'triangle', volume: .75, muted: true, notes: [{ id: 'quiet', pitch: 84, start: 2.5, duration: .5, velocity: .125 }] },
] });

test('independent rational frame plans distinguish round-four-beats from four-rounded-beats', () => {
  // 60*44100/137 = 19313 +119/137; four beats round to77255, not77256.
  const cases = [
    { rate: 44100, count: 9923, clicks: [9923, 29237, 48551, 67865], start: 87178, max: 882000, limit: 969178 },
    { rate: 48000, count: 10800, clicks: [10800, 31822, 52844, 73866], start: 94888, max: 960000, limit: 1054888 },
    { rate: 192000, count: 43200, clicks: [43200, 127288, 211375, 295463], start: 379550, max: 3840000, limit: 4219550 },
  ];
  for (const c of cases) assert.deepEqual(backedFramePlan(c.rate, 137, .125), {
    sampleRate: c.rate, countInFrame: c.count, clickFrames: c.clicks, startFrame: c.start, maxFrames: c.max, limitFrame: c.limit,
  });
  assert.deepEqual(backedFramePlan(8000, 40, 0), { sampleRate: 8000, countInFrame: 800, clickFrames: [800, 12800, 24800, 36800], startFrame: 48800, maxFrames: 160000, limitFrame: 208800 });
});

test('independent frame planner rejects nonfinite, fractional rates and unsafe absolute origins', () => {
  for (const [rate, tempo, now] of [[7999,120,0],[192001,120,0],[44100.5,120,0],[44100,39,0],[44100,241,0],[44100,120,-1],[44100,120,Infinity],[44100,NaN,0],[44100,120,Number.MAX_SAFE_INTEGER]]) assert.throws(() => backedFramePlan(rate, tempo, now));
});

test('independent backing removes target entirely while preserving detached remaining musical data', () => {
  const source = original(), before = structuredClone(source);
  const result = backingComposition(source, 'target');
  assert.deepEqual(result, { ...before, tracks: before.tracks.slice(1) });
  result.tracks[0].notes[0].pitch = 75;
  assert.deepEqual(source, before);
  assert.throws(() => backingComposition(source, 'missing'));
});

test('independent backing eligibility uses audible note attacks strictly before the capture limit', () => {
  for (const mode of ['muted', 'volume', 'velocity', 'late'] as const) {
    const source = original(); source.tempo = 120;
    if (mode === 'muted') source.tracks[1].muted = true;
    if (mode === 'volume') source.tracks[1].volume = 0;
    if (mode === 'velocity') source.tracks[1].notes[0].velocity = 0;
    if (mode === 'late') source.tracks[1].notes[0].start = 40;
    assert.throws(() => backingComposition(source, 'target'), mode);
  }
  const source = original(); source.tempo = 120; source.tracks[1].notes[0].start = 39.5;
  assert.equal(backingComposition(source, 'target').tracks[0].notes[0].start, 39.5);
});

function frames() { const f = new BackedFrames(8000); f.push(100, [new Float32Array([.75,.5,.25])]); return f; }
test('independent variable blocks select only the exact half-open interval, with detached input', () => {
  const f = frames(); f.arm(105,112);
  const first = new Float32Array([.875,.75,.625,.5]);
  assert.equal(f.push(103,[first]),null); first.fill(-1);
  assert.equal(f.push(107,[new Float32Array([.375,.25])]),null);
  const result=f.push(109,[new Float32Array([.125,0,-.125,-.25,-.375])]);
  assert.deepEqual(result, { sampleRate:8000,channels:1,startFrame:105,endFrame:112,samples:new Float32Array([.625,.5,.375,.25,.125,0,-.125]) });
  assert.equal(f.framesCaptured,7);assert.equal(f.terminal,true);assert.equal(f.push(114,[]),null);
});

test('independent stereo averaging preserves exact cancellation without peak normalization', () => {
  const f=new BackedFrames(8000);f.push(0,[new Float32Array(2),new Float32Array(2)]);f.arm(3,7);
  const result=f.push(2,[new Float32Array([.75,.5,-.75,1,-.5]),new Float32Array([-.75,-.5,.25,-.5,0])]);
  assert.deepEqual(result?.samples,new Float32Array([0,-.25,.25,-.25]));assert.equal(result?.channels,2);
});

test('independent delayed Finish trims already captured samples and never pads unreceived tail', () => {
  const f=frames();f.arm(103,120);f.push(103,[new Float32Array([.125,.25,.375,.5,.625,.75,.875])]);
  const result=f.finish(108);assert.deepEqual(result?.samples,new Float32Array([.125,.25,.375,.5,.625]));assert.equal(result?.endFrame,108);assert.equal(f.finish(120),null);
  const waiting=frames();waiting.arm(103,120);waiting.push(103,[new Float32Array([.125,.25])]);assert.equal(waiting.finish(108),null);assert.equal(waiting.terminal,false);
  const last=waiting.push(105,[new Float32Array([.375,.5,.625,.75])]);assert.deepEqual(last?.samples,new Float32Array([.125,.25,.375,.5,.625]));assert.equal(last?.endFrame,108);
});

test('independent empty/count-in Finish and cancellation have no terminal take', () => {
  for(const stop of [104,105]){const f=frames();f.arm(105,112);assert.equal(f.finish(stop),null);assert.equal(f.terminal,true);assert.equal(f.push(103,[new Float32Array(20)]),null);}
  const f=frames();f.finish(102);assert.equal(f.terminal,true);assert.throws(()=>f.arm(105,112));f.cancel();f.cancel();
});

test('independent invalid topology, gaps and nonfinite blocks do not advance retained state', () => {
  const f=frames();f.arm(103,110);
  for(const [at,input] of [[104,[new Float32Array(2)]],[103,[]],[103,[new Float32Array(2),new Float32Array(2)]],[103,[new Float32Array([NaN])]]] as const){assert.throws(()=>f.push(at,input));assert.equal(f.framesCaptured,0);assert.equal(f.terminal,false);}
  assert.equal(f.push(103,[new Float32Array([.25,.5])]),null);assert.equal(f.framesCaptured,2);
  assert.throws(()=>f.push(104,[new Float32Array([.75])]));assert.equal(f.framesCaptured,2);
});

test('independent pre-arm clock gaps retain topology and never shift the eventual capture origin', () => {
  const f = new BackedFrames(48000);
  f.push(0, [new Float32Array(128)]);
  assert.throws(() => f.push(127, [new Float32Array(128)]));
  assert.throws(() => f.push(640, [new Float32Array(128), new Float32Array(128)]));
  assert.throws(() => f.push(640, [new Float32Array([NaN])]));
  assert.equal(f.push(640, [new Float32Array(128)]), null);
  assert.equal(f.framesCaptured, 0);
  assert.equal(f.channels, 1);
  assert.throws(() => f.arm(767, 774));
  f.arm(770, 774);
  // Continuity remains mandatory after arming, including the count-in region.
  assert.throws(() => f.push(769, [new Float32Array(8)]));
  const result = f.push(768, [new Float32Array([-.75, -.5, -.25, 0, .25, .5, .75])]);
  assert.deepEqual(result, {
    sampleRate: 48000, channels: 1, startFrame: 770, endFrame: 774,
    samples: new Float32Array([-.25, 0, .25, .5]),
  });
});

test('independent exact twenty-second maximum is captured without off-by-one growth', () => {
  const f=new BackedFrames(192000);f.push(0,[new Float32Array(1)]);f.arm(1,3840001);
  const samples=new Float32Array(3840000);samples[0]=.25;samples[3839999]=-.5;
  const result=f.push(1,[samples]);assert.equal(result?.samples.length,3840000);assert.equal(result?.samples[0],.25);assert.equal(result?.samples[3839999],-.5);assert.equal(result?.endFrame,3840001);
  const overflow=new BackedFrames(192000);assert.throws(()=>overflow.arm(0,3840001));
});
