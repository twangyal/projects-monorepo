import test from 'node:test';
import assert from 'node:assert/strict';
import { MATERIALS, material } from '../src/materials.ts';
import { STUDIO_BACKDROPS, STUDIO_HEIGHT, STUDIO_TURN, STUDIO_VIEWS, STUDIO_WIDTH, fabricLook, studioChoice, studioDistance } from '../src/studio-render.ts';

test('fabrics keep their lustre and gain the sheen of their fibres under studio light', () => {
  const look = (id: string) => fabricLook(material(id));
  assert.ok(look('nylon-150').roughness < look('poplin-120').roughness, 'nylon shines more than cotton poplin');
  assert.ok(look('lining-90').roughness < 0.5, 'viscose lining is lustrous');
  assert.ok(look('terry-300').sheen > look('jersey-180').sheen && look('jersey-180').sheen > look('poplin-120').sheen, 'brushed terry, then knits, then smooth wovens');
  assert.ok(look('wool-260').sheen > look('denim-340').sheen, 'wool twill has a softer sheen than denim twill');
  for (const fabric of MATERIALS) {
    const each = fabricLook(fabric);
    assert.ok(each.roughness >= 0.3 && each.roughness <= 0.95, fabric.id);
    assert.ok(each.sheen > 0 && each.sheen <= 0.6 && each.sheenRoughness > 0 && each.sheenRoughness <= 1, fabric.id);
  }
});

test('the camera frames the whole garment with a margin, whatever its shape', () => {
  const tan = Math.tan(10 * Math.PI / 180), aspect = STUDIO_WIDTH / STUDIO_HEIGHT;
  for (const size of [{ x: 60, y: 80, z: 30 }, { x: 150, y: 70, z: 30 }, { x: 50, y: 110, z: 40 }]) {
    // At the garment's nearest face, half the frame's height and width.
    const near = studioDistance(size, 20, aspect) - size.z / 2, halfHeight = near * tan, halfWidth = halfHeight * aspect;
    assert.ok(size.y / 2 < halfHeight && size.x / 2 < halfWidth, `${JSON.stringify(size)} fits`);
    assert.ok(Math.max(size.y / 2 / halfHeight, size.x / 2 / halfWidth) > 0.8, `${JSON.stringify(size)} fills most of the frame`);
  }
});

test('the workspace offers four views and three backdrops, and nothing else', () => {
  assert.deepEqual(Object.keys(STUDIO_VIEWS), ['front', 'three-quarter', 'side', 'back']);
  assert.deepEqual(Object.keys(STUDIO_BACKDROPS), ['studio', 'white', 'transparent']);
  assert.deepEqual(STUDIO_TURN, { front: 0, 'three-quarter': 35, side: 90, back: 180 });
  assert.deepEqual([STUDIO_WIDTH, STUDIO_HEIGHT], [1600, 2000]);
  assert.deepEqual(studioChoice('side', 'white'), { view: 'side', backdrop: 'white' });
  assert.throws(() => studioChoice('top', 'white'), /Choose a studio view/);
  assert.throws(() => studioChoice('toString', 'white'), /Choose a studio view/);
  assert.throws(() => studioChoice('front', 'black'), /Choose a backdrop/);
});
