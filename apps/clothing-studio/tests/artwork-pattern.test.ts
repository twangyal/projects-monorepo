import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { pngUrl } from './helpers/raster.ts';
import { ARTWORK_SHOULDER_OFFSET } from '../src/artwork-placement.ts';
import { artworkMarks, placementOnPattern, type ArtworkMark } from '../src/artwork-pattern.ts';
import { patternDxf, patternSvg } from '../src/pattern-export.ts';
import {
  artworkDefaults, bottomsArtworkFrame, panelSize, patternPieces, sleeveArtworkFrame, sleeveArtworkUv, teeMesh, template, topMeasurements, validateProduct,
  type Artwork, type Product,
} from '../src/product.ts';

type Pt = { x: number; y: number };
// A print twice as wide as it is tall.
const art = (product: Product, part: Artwork['part'], placed: Partial<Artwork> = {}): Artwork =>
  ({ part, dataUrl: pngUrl(100, 50), width: 100, height: 50, name: 'mark.png', ...artworkDefaults(product, part), ...placed });
const wearing = (id: string, prints: [Artwork['part'], Partial<Artwork>][]) => {
  const product = template(id) as Product;
  product.artwork = prints.map(([part, placed]) => art(product, part, placed));
  return validateProduct(product);
};
const box = (mark: ArtworkMark) => {
  const all = mark.lines.flat(), xs = all.map(p => p.x), ys = all.map(p => p.y);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
};
const near = (actual: number, expected: number, why: string, within = 1e-6) => assert.ok(Math.abs(actual - expected) <= within, `${why}: ${actual} vs ${expected}`);
const sameBox = (mark: ArtworkMark, expected: ReturnType<typeof box>, why: string) => {
  const actual = box(mark);
  for (const key of ['left', 'right', 'top', 'bottom'] as const) near(actual[key], expected[key], `${why} ${key}`);
};
const closed = (line: Pt[]) => Math.hypot(line[0]!.x - line.at(-1)!.x, line[0]!.y - line.at(-1)!.y) < 1e-6;
function inside(p: Pt, polygon: Pt[]) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
const distanceTo = (p: Pt, polygon: Pt[]) => Math.min(...polygon.map((a, i) => {
  const b = polygon[(i + 1) % polygon.length]!, dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
}));
const outlineOf = (product: Product, part: string) => patternPieces(product).find(piece => piece.part === part)!.outline;

/** Where the 3D view puts a point of a body piece: the mesh point under a point of the pattern piece, found through the
 * mesh's flat coordinates (from where the piece starts). */
function worldAt(product: Product, part: 'front' | 'back', point: Pt, side?: (x: number) => boolean): { x: number; y: number; z: number } {
  const mesh = teeMesh(product, Delaunator).find(item => item.part === part)!, U = mesh.uvs, P = mesh.positions, I = mesh.indices;
  const outline = outlineOf(product, part), n = U.length / 2;
  const shift = { x: Math.min(...outline.map(p => p.x)) - Math.min(...Array.from({ length: n }, (_, v) => U[v * 2]!)), y: Math.min(...outline.map(p => p.y)) - Math.min(...Array.from({ length: n }, (_, v) => U[v * 2 + 1]!)) };
  const flat = { x: point.x - shift.x, y: point.y - shift.y };
  let best: { x: number; y: number; z: number } | null = null, bestGap = Infinity;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t]!, I[t + 1]!, I[t + 2]!];
    if (side && !side(P[a * 3]! + P[b * 3]! + P[c * 3]!)) continue;
    const d = (U[b * 2 + 1]! - U[c * 2 + 1]!) * (U[a * 2]! - U[c * 2]!) + (U[c * 2]! - U[b * 2]!) * (U[a * 2 + 1]! - U[c * 2 + 1]!);
    if (Math.abs(d) < 1e-12) continue;
    const wa = ((U[b * 2 + 1]! - U[c * 2 + 1]!) * (flat.x - U[c * 2]!) + (U[c * 2]! - U[b * 2]!) * (flat.y - U[c * 2 + 1]!)) / d;
    const wb = ((U[c * 2 + 1]! - U[a * 2 + 1]!) * (flat.x - U[c * 2]!) + (U[a * 2]! - U[c * 2]!) * (flat.y - U[c * 2 + 1]!)) / d, wc = 1 - wa - wb;
    const gap = Math.max(0, -wa, -wb, -wc);
    if (gap >= bestGap) continue;
    bestGap = gap;
    best = { x: wa * P[a * 3]! + wb * P[b * 3]! + wc * P[c * 3]!, y: wa * P[a * 3 + 1]! + wb * P[b * 3 + 1]! + wc * P[c * 3 + 1]!, z: wa * P[a * 3 + 2]! + wb * P[b * 3 + 2]! + wc * P[c * 3 + 2]! };
  }
  assert.ok(best && bestGap < 0.05, `a mesh triangle under (${point.x.toFixed(2)}, ${point.y.toFixed(2)})`);
  return best!;
}

test('a print on a top’s body is its own rectangle on the cut piece, right side up, where the 3D view puts it', () => {
  const tee = wearing('blank', [['front', { xCm: 0, yCm: 10, widthCm: 24 }], ['back', { xCm: 6, yCm: 12, widthCm: 24, rotation: 90 }]]);
  const half = panelSize(topMeasurements(tee)).width / 2, [front, back] = artworkMarks(tee);
  assert.equal(artworkMarks(tee).length, 2);
  assert.deepEqual([front!.part, front!.turned, front!.lines.length, closed(front!.lines[0]!)], ['front', false, 1, true]);
  sameBox(front!, { left: half - 12, right: half + 12, top: ARTWORK_SHOULDER_OFFSET + 10, bottom: ARTWORK_SHOULDER_OFFSET + 22 }, 'front');
  assert.equal(front!.label, 'Front artwork (mark.png), 24 × 12 cm');
  assert.deepEqual(front!.image && { ...front.image, region: front.image.region.length }, { centre: { x: half, y: 20 }, width: 24, height: 12, rotation: 0, region: outlineOf(tee, 'front').length });
  // Behind, across is measured as seen from behind, and a quarter turn stands the print upright on the piece.
  const middle = ARTWORK_SHOULDER_OFFSET + 12 + 6;
  sameBox(back!, { left: half + 6 - 6, right: half + 6 + 6, top: middle - 12, bottom: middle + 12 }, 'back');
  // The pieces' marks are where the 3D view prints: the mesh under each print's centre is the decal's centre.
  const length = topMeasurements(tee).length;
  for (const [mark, x] of [[front!, 0], [back!, -6]] as const) {
    const placed = tee.artwork[mark.index]!, height = placed.widthCm * placed.height / placed.width, at = worldAt(tee, mark.part as 'front' | 'back', mark.image!.centre);
    near(at.x, x, `${mark.part} centre across`, 0.01); near(at.y, length - ARTWORK_SHOULDER_OFFSET - placed.yCm - height / 2, `${mark.part} centre height`, 0.01);
  }
});

test('marks follow the piece a top’s body is cut as: below a shirt’s back yoke, on a dress’s bodice and on a front cut in halves', () => {
  for (const [id, part, xCm] of [['shirt', 'back', 3], ['fit-flare', 'front', -4], ['blazer', 'front', -8], ['zip-hoodie', 'back', 0]] as const) {
    const product = wearing(id, [[part, { xCm, yCm: 12, widthCm: 10 }]]), [mark] = artworkMarks(product), length = topMeasurements(product).length;
    assert.ok(mark?.image, `${id} ${part} is marked`);
    const at = worldAt(product, part, mark.image.centre);
    near(at.x, part === 'front' ? xCm : -xCm, `${id} ${part} across`, 0.01);
    near(at.y, length - ARTWORK_SHOULDER_OFFSET - 12 - 2.5, `${id} ${part} height`, 0.01);
    assert.ok(mark.lines.flat().every(p => inside(p, outlineOf(product, part)) || distanceTo(p, outlineOf(product, part)) < 1e-6), `${id}: on the piece`);
  }
});

test('on a front cut as a mirrored pair, the wearer’s left front’s part of a print is drawn as the pattern lands turned over', () => {
  const shirt = wearing('shirt', [['front', { xCm: 0, yCm: 10, widthCm: 20 }]]), half = panelSize(topMeasurements(shirt)).width / 2;
  const [right, left] = artworkMarks(shirt);
  assert.equal(artworkMarks(shirt).length, 2);
  assert.deepEqual([right!.turned, left!.turned], [false, true]);
  assert.match(right!.label, /, wearer’s right front$/);
  assert.match(left!.label, /, wearer’s left front, pattern turned over$/);
  // Each holds the print's half from its own side seam to the centre front, where the line stays open.
  for (const mark of [right!, left!]) {
    sameBox(mark, { left: half - 10, right: half, top: ARTWORK_SHOULDER_OFFSET + 10, bottom: ARTWORK_SHOULDER_OFFSET + 20 }, mark.label);
    assert.equal(mark.lines.length, 1); assert.equal(closed(mark.lines[0]!), false);
  }
  // The image is laid only on the piece drawn right side up, up to the centre front.
  assert.ok(right!.image && Math.max(...right.image.region.map(p => p.x)) <= half + 1e-9);
  assert.equal(left!.image, undefined);
  // A chest print on the wearer's left lies only on the turned-over piece.
  const hoodie = wearing('zip-hoodie', [['front', { xCm: 9, yCm: 12, widthCm: 8 }]]);
  assert.deepEqual(artworkMarks(hoodie).map(mark => [mark.turned, mark.label.endsWith('wearer’s left front, pattern turned over')]), [[true, true]]);
});

test('a print that runs off a piece is cut back to it, open where it leaves', () => {
  const tee = wearing('blank', [['front', { xCm: 20, yCm: 30, widthCm: 20 }]]), outline = outlineOf(tee, 'front'), [mark] = artworkMarks(tee);
  assert.ok(mark && mark.lines.every(line => !closed(line)));
  assert.ok(mark.lines.flat().every(p => inside(p, outline) || distanceTo(p, outline) < 1e-6));
  near(box(mark).right, Math.max(...outline.map(p => p.x)), 'stops at the side seam', 0.5);
});

test('sleeve prints are drawn right side up on either sleeve, where the 3D view prints them', () => {
  const tee = wearing('blank', [['sleeveLeft', { xCm: 2, yCm: 5, widthCm: 8 }], ['sleeveRight', { xCm: 2, yCm: 5, widthCm: 8 }]]), frame = sleeveArtworkFrame(tee);
  const [left, right] = artworkMarks(tee);
  for (const mark of [left!, right!]) {
    assert.equal(mark.part, tee.artwork[mark.index]!.part);
    assert.deepEqual(mark.image && { ...mark.image, region: mark.image.region.length }, { centre: { x: frame.centre + 2, y: 7 }, width: 8, height: 4, rotation: 0, region: frame.outline.length });
    assert.ok(closed(mark.lines[0]!));
  }
  // In 3D the right sleeve's own flat coordinates run the other way: its print's centre is across the centre line there.
  assert.deepEqual(sleeveArtworkUv(frame, tee.artwork[1]!)(frame.centre - 2, 7).map(v => Math.round(v * 1e6) / 1e6), [0.5, 0.5]);
  assert.deepEqual(sleeveArtworkUv(frame, tee.artwork[0]!)(frame.centre + 2, 7).map(v => Math.round(v * 1e6) / 1e6), [0.5, 0.5]);
});

/** How far a point of a bottoms mark lies from the 3D decal box's edge, as seen from its side (zero on the edge). */
function offEdge(product: Product, mark: ArtworkMark, point: Pt): number {
  const placed = product.artwork[mark.index]!, front = placed.part === 'front', height = placed.widthCm * placed.height / placed.width;
  const centre = { x: front ? placed.xCm : -placed.xCm, y: bottomsArtworkFrame(product).top - placed.yCm - height / 2 };
  const leg = /wearer’s (right|left) leg/.exec(mark.label)?.[1], at = worldAt(product, placed.part as 'front' | 'back', point, leg ? sum => (leg === 'right' ? sum < 0 : sum >= 0) : undefined);
  return Math.min(Math.abs(Math.abs(at.x - centre.x) - placed.widthCm / 2), Math.abs(Math.abs(at.y - centre.y) - height / 2));
}

test('on trousers a print’s edges are traced through the legs onto each leg’s piece, the other leg turned over', () => {
  const trousers = wearing('trousers', [['front', { xCm: 0, yCm: 12, widthCm: 24 }], ['back', { xCm: 8, yCm: 8, widthCm: 8 }]]);
  const marks = artworkMarks(trousers), fronts = marks.filter(mark => mark.part === 'front'), [back] = marks.filter(mark => mark.part === 'back');
  // Across the centre seam the print lies on both front legs: the pattern is the wearer's right leg, right side up.
  assert.deepEqual(fronts.map(mark => [mark.turned, /wearer’s (\w+) leg/.exec(mark.label)?.[1]]), [[false, 'right'], [true, 'left']]);
  assert.ok(fronts.every(mark => !mark.image));
  // Behind, the pattern is the wearer's left leg; a print right of centre seen from behind is on the right leg.
  assert.deepEqual([back!.turned, /wearer’s (\w+) leg/.exec(back!.label)?.[1], closed(back!.lines[0]!)], [true, 'right', true]);
  for (const mark of marks) {
    const outline = outlineOf(trousers, mark.part);
    assert.ok(mark.lines.flat().every(p => inside(p, outline) || distanceTo(p, outline) < 0.1), `${mark.label}: on the piece`);
    // Every traced point is on the print's edge as the 3D view projects it.
    for (const line of mark.lines) for (const p of line) assert.ok(offEdge(trousers, mark, p) < 0.02, `${mark.label}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) is ${offEdge(trousers, mark, p).toFixed(3)} cm off the edge`);
  }
  // The legs turn away from the centre seam, so the flat print is wider than it looks from the front.
  assert.ok(fronts.every(mark => box(mark).right - box(mark).left > 12), 'each leg holds over half the print');
});

test('a skirt’s print widens on the flat piece where the skirt turns away, and a jeans print sits below the yoke', () => {
  const skirt = wearing('flared-skirt', [['front', { xCm: 0, yCm: 10, widthCm: 20 }]]), [mark] = artworkMarks(skirt);
  assert.ok(mark && !mark.turned && closed(mark.lines[0]!));
  assert.equal(mark.label, 'Front artwork (mark.png), 20 × 10 cm');
  assert.ok(box(mark).right - box(mark).left > 20, `${box(mark).right - box(mark).left} cm across`);
  for (const p of mark.lines[0]!) assert.ok(offEdge(skirt, mark, p) < 0.02);
  const jeans = wearing('jeans', [['back', { xCm: -8, yCm: 9, widthCm: 8 }]]), [pocket] = artworkMarks(jeans);
  assert.ok(pocket && !pocket.turned && /wearer’s left leg$/.test(pocket.label));
  assert.ok(pocket.lines.flat().every(p => inside(p, outlineOf(jeans, 'back')) || distanceTo(p, outlineOf(jeans, 'back')) < 0.1));
  for (const p of pocket.lines[0]!) assert.ok(offEdge(jeans, pocket, p) < 0.02);
});

test('the pattern files mark each print on its piece, with its name and size', () => {
  const shirt = wearing('shirt', [['front', { xCm: 0, yCm: 10, widthCm: 20 }], ['sleeveLeft', { xCm: 0, yCm: 6, widthCm: 6 }]]);
  const svg = patternSvg(shirt);
  assert.equal(svg.match(/<g data-artwork="front"/g)?.length, 2);
  assert.equal(svg.match(/<g data-artwork="front" data-turned="">/g)?.length, 1);
  assert.match(svg, /<g data-artwork="sleeveLeft"><polyline points="[^"]+" fill="none" stroke="#7b3fa0"/);
  assert.match(svg, />Front artwork \(mark\.png\), 20 × 10 cm, wearer’s left front, pattern turned over</);
  assert.match(svg, /Purple dotted: where artwork is printed, right side of the fabric up/);
  const dxf = patternDxf(shirt), lines = dxf.trim().split('\n'), pairs: [string, string][] = [];
  for (let i = 0; i < lines.length; i += 2) pairs.push([lines[i]!.trim(), lines[i + 1]!]);
  const polylines = pairs.flatMap((pair, i) => (pair[0] === '0' && pair[1] === 'POLYLINE' && pairs[i + 1]![1] === 'ARTWORK' ? [pairs.slice(i, i + 5).find(p => p[0] === '70')![1]] : []));
  // The fronts' halves stay open at the centre front; the sleeve's print is a closed rectangle.
  assert.deepEqual(polylines, ['0', '0', '1']);
  assert.ok(dxf.includes('\n8\nARTWORK\n') && dxf.includes('Left sleeve artwork (mark.png), 6 \\U+00D7 3 cm'));
  // Without artwork, nothing is added.
  const plain = template('shirt');
  assert.ok(!patternDxf(plain).includes('ARTWORK') && !patternSvg(plain).includes('data-artwork') && !patternSvg(plain).includes('Purple dotted'));
});

test('traced edges match the decal three.js builds in 3D, turned or not, in front and behind', () => {
  for (const [id, part, placed] of [['trousers', 'back', { xCm: 8, yCm: 10, widthCm: 10, rotation: 30 }], ['trousers', 'front', { xCm: 0, yCm: 12, widthCm: 24, rotation: -10 }],
    ['flared-skirt', 'front', { xCm: 3, yCm: 8, widthCm: 16, rotation: -20 }], ['pleated-skirt', 'back', { xCm: 0, yCm: 10, widthCm: 10 }]] as const) {
    const product = wearing(id, [[part, placed]]), marks = artworkMarks(product), print = product.artwork[0]!, front = part === 'front', height = print.widthCm * print.height / print.width;
    const rest = teeMesh(product, Delaunator).find(mesh => mesh.part === part)!, geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(rest.positions, 3)); geometry.setIndex(rest.indices);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.updateMatrixWorld(true);
    // As Product3D.addDecal places it.
    const x = front ? print.xCm : -print.xCm, y = bottomsArtworkFrame(product).top - print.yCm - height / 2;
    const hit = new THREE.Raycaster(new THREE.Vector3(x, y, front ? 200 : -200), new THREE.Vector3(0, 0, front ? -1 : 1)).intersectObject(mesh)[0]!;
    const decal = new DecalGeometry(mesh, hit.point, new THREE.Euler(0, front ? 0 : Math.PI, -(print.rotation ?? 0) * Math.PI / 180), new THREE.Vector3(print.widthCm, height, 30));
    const position = decal.getAttribute('position'), uv = decal.getAttribute('uv'), outline = outlineOf(product, part), n = rest.uvs.length / 2;
    const shift = { x: Math.min(...outline.map(p => p.x)) - Math.min(...Array.from({ length: n }, (_, v) => rest.uvs[v * 2]!)), y: Math.min(...outline.map(p => p.y)) - Math.min(...Array.from({ length: n }, (_, v) => rest.uvs[v * 2 + 1]!)) };
    let checked = 0;
    for (let v = 0; v < position.count; v++) {
      const u = uv.getX(v), w = uv.getY(v);
      if (![u, w].some(value => Math.abs(value) < 1e-4 || Math.abs(value - 1) < 1e-4)) continue;
      // The decal's edge point on the garment, then on the flat piece through the triangle it lies on.
      const p = new THREE.Vector3(position.getX(v), position.getY(v), position.getZ(v));
      let flat: Pt | null = null, side = 0, gap = Infinity, hidden = false;
      for (let t = 0; t < rest.indices.length; t += 3) {
        const corners = [0, 1, 2].map(k => rest.indices[t + k]!), [a, b, c] = corners.map(k => new THREE.Vector3(rest.positions[k * 3], rest.positions[k * 3 + 1], rest.positions[k * 3 + 2]));
        const triangle = new THREE.Triangle(a, b, c), closest = triangle.closestPointToPoint(p, new THREE.Vector3()), distance = closest.distanceTo(p);
        if (distance >= gap) continue;
        const weights = triangle.getBarycoord(closest, new THREE.Vector3());
        if (!weights) continue;
        gap = distance; side = a.x + b.x + c.x < 0 ? 0 : 1; hidden = !!rest.layers && corners.some(k => rest.layers![k]! >= 1);
        flat = { x: corners.reduce((sum, k, i) => sum + weights.getComponent(i) * rest.uvs[k * 2]!, 0) + shift.x, y: corners.reduce((sum, k, i) => sum + weights.getComponent(i) * rest.uvs[k * 2 + 1]!, 0) + shift.y };
      }
      assert.ok(flat && gap < 1e-3, `${id} ${part}: decal point on the garment`);
      // A pleat's hidden underlays carry the decal in 3D but no mark.
      if (hidden) continue;
      const leg = /wearer’s (right|left) leg/, lines = marks.filter(mark => !leg.test(mark.label) || leg.exec(mark.label)![1] === (side === 0 ? 'right' : 'left')).flatMap(mark => mark.lines);
      const off = Math.min(...lines.flatMap(line => line.slice(1).map((q, i) => distanceTo(flat!, [line[i]!, q]))));
      assert.ok(off < 0.02, `${id} ${part}: decal edge at (${flat!.x.toFixed(2)}, ${flat!.y.toFixed(2)}) is ${off.toFixed(3)} cm from the marks`);
      checked++;
    }
    assert.ok(checked > 20, `${id} ${part}: ${checked} edge points checked`);
    geometry.dispose(); decal.dispose();
  }
});

test('a flat print put down elsewhere on its piece moves by as much, front, back, sleeve and half front alike', () => {
  for (const [id, part, placed] of [['blank', 'front', { xCm: 2, yCm: 10, widthCm: 20 }], ['blank', 'back', { xCm: -4, yCm: 14, widthCm: 16, rotation: 30 }],
    ['blank', 'sleeveRight', { xCm: 1, yCm: 5, widthCm: 6 }], ['shirt', 'front', { xCm: -9, yCm: 12, widthCm: 8 }], ['shirt', 'back', { xCm: 0, yCm: 12, widthCm: 10 }]] as const) {
    const product = wearing(id, [[part, placed]]), [mark] = artworkMarks(product);
    assert.ok(mark?.image, `${id} ${part} is laid flat`);
    assert.deepEqual(placementOnPattern(product, 0, mark.image.centre), { xCm: placed.xCm, yCm: placed.yCm }, `${id} ${part} where it is`);
    assert.deepEqual(placementOnPattern(product, 0, { x: mark.image.centre.x + 3, y: mark.image.centre.y - 2 }), { xCm: placed.xCm + 3, yCm: placed.yCm - 2 }, `${id} ${part} moved`);
  }
  assert.throws(() => placementOnPattern(wearing('trousers', [['front', {}]]), 0, { x: 10, y: 10 }), /Only a print laid flat/);
});
