import test from 'node:test';
import assert from 'node:assert/strict';
import { assumedBody, bodyRadius, COLUMNS, constraints, drapeObj, drapeSvg, FABRICS, initialPositions, ROWS, simulateDrape, validateFabric } from '../src/drape.ts';
import { patternGeometry, validateConstruction, type SkirtDraft } from '../src/construction.ts';

const skirt: SkirtDraft = { kind: 'flared-skirt', waist: 80, hem: 180, slant: 60 };
const body = { waist: 76, hip: 100, hipDepth: 20 };
const chiffon = simulateDrape(skirt, 'chiffon', body), denim = simulateDrape(skirt, 'denim', body);

test('the cloth mesh comes from the flat patterns: the assembled cone starts unstretched', () => {
  const positions = initialPositions(skirt, 0);
  let worst = 0;
  for (const constraint of constraints(skirt, FABRICS.cotton)) {
    if (constraint.compliance > 0.01) continue;
    const a = constraint.a * 3, b = constraint.b * 3;
    const length = Math.hypot(positions[a]! - positions[b]!, positions[a + 1]! - positions[b + 1]!, positions[a + 2]! - positions[b + 2]!);
    worst = Math.max(worst, Math.abs(length - constraint.rest) / constraint.rest);
  }
  // Chords on the cone versus the flat sector differ only by discretization.
  assert.ok(worst < 0.002, `initial strain ${worst}`);
  const geometry = patternGeometry(skirt), hemRow = ROWS * 2 * COLUMNS * 3;
  assert.ok(Math.abs(positions[hemRow + 1]! - geometry.height) < 1e-3);
});

test('gravity settles the skirt: waist held, no body penetration, little stretch, at rest, deterministic', () => {
  for (const result of [chiffon, denim]) {
    const { positions, metrics } = result;
    const start = initialPositions(skirt, 0);
    for (let i = 0; i < 2 * COLUMNS * 3; i++) assert.ok(Math.abs(positions[i]! - start[i]!) < 1e-4, 'waist row stays at the waistline');
    assert.ok(metrics.minClearance >= 0.39, `clearance ${metrics.minClearance}`);
    assert.ok(metrics.maxStrain < 0.05, `stretch ${metrics.maxStrain}`);
    assert.ok(metrics.residualSpeed < 5, `settled ${metrics.residualSpeed}`);
    // The hem can only fall as far as the slant length allows (plus the 0.5% warp tolerance).
    assert.ok(metrics.hemDrop > 0 && metrics.hemDrop <= skirt.slant * 1.005 - patternGeometry(skirt).height + 1e-3, `drop ${metrics.hemDrop}`);
  }
  assert.deepEqual(simulateDrape(skirt, 'chiffon', body).positions, chiffon.positions);
});

test('fabric changes the drape: fluid chiffon collapses into more, smaller folds than stiff denim', () => {
  assert.ok(chiffon.metrics.folds > denim.metrics.folds, `${chiffon.metrics.folds} vs ${denim.metrics.folds}`);
  assert.ok(chiffon.metrics.hemFlare < denim.metrics.hemFlare, `${chiffon.metrics.hemFlare} vs ${denim.metrics.hemFlare}`);
  assert.ok(denim.metrics.hemFlare < 1 && chiffon.metrics.hemFlare > 0.3, 'both hang inside the rigid cone yet stay flared');
});

test('body proxy, assumptions, fabric choice and exports', () => {
  assert.equal(bodyRadius(body, -5), 76 / (2 * Math.PI));
  assert.ok(Math.abs(bodyRadius(body, 10) - 88 / (2 * Math.PI)) < 1e-9);
  assert.equal(bodyRadius(body, 50), 100 / (2 * Math.PI));
  assert.deepEqual(assumedBody(skirt), { waist: 78, hip: 98, hipDepth: 20 });
  assert.equal(simulateDrape(skirt, 'cotton', undefined, { frames: 2 }).bodyAssumed, true);
  assert.equal(validateFabric('linen'), 'linen');
  assert.throws(() => validateFabric('wool'));
  assert.equal(validateConstruction({ ...skirt, fabric: 'denim' }).fabric, 'denim');
  assert.throws(() => validateConstruction({ ...skirt, fabric: 'velvet' }), /Fabric/);
  assert.throws(() => simulateDrape(skirt, 'cotton', body, { frames: 0 }));

  const obj = drapeObj(denim, 'denim');
  assert.equal(obj.match(/^v /gm)!.length, (ROWS + 1) * 2 * COLUMNS);
  assert.equal(obj.match(/^f /gm)!.length, ROWS * 2 * COLUMNS);
  assert.match(obj, /^# Units: centimetres/);
  const svg = drapeSvg(denim, 30, '#b8613d', false);
  assert.equal(svg.match(/data-drape-face/g)!.length, ROWS * 2 * COLUMNS);
  assert.equal(svg.match(/data-body-face/g), null);
  assert.ok(drapeSvg(denim, 30, '#b8613d', true).includes('data-body-face'));
  assert.throws(() => drapeSvg(denim, 999, '#b8613d'));
});
