import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { OPEN_ZIP_GAP, patternPieces, template, teeMesh, validateProduct, type Product } from '../src/product.ts';
import { simulateGarment } from '../src/garment-drape.ts';
import { buildTechPack } from '../src/techpack.ts';

const closed = template('zip-hoodie');
const open = (product: Product = closed) => validateProduct({ ...product, options: { ...product.options!, zipOpen: true } });

test('only a zip hoodie can be worn open, and zipping it up again drops the setting', () => {
  assert.deepEqual(open().options, { hem: 'straight', chestPocket: false, zip: true, zipOpen: true });
  assert.deepEqual(validateProduct({ ...closed, options: { ...closed.options!, zipOpen: false } }).options, closed.options);
  assert.throws(() => validateProduct({ ...template('hoodie'), options: { hem: 'straight', chestPocket: false, zipOpen: true } }), /Only a garment with a front zip can be worn open/);
  assert.throws(() => validateProduct({ ...closed, options: { ...closed.options!, zipOpen: 'yes' } }), /open or closed/);
});

test('worn open, the front halves and hem band part at the centre front; the pattern and tech pack stay the same', () => {
  const parts = (product: Product) => new Map(teeMesh(product, Delaunator).map(mesh => [mesh.part, mesh]));
  const shut = parts(closed), parted = parts(open());
  const near = (positions: number[]) => { let count = 0; for (let i = 0; i < positions.length; i += 3) if (Math.abs(positions[i]!) < OPEN_ZIP_GAP - 1e-6) count++; return count; };
  assert.ok(near(shut.get('front')!.positions) > 0);
  assert.equal(near(parted.get('front')!.positions), 0);
  // The band runs from one side of the parting round the back to the other.
  const band = parted.get('hemBand')!.positions, xs: number[] = [];
  for (let i = 0; i < band.length; i += 3) if (band[i + 2]! > 0) xs.push(band[i]!);
  assert.equal(near(band), 0);
  assert.ok(xs.some(x => Math.abs(x - OPEN_ZIP_GAP) < 1e-6) && xs.some(x => Math.abs(x + OPEN_ZIP_GAP) < 1e-6));
  assert.deepEqual(patternPieces(open()), patternPieces(closed));
  assert.deepEqual(buildTechPack(open(), '2026-11-03'), buildTechPack(closed, '2026-11-03'));
});

test('draped open, the fronts hang apart and settle; closed, they stay together', () => {
  const parting = (product: Product) => {
    const result = simulateGarment(product, teeMesh(product, Delaunator), 100);
    const front = result.parts.find(part => part.part === 'front')!.positions;
    let top = -Infinity;
    for (let i = 1; i < front.length; i += 3) top = Math.max(top, front[i]!);
    let left = Infinity, right = Infinity;
    for (let i = 0; i < front.length; i += 3) if (Math.abs(front[i + 1]! - (top - 22)) < 2) { if (front[i]! > 0) left = Math.min(left, front[i]!); else right = Math.min(right, -front[i]!); }
    return { gap: left + right, metrics: result.metrics };
  };
  const shut = parting(closed), parted = parting(open());
  assert.ok(shut.gap < 3, `closed ${shut.gap}`);
  assert.ok(parted.gap > 12, `open ${parted.gap}`);
  assert.ok(parted.metrics.residualSpeed < 10, `still moving at ${parted.metrics.residualSpeed} cm/s`);
  assert.ok(parted.metrics.maxStrain < 1, `stretch ${parted.metrics.maxStrain}`);
});
