import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateBody, FIT, largestRegion, measureFront, measureSide } from '../src/body-photo.ts';
import { fetchPoseModel, POSE_MODEL } from '../src/pose-model.ts';
import { figure, FRONT, SIDE } from './helpers/body-figure.ts';

const near = (actual: number, expected: number, tolerance: number, what: string) => assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} (expected about ${expected})`);

test('the front outline gives the chest under the arms, the narrowest waist, the widest hip and the upper arm', () => {
  const front = measureFront(figure('front'), 180);
  near(front.pixelsPerCm, 450 / 180, 1e-9, 'scale');
  near(front.widths.chest, FRONT.chest, 0.5, 'chest width');
  near(front.widths.waist, FRONT.waist, 0.5, 'waist width');
  near(front.widths.hip, FRONT.hip, 0.5, 'hip width');
  near(front.widths.arm!, FRONT.arm, 0.5, 'arm width');
  // The levels are found where the outline has them: the chest just under the arms, the waist and hip at the profile's
  // narrowest and widest points.
  near(front.levels.waist, 0.62, 0.01, 'waist level');
  near(front.levels.hip, 0.5, 0.01, 'hip level');
  assert.ok(front.levels.chest > 0.74 && front.levels.chest <= 0.76, `chest level ${front.levels.chest}`);
  // Lines for showing what was measured span the body at those rows.
  assert.ok(front.lines.waist.x1 - front.lines.waist.x0 + 1 >= FRONT.waist * front.pixelsPerCm - 2);
});

test('the side outline gives the bust as its deepest point and the waist and hip depths at the front levels', () => {
  const front = measureFront(figure('front'), 180), side = measureSide(figure('side'), 180, front.levels);
  near(side.depths.chest, SIDE.chest, 0.6, 'bust depth');
  near(side.depths.waist, SIDE.waist, 0.8, 'waist depth');
  near(side.depths.hip, SIDE.hip, 0.6, 'hip depth');
});

test('girths follow the fitted lines, with a side photo or the front alone, and say how they were found', () => {
  const front = measureFront(figure('front'), 180), side = measureSide(figure('side'), 180, front.levels);
  const both = estimateBody(front, side, 180), alone = estimateBody(front, null, 180);
  for (const level of ['chest', 'waist', 'hip'] as const) {
    const fit = FIT.girth[level];
    near(both[level], fit.side[0] * front.widths[level] + fit.side[1] * side.depths[level] + fit.side[2], 0.25, `${level} with side`);
    near(alone[level], fit.front[0] * front.widths[level] + fit.front[1], 0.25, `${level} front only`);
    assert.match(both.basis[level], /front width and side depth/);
    assert.match(alone.basis[level], /front width alone/);
  }
  // Plausible body: about 94 cm chest, 79 cm waist and 97 cm hip for this outline.
  assert.ok(both.chest > 85 && both.chest < 105 && both.waist > 70 && both.waist < 90 && both.hip > 90 && both.hip < 110, JSON.stringify(both));
  near(both.chestDepth, SIDE.chest, 0.6, 'chest depth from the side');
  near(alone.chestDepth, FRONT.chest * FIT.girth.chest.depth, 0.6, 'assumed chest depth');
  assert.match(alone.basis.chestDepth, /Assumed/);
  near(both.hipDepth, (0.62 - 0.5) * 180, 1.5, 'waist to hip');
  near(both.upperArmGirth!, Math.PI * FRONT.arm * FIT.armGirth, 1.5, 'upper arm');
  // Halves of a centimetre, like the body fields.
  for (const value of [both.chest, both.waist, both.hip, both.chestDepth, both.hipDepth]) assert.equal(value * 2, Math.round(value * 2));
});

test('a photo that cannot be measured is refused with what to change', () => {
  assert.throws(() => measureFront(figure('front', { armsTouching: true }), 180), /arms a little away from your sides/);
  assert.throws(() => measureFront(figure('front', { margin: 0 }), 180), /whole body, head to feet/);
  assert.throws(() => measureFront({ width: 50, height: 50, data: new Uint8Array(2500) }, 180), /No person/);
  assert.throws(() => measureFront(figure('front', { width: 120, height: 200, margin: 10 }), 180), /too small/);
});

test('only the largest region counts, so specks around the person do not move the levels', () => {
  const clean = figure('front'), speckled = figure('front');
  for (const [x, y] of [[3, 3], [290, 10], [5, 490]]) speckled.data[y! * speckled.width + x!] = 1;
  assert.equal(largestRegion(speckled).data.reduce((n, v) => n + v, 0), clean.data.reduce((n, v) => n + v, 0));
  assert.deepEqual(measureFront(speckled, 180).widths, measureFront(clean, 180).widths);
});

test('the pose model is used only if it is exactly the pinned file', async () => {
  const reply = (bytes: Uint8Array, status = 200) => (async () => new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), { status })) as typeof fetch;
  await assert.rejects(fetchPoseModel(reply(new Uint8Array(10))), /not the expected file/);
  await assert.rejects(fetchPoseModel(reply(new Uint8Array(POSE_MODEL.bytes))), /not the expected file/);
  await assert.rejects(fetchPoseModel(reply(new Uint8Array(0), 404)), /could not be downloaded \(404\)/);
  assert.match(POSE_MODEL.url, /^https:\/\/storage\.googleapis\.com\/mediapipe-models\/pose_landmarker\/pose_landmarker_lite\/float16\/1\//);
});
