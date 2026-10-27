import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { drapeTest, specimenMesh, SPECIMEN_RADIUS, SUPPORT_RADIUS, TYPICAL_DRAPE } from '../src/drape-test.ts';
import { MATERIALS, material } from '../src/product.ts';

test('the drape-test specimen is a flat 30 cm disc with a ring exactly at the 18 cm support', () => {
  const mesh = specimenMesh(Delaunator), radii = Array.from({ length: mesh.positions.length / 3 }, (_, v) => Math.hypot(mesh.positions[v * 3]!, mesh.positions[v * 3 + 2]!));
  assert.ok(mesh.positions.every((value, i) => i % 3 !== 1 || value === 0));
  assert.ok(Math.abs(Math.max(...radii) - SPECIMEN_RADIUS) < 1e-9);
  assert.ok(radii.filter(r => Math.abs(r - SUPPORT_RADIUS) < 1e-9).length > 30);
  assert.deepEqual(mesh.uvs.filter((_, i) => i % 2), mesh.positions.filter((_, i) => i % 3 === 2), 'the grain runs along z');
});

test('every library fabric drapes within the coefficients reported for its construction, in a sensible order', () => {
  const results = new Map<string, number>();
  for (const fabric of MATERIALS) {
    const result = drapeTest(fabric, Delaunator), [low, high] = TYPICAL_DRAPE[fabric.texture];
    assert.ok(result.coefficient >= low && result.coefficient <= high, `${fabric.id}: ${result.coefficient} outside ${low}-${high}`);
    assert.ok(result.nodes >= 3 && result.nodes <= 12, `${fabric.id}: ${result.nodes} folds`);
    assert.ok(result.residualSpeed < 10, `${fabric.id} settled`);
    assert.ok(result.outline.length > 50 && result.outline.every(([x, z]) => Math.hypot(x, z) <= SPECIMEN_RADIUS + 1e-6));
    results.set(fabric.id, result.coefficient);
  }
  assert.ok(results.get('jersey-180')! < results.get('linen-170')! && results.get('linen-170')! < results.get('denim-340')!);
  // Heavier cloth of the same construction is stiffer for its weight, so it drapes less.
  assert.ok(results.get('jersey-180')! < results.get('jersey-240')!);
});

test('the drape test is deterministic and can be stopped', () => {
  const jersey = material('jersey-180');
  assert.deepEqual(drapeTest(jersey, Delaunator, { frames: 20 }), drapeTest(jersey, Delaunator, { frames: 20 }));
  let seen = 0;
  drapeTest(jersey, Delaunator, { frames: 50, progress: frame => { seen = frame; return frame < 5; } });
  assert.equal(seen, 5);
  assert.throws(() => drapeTest(jersey, Delaunator, { frames: 0 }), /out of range/);
});
