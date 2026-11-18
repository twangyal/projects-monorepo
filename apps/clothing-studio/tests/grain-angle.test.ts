import Delaunator from 'delaunator';
import test from 'node:test';
import assert from 'node:assert/strict';
import { template, validateProduct, TEMPLATES, teeMesh, bodiceShift, wholeFrontOutline, type Product } from '../src/product.ts';
import { layoutPattern, patternSvg } from '../src/pattern-export.ts';
import { directionalStiffness, fabricProperties, buildCloth, clothFromMeshes } from '../src/garment-drape.ts';
import { buildTechPack, measurementDiagram } from '../src/techpack.ts';
import { designDifferences } from '../src/design-diff.ts';
import { createProject, validateProject } from '../src/model.ts';
import { readStylePrompt } from '../src/style-prompt.ts';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { material } from '../src/materials.ts';

const tilted = (angle: unknown) => {
  const p = template('shirt');
  return { ...p, parts: { ...p.parts, front: { ...p.parts.front, grainAngle: angle } } };
};

test('saved part grain angles round trip while old projects keep their zero-grain default', () => {
  const old = template('shirt'); assert.deepEqual(validateProduct(old), old);
  for (const angle of [-90, -45, 17.5, 45, 90]) {
    const p = validateProduct(tilted(angle));
    assert.equal(p.parts.front.grainAngle, angle);
    assert.deepEqual(validateProduct(JSON.parse(JSON.stringify(p))), p);
  }
});

test('invalid and coerced grain angles refuse instead of silently changing the design', () => {
  for (const angle of [-90.01, 90.01, NaN, Infinity, '45', null, true])
    assert.throws(() => validateProduct(tilted(angle)), /grain angle/i);
});

test('a quarter-turn swaps warp and weft stiffness and a bias follows its own grain axis', () => {
  const props = fabricProperties(material('poplin-120'));
  assert.ok(Math.abs(directionalStiffness(props, 1, 0, 90) - props.tensile) < 1e-5);
  assert.ok(Math.abs(directionalStiffness(props, 0, 1, 90) - props.weft) < 1e-5);
  assert.ok(Math.abs(directionalStiffness(props, 1, -1, 45) - props.tensile) < 1e-5);
  assert.ok(directionalStiffness(props, 0, 1, 45) < props.weft);
});

test('cutting arrows use the part grain without changing sewing or cutting outlines', () => {
  const old = template('shirt'), changed = tilted(45) as Product;
  const before = layoutPattern(old), after = layoutPattern(changed);
  assert.deepEqual(after.pieces.map(p => p.sewing), before.pieces.map(p => p.sewing));
  assert.deepEqual(after.pieces.map(p => p.cutting), before.pieces.map(p => p.cutting));
  const front = after.pieces.find(p => p.piece.part === 'front')!;
  const [a, b] = front.grain;
  assert.ok(Math.abs(Math.abs(b.x - a.x) - Math.abs(b.y - a.y)) < 1e-6);
  assert.ok((b.x - a.x) * (b.y - a.y) < 0, 'positive grain turns clockwise from the upward pattern vertical');
  assert.match(front.detail, /grain 45°/);
});

const inside = (point: {x:number;y:number}, polygon: {x:number;y:number}[]) => {
  let yes = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) yes = !yes;
  }
  return yes;
};
test('grain segments stay inside every template piece, including concave skirts and trims', () => {
  for (const item of TEMPLATES) for (const angle of [-45, 0, 45, 90]) {
    const product = structuredClone(item.product);
    for (const style of Object.values(product.parts)) style.grainAngle = angle;
    for (const piece of layoutPattern(product).pieces) {
      const [a, b] = piece.grain;
      for (let i = 0; i <= 20; i++) {
        const point = { x: a.x + (b.x - a.x) * i / 20, y: a.y + (b.y - a.y) * i / 20 };
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
        assert.ok(inside(point, piece.sewing), `${item.id}/${piece.piece.part}/${angle} arrow leaves the sewing polygon`);
      }
    }
  }
});

test('actual cloth construction uses each part grain while its rest shape stays fixed', () => {
  const mesh = { part: 'front' as const, positions: [0,0,0, 10,0,0, 0,10,0], uvs: [0,0, 10,0, 0,10], indices: [0,1,2] };
  const original = buildCloth(template('shirt'), [mesh]), changed = buildCloth(validateProduct(tilted(90)), [mesh]);
  assert.deepEqual(changed.rest, original.rest); assert.deepEqual(changed.positions, original.positions);
  assert.notDeepEqual(changed.compliance, original.compliance);
});

test('tech packs and saved-version comparisons describe the applied grain', () => {
  const old = template('shirt'), changed = validateProduct(tilted(45)), pack = buildTechPack(changed, '2026-11-18');
  assert.ok(pack.bom.some(row => row.placement.includes('Front body') && row.description.includes('grain 45°')));
  assert.match(measurementDiagram(changed), /data-grain="front"[^>]*data-angle="45"/);
  const before = { ...createProject(), product: old }, after = { ...before, product: changed };
  assert.ok(designDifferences(before, after).some(line => /Front body.*grain 45°/.test(line)));
  const outfit = validateProject({ ...after, wornWith: { ...template('jeans'), parts: { ...template('jeans').parts, front: { ...template('jeans').parts.front, grainAngle: -45 } } } });
  assert.equal(outfit.product?.parts.front.grainAngle, 45); assert.equal(outfit.wornWith?.parts.front.grainAngle, -45);
});

test('colour descriptions preserve independent construction grains instead of resetting or spreading them', () => {
  const p = validateProduct(tilted(45)); p.parts.back.grainAngle = -45; p.parts.collar.grainAngle = 90;
  assert.equal(readStylePrompt('navy', p.parts.front).style.grainAngle, 45);
  const changed = readDesignPrompt('navy', p).product!;
  assert.equal(changed.parts.front.grainAngle, 45); assert.equal(changed.parts.back.grainAngle, -45);
  assert.equal(changed.parts.collar.grainAngle, 90); assert.equal(changed.parts.sleeveLeft.grainAngle, undefined);
});

test('colourway grain angles validate independently and zero is the old canonical default', () => {
  const p = validateProduct(tilted(45));
  p.colorways = [{ id: 'bias', name: 'Bias', units: 1, parts: structuredClone(p.parts) }];
  p.colorways[0]!.parts.front.grainAngle = -45;
  const saved = validateProduct(p);
  assert.equal(saved.parts.front.grainAngle, 45); assert.equal(saved.colorways![0]!.parts.front.grainAngle, -45);
  p.colorways[0]!.parts.front.grainAngle = 91;
  assert.throws(() => validateProduct(p), /grain angle/);
  const zero = validateProduct(tilted(0)); assert.deepEqual(zero, template('shirt'));
});

test('mirror-cut triangles keep source-pattern bias independently of mirrored print UVs', () => {
  const geometry = { part: 'front' as const, positions: [0,0,0, 10,0,0, 0,10,0], indices: [0,1,2] };
  const original = { ...geometry, uvs: [0,0, 10,0, 0,10] };
  const mirror = { ...geometry, uvs: [0,0, -10,0, 0,10], grainMirrors: [-1] };
  const fabric = () => material('poplin-120');
  for (const angle of [-30, 30]) {
    const a = clothFromMeshes([original], fabric, () => angle), b = clothFromMeshes([mirror], fabric, () => angle);
    assert.deepEqual(a.rest, b.rest); assert.deepEqual(a.compliance, b.compliance);
  }
  for (const angle of [0, -90, 90]) {
    const old = clothFromMeshes([mirror], fabric, () => angle);
    const unmarked = clothFromMeshes([{ ...mirror, grainMirrors: undefined }], fabric, () => angle);
    assert.deepEqual(old.compliance, unmarked.compliance, 'axis-aligned existing response stays unchanged');
  }
});

test('generated mirrored fronts, hood panels and split hem bands expose the correct grain basis', () => {
  for (const id of ['shirt', 'zip-hoodie']) {
    const p = template(id), meshes = teeMesh(p, Delaunator);
    for (const part of id === 'shirt' ? ['front'] : ['front', 'hood', 'hemBand']) {
      const mesh = meshes.find(m => m.part === part)!;
      assert.equal(mesh.grainMirrors?.length, mesh.indices.length / 3, `${id}/${part}`);
      assert.deepEqual([...new Set(mesh.grainMirrors)].sort(), [-1, 1], `${id}/${part} has original and mirrored halves`);
    }
    const back = meshes.find(m => m.part === 'back')!;
    assert.ok(back.grainMirrors?.every(sign => sign === -1), 'back print reflection is undone for physical grain');
  }
});

test('a seamed dress grain arrow is placed on the shifted bodice in the whole-front schematic', () => {
  const p = template('fit-flare'); p.parts.front.grainAngle = -90; p.parts.skirtFront.grainAngle = 25;
  assert.ok(bodiceShift(p) > 0);
  const svg = measurementDiagram(p);
  assert.match(svg, /Skirt front grain 25°: see its cutting piece/);
  const match = /<g transform="translate\(([-.0-9]+) 0\)"[^>]*><line data-grain="front"([^>]*)>/.exec(svg)!;
  assert.ok(match); const dx = Number(match[1]);
  const attr = (name: string) => Number(new RegExp(`${name}="([^"]+)"`).exec(match[2]!)![1]);
  for (const i of [1, 2]) assert.ok(inside({ x: attr(`x${i}`) + dx, y: attr(`y${i}`) }, wholeFrontOutline(p)), 'grain endpoint stays inside the drawn front');
});

test('cutting SVG clips marker heads to each sewing outline', () => {
  const p = template('jeans'); p.parts.yoke.grainAngle = -30;
  assert.match(patternSvg(p), /clip-path="url\(#grain-clip-yoke\)"/);
});
