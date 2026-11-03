import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { simulateGarment } from '../src/garment-drape.ts';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { buildTechPack } from '../src/techpack.ts';
import { garmentName, optionsOf, partsOf, patternPieces, PLACKET_CM, teeMesh, template, validateProduct, withOptions } from '../src/product.ts';

test('a polo is a tee with a flat-knit collar in place of the neck rib, and a buttoned placket', () => {
  const polo = validateProduct(template('polo'));
  assert.equal(garmentName(polo), 'Polo shirt');
  assert.deepEqual(partsOf(polo), ['front', 'back', 'sleeveLeft', 'sleeveRight', 'collar', 'placket']);
  assert.equal(polo.parts.collar.material, 'rib-220');
  const pieces = patternPieces(polo);
  assert.ok(pieces.some(piece => piece.part === 'collar') && pieces.some(piece => piece.part === 'placket' && piece.cutCount === 2));
  assert.ok(!pieces.some(piece => piece.part === 'neckband'));
  const pack = buildTechPack(polo, '2026-11-03');
  assert.ok(pack.poms.some(row => row.name === 'Collar height') && pack.poms.some(row => row.name === 'Placket length'));
  assert.ok(pack.construction.some(row => row.area === 'Collar') && pack.construction.some(row => row.area === 'Placket'));
  // On and off: the collar takes the neck rib's style and gives it back.
  const tee = template('ringer'), collared = withOptions(tee, { ...optionsOf(tee), collar: true });
  assert.deepEqual(collared.parts.collar, tee.parts.neckband);
  assert.deepEqual(withOptions(collared, { ...optionsOf(collared), collar: false }).parts.neckband, tee.parts.neckband);
  // Only on a round-necked tee.
  assert.throws(() => withOptions({ ...tee, neckline: 'v' }, { ...optionsOf(tee), collar: true }), /round neck/);
  assert.throws(() => validateProduct({ ...template('hoodie'), options: { hem: 'straight', chestPocket: false, collar: true } }), /A collar goes on a T-shirt/);
});

test('described as a polo, a tee gains the collar and placket and keeps its styling', () => {
  const reading = readDesignPrompt('a navy polo shirt', template('blank'));
  assert.equal(garmentName(reading.product), 'Polo shirt');
  assert.equal(optionsOf(reading.product).collar, true);
  assert.equal(reading.product.parts.front.color.toLowerCase(), reading.product.parts.collar.color.toLowerCase());
});

test('draped, the collar stays folded down over the shoulders, its points lie on the chest and the polo settles', () => {
  const polo = template('polo'), meshes = teeMesh(polo, Delaunator), collar = meshes.find(mesh => mesh.part === 'collar')!;
  const columns = collar.positions.length / 9, at = (positions: ArrayLike<number>, r: number, i: number) => [0, 1, 2].map(k => positions[(r * columns + i) * 3 + k]!);
  // The collar runs round from one edge of the placket to the other.
  const [start, end] = [at(collar.positions, 0, 0), at(collar.positions, 0, columns - 1)];
  assert.ok(Math.sign(start[0]!) === -Math.sign(end[0]!) && Math.abs(start[0]! - end[0]!) <= PLACKET_CM.width + 0.5, `the collar's ends meet the placket (${start[0]!.toFixed(1)}, ${end[0]!.toFixed(1)})`);
  const result = simulateGarment(polo, meshes, 94, { frames: 150 });
  const draped = result.parts.find(part => part.part === 'collar')!.positions;
  const row = (r: number) => { let sum = 0; for (let i = 0; i < columns; i++) sum += draped[(r * columns + i) * 3 + 1]!; return sum / columns; };
  assert.ok(row(1) > row(0), 'the collar stands up from the neckline');
  assert.ok(row(2) < row(1) - 2, `its fall hangs down (${row(2).toFixed(1)} below a stand at ${row(1).toFixed(1)})`);
  // Each point keeps to its own side of the placket and lies on the chest instead of standing off it.
  for (const i of [0, columns - 1]) {
    const neck = at(draped, 0, i), point = at(draped, 2, i);
    assert.equal(Math.sign(point[0]!), Math.sign(neck[0]!), 'the collar points do not cross');
    assert.ok(point[2]! - neck[2]! < 4, `the collar point lies ${(point[2]! - neck[2]!).toFixed(1)} cm in front of the neckline`);
  }
  assert.ok(result.metrics.maxStrain < 0.5 && result.metrics.residualSpeed < 10, `stretch ${result.metrics.maxStrain}, still moving at ${result.metrics.residualSpeed} cm/s`);
  assert.ok(result.parts.some(part => part.part === 'placket'), 'the placket rides on the front');
});
