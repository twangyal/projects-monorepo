import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { innerLayer, simulateOutfit, threePiece } from '../src/garment-drape.ts';
import { canWearTogether, layerOrder, optionsOf, sleeveAngleOf, teeMesh, template, withOptions, withSleeveAngle, type Product } from '../src/product.ts';

test('a button-up shirt goes over a top without a button front, and itself still under a sweatshirt or hoodie', () => {
  const shirt = template('shirt');
  for (const id of ['blank', 'tank-top', 'crop-top', 'tee-dress', 'fit-flare']) {
    const inner = template(id);
    assert.deepEqual(layerOrder(inner, shirt), { inner, outer: shirt }, id);
    assert.deepEqual(layerOrder(shirt, inner), { inner, outer: shirt }, id);
  }
  // Not two shirts. A polo, whose placket opens only part way, goes under a shirt but over nothing.
  assert.equal(layerOrder(shirt, template('shirt')), null);
  assert.deepEqual(layerOrder(template('polo'), shirt), { inner: template('polo'), outer: shirt });
  assert.equal(layerOrder(template('polo'), template('blank')), null);
  for (const id of ['hoodie', 'zip-hoodie', 'crew-sweat']) assert.deepEqual(layerOrder(shirt, template(id)), { inner: shirt, outer: template(id) }, id);
  assert.ok(canWearTogether(template('blank'), shirt));
  // With bottoms, a T-shirt under a shirt is a three-piece outfit.
  assert.deepEqual(threePiece([template('blank'), shirt, template('trousers')])?.outer, shirt);
});

function overTee(outer: Product) {
  const inner = withSleeveAngle(template('blank'), sleeveAngleOf(outer));
  const result = simulateOutfit(outer, teeMesh(outer, Delaunator), inner, teeMesh(inner, Delaunator), 94, { frames: 180 });
  const layer = innerLayer(result.companion!.parts, result.body, result.body.torso[1]!.y);
  let covered = 0, inside = 0;
  for (const { positions } of result.parts) for (let i = 0; i < positions.length; i += 3) {
    const clearance = layer.clearance(positions[i]!, positions[i + 1]!, positions[i + 2]!);
    if (clearance === null) continue;
    covered++;
    if (clearance < -0.5) inside++;
  }
  return { result, covered, inside };
}

test('a shirt over a T-shirt lies outside it, buttoned or open, and both settle', () => {
  const shirt = template('shirt');
  for (const outer of [shirt, withOptions(shirt, { ...optionsOf(shirt), zipOpen: true })]) {
    const open = !!optionsOf(outer).zipOpen, { result, covered, inside } = overTee(outer), label = open ? 'open' : 'buttoned';
    assert.ok(covered > 1500 && inside <= covered * 0.01, `${label}: ${inside} of ${covered} shirt points are inside the tee`);
    assert.ok(result.metrics.maxStrain < 0.6 && result.companion!.metrics.maxStrain < 0.3, `${label}: stretch ${result.metrics.maxStrain}, ${result.companion!.metrics.maxStrain}`);
    assert.ok(result.metrics.residualSpeed < 10 && result.companion!.metrics.residualSpeed < 10, `${label}: both settle`);
    // The shirt still hangs to below the hip, over the tee.
    assert.ok(result.metrics.fit?.hemBelowHip !== undefined && result.metrics.fit.hemBelowHip > 4, `${label}: hem ${result.metrics.fit?.hemBelowHip} cm below the hip`);
    // Open, nothing of the shirt lies over the tee's centre front at the chest.
    const chest = result.body.landmarks?.bust ?? result.body.torso[1]!.y;
    let overFront = 0;
    for (const { part, positions } of result.parts) if (part !== 'collar') for (let i = 0; i < positions.length; i += 3) {
      if (Math.abs(positions[i]!) < 1.5 && positions[i + 2]! > 0 && Math.abs(positions[i + 1]! - chest) < 10) overFront++;
    }
    if (open) assert.equal(overFront, 0, 'the open front shows the tee');
    else assert.ok(overFront > 0, 'buttoned, the placket covers the centre front');
  }
});
