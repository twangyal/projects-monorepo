import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBodyChest, simulateGarment } from '../src/garment-drape.ts';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { patternPieces, template, validateProduct, type Product } from '../src/product.ts';
import { skirtGather, skirtMesh, skirtPanelDraft, type SkirtMeasures } from '../src/product-skirt.ts';
import { gradedProduct } from '../src/size-grades.ts';
import { buildTechPack } from '../src/techpack.ts';

const gathered = (gather?: number): Product => {
  const product = template('flared-skirt');
  if (gather) (product.measurements as SkirtMeasures).gather = gather;
  return validateProduct(product);
};
const waistEdge = (product: Product) => {
  const front = patternPieces(product).find(piece => piece.part === 'front')!;
  const top = front.outline.slice(0, 97);
  return top.slice(1).reduce((sum, point, i) => sum + Math.hypot(point.x - top[i]!.x, point.y - top[i]!.y), 0);
};

test('a gathered skirt is cut with a longer waist edge and keeps its finished waist', () => {
  const plain = gathered(), full = gathered(1.5);
  assert.equal(skirtGather(plain), 1);
  assert.equal(skirtPanelDraft(full).waist, 120);
  assert.ok(Math.abs(waistEdge(full) - 60) < 0.2, `front waist edge ${waistEdge(full)}`);
  assert.ok(Math.abs(waistEdge(plain) - 40) < 0.2, `front waist edge ${waistEdge(plain)}`);
  // The 3D waist starts on the finished waist circle.
  const front = skirtMesh(full).find(mesh => mesh.part === 'front')!, top = Math.max(...front.positions.filter((_, i) => i % 3 === 1));
  for (let i = 0; i < front.positions.length; i += 3) if (front.positions[i + 1]! > top - 1e-6) assert.ok(Math.abs(Math.hypot(front.positions[i]!, front.positions[i + 2]!) - 80 / (2 * Math.PI)) < 1e-4);
  // The waist edge must stay shorter than the hem, and gathering is bounded.
  assert.throws(() => gathered(1.7), /at least 10 cm shorter than the 140 cm hem/);
  assert.throws(() => gathered(1.05), /from 1.1 to 2/);
  const pack = buildTechPack(full, '2026-11-02');
  assert.ok(pack.construction.some(step => step.area === 'Waist gathers' && /120 cm cut waist edge \(1.5 times\) to the 80 cm finished waist/.test(step.detail)));
  assert.equal(skirtGather(gradedProduct(full, 'L')), 1.5);
  assert.equal(template('gathered-skirt').base, 'skirt');
});

test('gathers drape as folds standing off the body, with the waist clear of it', () => {
  const ripple = (product: Product) => {
    const result = simulateGarment(product, skirtMesh(product), defaultBodyChest(product));
    const points = result.parts.filter(part => part.part !== 'waistband').flatMap(part => [...part.positions]);
    let top = -Infinity;
    for (let i = 1; i < points.length; i += 3) top = Math.max(top, points[i]!);
    const radii: number[] = [];
    for (let i = 0; i < points.length; i += 3) if (Math.abs(points[i + 1]! - (top - 8)) < 1.5) radii.push(Math.hypot(points[i]!, points[i + 2]!));
    radii.sort((a, b) => a - b);
    return { spread: radii[Math.floor(radii.length * 0.9)]! - radii[Math.floor(radii.length * 0.1)]!, metrics: result.metrics };
  };
  const plain = ripple(gathered()), full = ripple(gathered(1.5));
  assert.ok(full.spread > plain.spread * 1.5, `radius spread ${full.spread} against ${plain.spread}`);
  assert.ok(full.metrics.contact < plain.metrics.contact, 'gathers stand off the body');
  for (const { metrics } of [plain, full]) {
    assert.ok(metrics.minClearance >= 0.34, `clearance ${metrics.minClearance}`);
    assert.ok(metrics.residualSpeed < 10, `still moving at ${metrics.residualSpeed}`);
  }
});

test('descriptions gather or smooth a skirt waist within what its hem allows', () => {
  const read = (said: string, product = template('flared-skirt')) => readDesignPrompt(said, product);
  assert.equal(skirtGather(read('gathered skirt in navy').product), 1.5);
  const narrow = template('flared-skirt'); (narrow.measurements as SkirtMeasures).hem = 100;
  const tight = read('gathered skirt', validateProduct(narrow));
  assert.equal(skirtGather(tight.product), 1.1);
  assert.equal(skirtGather(read('a smooth waist skirt', template('gathered-skirt')).product), 1);
});
