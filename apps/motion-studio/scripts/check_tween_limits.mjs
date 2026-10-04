/** Reproducible pure-module admission/geometry check; no browser/media claim. */
/* global structuredClone */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { buildDrawingTween, applyDrawingTween, planTweenFrames } from '../src/tween.ts';
import { validateProject } from '../src/model.ts';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 1e-10);
const key = { frame: 0, x: 100, y: 100, scale: 1, rotation: 0, opacity: 1, easing: 'linear' };
const measurements = [];
for (const [pairs, endpointPoints, count, finalCels] of [[4, 46, 22, 24], [8, 55, 10, 12]]) {
  const source = validateProject({ schemaVersion: 2, title: 'Original maximum geometry fixture', background: '#ffffff', frameCount: 96,
    layers: [{ id: 'target', name: 'Target', kind: 'drawing', keys: [key], cels: [0, 95].map((frame, i) => ({ frame,
      strokes: Array.from({ length: pairs }, (_, s) => ({ color: '#123456', width: 3,
        points: Array.from({ length: endpointPoints }, (_, k) => ({ x: k, y: s + i * 100 })) })) })) },
    { id: 'retained', name: 'Retained', kind: 'drawing', keys: [key], cels: [{ frame: 0,
      strokes: Array.from({ length: 4 }, () => ({ color: '#abcdef', width: 2,
        points: Array.from({ length: 1000 }, (_, x) => ({ x, y: 0 })) })) }] }] });
  const original = JSON.stringify(source), started = performance.now();
  const proposal = buildDrawingTween(source, { layerId: 'target', startFrame: 0, endFrame: 95 }, {
    pairs: Array.from({ length: pairs }, (_, s) => ({ startStroke: s, endStroke: s, reverseEnd: false })),
    frames: planTweenFrames(0, 95, count) });
  const built = performance.now(), candidate = applyDrawingTween(source, proposal), applied = performance.now();
  assert.equal(JSON.stringify(source), original);
  assert.equal(proposal.after.layerCels, finalCels); assert.equal(proposal.after.projectStrokes, 100); assert.equal(proposal.after.projectPoints, 10000);
  assert.deepEqual(candidate.layers[1], source.layers[1]);
  assert.deepEqual(candidate.layers[0].cels[0], source.layers[0].cels[0]);
  assert.deepEqual(candidate.layers[0].cels.at(-1), source.layers[0].cels[1]);
  for (let j = 1; j <= count; j++) {
    const cel = candidate.layers[0].cels[j], expectedFrame = Math.floor(j * 95 / (count + 1));
    assert.equal(cel.frame, expectedFrame);
    for (let s = 0; s < pairs; s++) for (let k = 0; k < 64; k++) {
      close(cel.strokes[s].points[k].x, (endpointPoints - 1) * k / 63);
      close(cel.strokes[s].points[k].y, s + 100 * expectedFrame / 95);
    }
  }
  const serialized = JSON.stringify(candidate);
  assert.equal(Buffer.byteLength(serialized), proposal.after.projectBytes);
  const tooMany = structuredClone(source); tooMany.layers[0].cels[0].strokes[0].points.push({ x: 0, y: 0 });
  assert.throws(() => buildDrawingTween(tooMany, proposal.selection, proposal.choices), /points/i);
  assert.deepEqual(validateProject(JSON.parse(serialized)), candidate);
  measurements.push({ pairs, count, finalCels, finalStrokes: 100, finalPoints: 10000,
    sourceBytes: Buffer.byteLength(original), candidateBytes: Buffer.byteLength(serialized),
    sourceSha256: sha256(original), candidateSha256: sha256(serialized),
    buildMilliseconds: built - started, applyMilliseconds: applied - built });
}
process.stdout.write(JSON.stringify({ node: process.version, measurements,
  limits: ['Pure vector fixtures only; no raster assets, native UI, browser persistence, PNG/GIF export or peak-memory measurement.',
    'Timings are single local observations, not latency guarantees.'] }, null, 2) + '\n');
