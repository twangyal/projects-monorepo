import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { simulateGarment } from '../src/garment-drape.ts';
import { buildTechPack } from '../src/techpack.ts';
import { YOKE_CM, optionsOf, partsOf, patternPieces, teeMesh, template, validateProduct, withOptions, type Product } from '../src/product.ts';

const shirt = template('shirt') as Product;
const yoked = withOptions(shirt, { ...optionsOf(shirt), yoke: true });
const area = (outline: { x: number; y: number }[]) => Math.abs(outline.reduce((sum, p, i) => { const q = outline[(i + 1) % outline.length]!; return sum + p.x * q.y - q.x * p.y; }, 0)) / 2;

test('a shirt\'s back yoke is its own part, starting in the back\'s style, and only a shirt has one', () => {
  assert.ok(partsOf(yoked).includes('yoke') && !partsOf(shirt).includes('yoke'));
  assert.deepEqual(yoked.parts.yoke, shirt.parts.back);
  assert.equal(validateProduct(yoked).options?.yoke, true);
  // Taken off, the yoke's style goes with it.
  const plain = withOptions(yoked, { ...optionsOf(yoked), yoke: false });
  assert.equal(plain.parts.yoke, undefined);
  assert.throws(() => withOptions(template('blank'), { ...optionsOf(template('blank')), yoke: true }), /A back yoke goes on a shirt: add the button front first/);
  assert.throws(() => validateProduct({ ...yoked, options: { ...yoked.options!, buttons: false } }), /A back yoke goes on a shirt with a button front/);
});

test('the back is cut across below the neck into a double yoke and the back body, in the pattern and in 3D', () => {
  const whole = patternPieces(shirt).find(piece => piece.part === 'back')!, pieces = patternPieces(yoked);
  const yoke = pieces.find(piece => piece.part === 'yoke')!, back = pieces.find(piece => piece.part === 'back')!;
  assert.equal(yoke.cutCount, 2);
  // Together they are the back, the yoke above the seam and the body below it, laid out from the seam down.
  assert.ok(Math.abs(area(yoke.outline) + area(back.outline) - area(whole.outline)) < 1, `${area(yoke.outline)} + ${area(back.outline)} against ${area(whole.outline)}`);
  assert.ok(Math.max(...yoke.outline.map(p => p.y)) <= YOKE_CM + 1e-9);
  assert.equal(Math.min(...back.outline.map(p => p.y)), 0);
  // In 3D the yoke and the back body meet along the seam, point for point, where the drape sews them.
  const mesh = teeMesh(yoked, Delaunator), part = (id: string) => mesh.find(m => m.part === id)!;
  const key = (p: Float32Array | number[], i: number) => `${p[i]!.toFixed(4)},${p[i + 1]!.toFixed(4)},${p[i + 2]!.toFixed(4)}`;
  const yokePoints = new Set<string>();
  for (let i = 0; i < part('yoke').positions.length; i += 3) yokePoints.add(key(part('yoke').positions, i));
  let shared = 0;
  for (let i = 0; i < part('back').positions.length; i += 3) if (yokePoints.has(key(part('back').positions, i))) shared++;
  assert.ok(shared >= 20, `${shared} points shared along the seam`);
});

test('a yoked shirt drapes as one garment, and the tech pack sews the yoke first', () => {
  const result = simulateGarment(yoked, teeMesh(yoked, Delaunator), 94, { frames: 120 });
  assert.ok(result.parts.some(part => part.part === 'yoke'));
  assert.ok(result.metrics.maxStrain < 0.5 && result.metrics.residualSpeed < 10, `strain ${result.metrics.maxStrain}, speed ${result.metrics.residualSpeed}`);
  const rows = buildTechPack(yoked, '2026-11-17').construction.map(row => row.area);
  assert.ok(rows.indexOf('Back yoke') >= 0 && rows.indexOf('Back yoke') < rows.indexOf('Shoulder seams'), rows.join(', '));
  assert.equal(buildTechPack(shirt, '2026-11-17').construction.some(row => row.area === 'Back yoke'), false);
});

test('a yoke is described by name and colour, and a top without buttons is told why it has none', () => {
  const navy = readDesignPrompt('navy yoke', shirt).product;
  assert.ok(optionsOf(navy).yoke);
  assert.equal(navy.parts.yoke!.color, '#1f2a4f');
  assert.equal(navy.parts.back.color, shirt.parts.back.color);
  const red = readDesignPrompt('white shirt with a red yoke', shirt).product;
  assert.notEqual(red.parts.yoke!.color, red.parts.back.color);
  assert.ok(optionsOf(readDesignPrompt('with a back yoke', shirt).product).yoke);
  assert.equal(optionsOf(readDesignPrompt('no yoke', navy).product).yoke, undefined);
  assert.throws(() => readDesignPrompt('navy yoke', template('blank') as Product), /back yoke \(it goes on a shirt with a button front/);
});
