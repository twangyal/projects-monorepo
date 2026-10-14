import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { template, teeMesh } from '../src/product.ts';
test('front and back styling surfaces face outward for native decal projection and rendering', () => {
  for (const id of ['blank', 'garden', 'crew-sweat', 'hoodie', 'trousers']) {
    const meshes = teeMesh(template(id), Delaunator);
    for (const side of ['front', 'back'] as const) {
      const mesh = meshes.find(m => m.part === side)!; let outward = 0;
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const [a, b, c] = mesh.indices.slice(i, i + 3).map(j => mesh.positions.slice(j * 3, j * 3 + 3));
        const z = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        const direction = z * (side === 'front' ? 1 : -1);
        assert.ok(direction >= -1e-8, `${id} ${side} triangle ${i / 3} faces inward`);
        if (direction > 1e-8) outward++;
      }
      assert.ok(outward > 100);
    }
  }
});
