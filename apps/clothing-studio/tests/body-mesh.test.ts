import test from 'node:test';
import assert from 'node:assert/strict';
import { mannequinDistance, mannequinMesh, surfaceNet } from '../src/body-mesh.ts';
import { garmentBody, outfitBodies } from '../src/garment-drape.ts';
import { template } from '../src/product.ts';

const extent = (positions: Float32Array, axis: number) => {
  let low = Infinity, high = -Infinity;
  for (let i = axis; i < positions.length; i += 3) { low = Math.min(low, positions[i]!); high = Math.max(high, positions[i]!); }
  return [low, high] as const;
};

test('a surface net of a sphere is a closed surface on the sphere, wound outwards', () => {
  const { positions, indices } = surfaceNet((x, y, z) => Math.hypot(x, y, z) - 10, [-12, -12, -12], [12, 12, 12], 1);
  for (let i = 0; i < positions.length; i += 3) assert.ok(Math.abs(Math.hypot(positions[i]!, positions[i + 1]!, positions[i + 2]!) - 10) < 0.6);
  const edges = new Map<string, number>();
  let outward = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t]!, indices[t + 1]!, indices[t + 2]!].map(v => [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!]);
    const u = a!.map((v, i) => b![i]! - v), w = a!.map((v, i) => c![i]! - v);
    const normal = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    if (normal[0]! * a![0]! + normal[1]! * a![1]! + normal[2]! * a![2]! > 0) outward++;
    for (let e = 0; e < 3; e++) { const p = indices[t + e]!, q = indices[t + (e + 1) % 3]!; const key = p < q ? `${p},${q}` : `${q},${p}`; edges.set(key, (edges.get(key) ?? 0) + 1); }
  }
  assert.equal(outward, indices.length / 3, 'every triangle faces out');
  assert.ok([...edges.values()].every(count => count === 2), 'closed');
});

test('the mannequin covers the body the cloth drapes on, from head to hip, and stays just inside it', () => {
  const body = garmentBody(template('blank'), 94, {}), mesh = mannequinMesh(body), distance = mannequinDistance(body);
  assert.ok(mesh.indices.length > 10000);
  for (let i = 0; i < mesh.positions.length; i += 3) assert.ok(distance(mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!) < 0, 'inside the blended form');
  const [, top] = extent(mesh.positions, 1), [left, right] = extent(mesh.positions, 0);
  const head = body.capsules.find(capsule => capsule.a[1] === capsule.b[1] && capsule.a[0] === capsule.b[0] && capsule.radius > 8)!;
  assert.ok(Math.abs(top - (head.a[1] + head.radius)) < 1.5, 'the head is on top');
  const reach = Math.max(...body.capsules.map(capsule => Math.abs(capsule.b[0]) + capsule.end));
  assert.ok(right > reach - 2 && -left > reach - 2, 'the arms reach their wrists');
  assert.equal(mannequinMesh(body), mesh, 'a body already drawn is not built again');
});

test('trousers and an outfit stand on their legs', () => {
  const trousers = garmentBody(template('trousers'), 94, {}), outfit = outfitBodies(template('blank'), template('trousers'), 94).body;
  for (const body of [trousers, outfit]) {
    const mesh = mannequinMesh(body), [bottom] = extent(mesh.positions, 1);
    const ankle = Math.min(...body.capsules.map(capsule => capsule.b[1] - capsule.end));
    assert.ok(Math.abs(bottom - ankle) < 1.5, `down to the ankles (${bottom.toFixed(1)} against ${ankle.toFixed(1)})`);
  }
});
