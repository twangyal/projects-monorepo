import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { simulateGarment } from '../src/garment-drape.ts';
import { buildTechPack } from '../src/techpack.ts';
import {
  LAPEL_CM, LAPEL_LIFT_CM, LAPEL_UV_SHIFT, garmentName, lapelShape, optionsOf, partsOf, patternPieces, placketOf, teeDimensions, teeMesh, template, topMeasurements, validateProduct,
  withOptions, withSleeveLength, type PartMesh, type Product,
} from '../src/product.ts';

const blazer = template('blazer') as Product, coat = template('coat') as Product, shirt = template('shirt') as Product;
const points = (mesh: PartMesh) => Array.from({ length: mesh.positions.length / 3 }, (_, v) => [mesh.positions[v * 3]!, mesh.positions[v * 3 + 1]!, mesh.positions[v * 3 + 2]!] as const);
// Where the roll line is across (from the centre front) at a flat height y below the neck points.
const rollX = (product: Product, y: number) => { const [B, R] = lapelShape(product).roll; return B.x + (R.x - B.x) * (y - B.y) / (R.y - B.y); };

test('a coat can have notched lapels: it buttons below them, from the waist, without a placket', () => {
  assert.deepEqual(optionsOf(blazer), { hem: 'straight', chestPocket: false, buttons: true, collar: true, coat: true, lapels: true });
  assert.ok(partsOf(blazer).includes('lapel') && !partsOf(blazer).includes('placket'));
  assert.equal(garmentName(blazer), 'Blazer');
  // Lapels on the coat make a long coat with lapels; they take its placket's place, and start in the front's style.
  const lapelled = withOptions(coat, { ...optionsOf(coat), lapels: true });
  assert.equal(garmentName(lapelled), 'Coat');
  assert.deepEqual(lapelled.parts.lapel, coat.parts.front);
  assert.equal(lapelled.parts.placket, undefined);
  // A jacket's buttons start at the break point, at the waist: two on a blazer, three on a long coat.
  assert.equal(lapelShape(blazer).breakY, teeDimensions(blazer).waistY);
  assert.equal(placketOf(blazer).buttons, 2);
  assert.equal(placketOf(lapelled).buttons, 3);
  // Lapels go on a coat only.
  assert.throws(() => withOptions(shirt, { ...optionsOf(shirt), lapels: true }), /Lapels go on a coat: make it a coat first/);
  assert.throws(() => validateProduct({ ...blazer, options: { ...optionsOf(blazer), coat: false } }), /Lapels go on a coat/);
  // Short sleeves make a coat a shirt again: its lapels go, and it buttons on a placket.
  const short = withSleeveLength(structuredClone(blazer), 21);
  assert.equal(optionsOf(short).lapels, undefined);
  assert.ok(short.parts.placket && !short.parts.lapel);
  assert.doesNotThrow(() => validateProduct(short));
});

test('in 3D the front opens in a V to the top button, each lapel lies on it rolled along its fold, and the collar runs between them', () => {
  const meshes = teeMesh(blazer, Delaunator), top = topMeasurements(blazer).length, { breakY, roll } = lapelShape(blazer);
  const front = points(meshes.find(part => part.part === 'front')!), lapel = points(meshes.find(part => part.part === 'lapel')!);
  // Nothing of the front lies inside the V above the top button.
  const inV = front.filter(([x, y]) => top - y < breakY - 0.5 && Math.abs(x) < rollX(blazer, top - y) - 0.5 && top - y > roll[1].y + 0.5);
  assert.equal(inV.length, 0, JSON.stringify(inV.slice(0, 3)));
  assert.ok(front.some(([x, y]) => top - y > breakY + 1 && Math.abs(x) < 0.5), 'below the top button the fronts meet');
  // The lapels lie outside the V, above the top button, off the front; they roll up most along the fold.
  assert.ok(lapel.every(([x, y]) => top - y <= breakY + 1e-6 && Math.abs(x) >= rollX(blazer, top - y) - 1e-6), 'a lapel point inside the V');
  const height = (x: number, y: number) => { const near = front.reduce((best, p) => (Math.hypot(p[0] - x, p[1] - y) < Math.hypot(best[0] - x, best[1] - y) ? p : best)); return near[2]; };
  const lifts = lapel.map(([x, y, z]) => ({ off: z - height(x, y), fold: Math.abs(Math.abs(x) - rollX(blazer, top - y)) }));
  assert.ok(lifts.every(item => item.off > LAPEL_LIFT_CM - 0.4), `${Math.min(...lifts.map(item => item.off))}`);
  const atFold = lifts.filter(item => item.fold < 0.5), atEdge = lifts.filter(item => item.fold > 4);
  assert.ok(atFold.length && atEdge.length && Math.min(...atFold.map(item => item.off)) > Math.max(...atEdge.map(item => item.off)), 'rolled along the fold');
  // Their flat coordinates are clear of zero, for the edge stitching drawn on them.
  assert.ok(meshes.find(part => part.part === 'lapel')!.uvs.every((value, i) => i % 2 || value > 0));
  // Round the front, the collar ends at the roll lines, where the lapels begin (it crosses the centre back behind).
  const collar = points(meshes.find(part => part.part === 'collar')!).filter(([, , z]) => z > 0), ends = Math.min(...collar.map(([x]) => Math.abs(x)));
  assert.ok(Math.abs(ends - roll[1].x) < 2.5, `${ends} against ${roll[1].x}`);
});

test('the pattern cuts each lapel on its front, folding along the marked roll line, with a facing instead of a placket', () => {
  const pieces = patternPieces(blazer), front = pieces.find(piece => piece.part === 'front')!, facing = pieces.find(piece => piece.part === 'lapel')!;
  assert.ok(!pieces.some(piece => piece.part === 'placket'));
  assert.equal(facing.cutCount, 2);
  assert.equal(front.cutCount, 2);
  const [B, R] = front.foldLine!, plain = patternPieces(withOptions(blazer, { ...optionsOf(blazer), lapels: false })).find(piece => piece.part === 'front')!;
  // The roll line runs from the centre front at the top button up and out to the neckline.
  assert.ok(Math.abs(B.y - lapelShape(blazer).breakY) < 1e-9 && R.y < B.y && R.x < B.x, JSON.stringify([B, R]));
  // Beyond the centre front above the top button the front carries the lapel, as wide at its point as it lies.
  const beyond = Math.max(...front.outline.filter(p => p.y < B.y).map(p => p.x)) - B.x;
  assert.ok(beyond > 1, `${beyond}`);
  assert.ok(front.areaCm2 > plain.areaCm2, `${front.areaCm2} against ${plain.areaCm2}`);
  const distance = (p: { x: number; y: number }) => Math.abs((R.x - B.x) * (B.y - p.y) - (B.x - p.x) * (R.y - B.y)) / Math.hypot(R.x - B.x, R.y - B.y);
  const widest = Math.max(...front.outline.filter(p => p.x > B.x - 6 && p.y < B.y).map(distance));
  assert.ok(Math.abs(widest - LAPEL_CM) < 0.5, `${widest}`);
  // The facing shares the lapel's edge and runs to the hem.
  assert.ok(front.outline.filter(p => p.x > B.x).every(p => facing.outline.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6)));
  assert.ok(Math.abs(facing.height - front.height) < 1e-6);
});

test('the tech pack sews the lapels and the collar between them, and buttons the coat from the break point', () => {
  const pack = buildTechPack(blazer, '2026-11-18'), d = teeDimensions(blazer);
  const buttons = pack.bom.find(row => row.item === 'B1 Buttons')!;
  assert.equal(buttons.quantity, '2');
  assert.match(buttons.placement, /^Centre front, from the top button at the break point down, 10\.0 cm apart$/);
  const pom = (name: string) => pack.poms.find(row => row.name === name);
  assert.equal(pom('Break point')!.values[pack.sampleSize], d.waistY);
  assert.equal(pom('Lapel width')!.values[pack.sampleSize], LAPEL_CM);
  assert.equal(pom('Placket length'), undefined);
  assert.match(pack.construction.find(row => row.area === 'Fronts and lapels')!.operation, /press the lapel back along the roll line/);
  assert.match(pack.construction.find(row => row.area === 'Collar')!.operation, /between the roll lines, notched where it meets each lapel/);
  assert.match(pack.construction.find(row => row.area === 'Body hem')!.detail, /the facings run down to the hem/);
});

test('a blazer drapes without overstretching, its lapels staying on the front', () => {
  const meshes = teeMesh(blazer, Delaunator), result = simulateGarment(blazer, meshes, 104, { frames: 120 });
  assert.ok(result.metrics.maxStrain < 0.35, `strain ${result.metrics.maxStrain}`);
  const draped = (part: string) => { const flat = result.parts.find(item => item.part === part)!.positions; return Array.from({ length: flat.length / 3 }, (_, v) => [flat[v * 3]!, flat[v * 3 + 1]!, flat[v * 3 + 2]!] as const); };
  const front = draped('front');
  for (const p of draped('lapel')) assert.ok(Math.min(...front.map(q => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]))) < 3, 'a lapel point left the front');
});

test('descriptions make a blazer, add or take off lapels, and style them', () => {
  const described = readDesignPrompt('blazer', shirt).product;
  assert.ok(optionsOf(described).lapels && optionsOf(described).coat);
  assert.equal(garmentName(described), 'Blazer');
  const cream = readDesignPrompt('navy blazer with cream lapels', template('blank') as Product).product;
  assert.notEqual(cream.parts.lapel!.color, cream.parts.front.color);
  const added = readDesignPrompt('coat with notched lapels', coat);
  assert.ok(optionsOf(added.product).lapels);
  assert.deepEqual(added.ignored, []);
  const removed = readDesignPrompt('no lapels', blazer).product;
  assert.ok(!optionsOf(removed).lapels && removed.parts.placket);
  const tee = readDesignPrompt('tee with lapels', template('blank') as Product);
  assert.deepEqual(tee.ignored.filter(item => item.includes('lapel')), ['lapels (they go on a coat or blazer, not a t-shirt)']);
  assert.equal(LAPEL_UV_SHIFT, 30);
});
