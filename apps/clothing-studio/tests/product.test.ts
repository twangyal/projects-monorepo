import { pngUrl } from './helpers/raster.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { motifPlacements } from '../src/fabric-texture.ts';
import { validateProject, createProject } from '../src/model.ts';
import { CAP_EASE, MATERIALS, TEMPLATES, partsOf, panelSize, patternPieces, teeDimensions, teeMesh, template, validateProduct, type Product, topMeasurements } from '../src/product.ts';

const ringer = () => template('ringer');

test('templates are valid remixable products and validation refuses anything outside the library or limits', () => {
  for (const item of TEMPLATES) assert.deepEqual(validateProduct(structuredClone(item.product)), template(item.id));
  assert.equal(template('ringer').parts.sleeveLeft.color, '#b23a2e');
  assert.equal(new Set(MATERIALS.map(m => m.id)).size, MATERIALS.length);
  const good = ringer();
  const bad: [string, (p: Product) => void][] = [
    ['fabric', p => { p.parts.front.material = 'silk-999'; }],
    ['color', p => { p.parts.back.color = 'red'; }],
    ['print', p => { p.parts.front.print = { motif: 'plaid' as never, color: '#000000', scaleCm: 5, layout: 'grid' }; }],
    ['repeat', p => { p.parts.front.print = { motif: 'dots', color: '#000000', scaleCm: 1, layout: 'grid' }; }],
    ['chest', p => { topMeasurements(p).chest = 300; }],
    ['part', p => { delete (p.parts as Record<string, unknown>).neckband; }],
    ['extra', p => { (p as unknown as Record<string, unknown>).price = 1; }],
    ['sample size', p => { p.spec = { styleNumber: 'A', season: 'B', sampleSize: 'XXL' as never }; }],
    ['style number', p => { p.spec = { styleNumber: 'x'.repeat(41), season: '', sampleSize: 'M' }; }],
    ['season', p => { p.spec = { styleNumber: '', season: 'SS\u000027', sampleSize: 'M' }; }],
    ['artwork', p => { p.artwork = [{ part: 'front', dataUrl: 'javascript:alert(1)', width: 1, height: 1, name: 'x', xCm: 0, yCm: 0, widthCm: 10 }]; }],
  ];
  for (const [label, mutate] of bad) { const p = structuredClone(good); mutate(p); assert.throws(() => validateProduct(p), Error, label); }
  assert.deepEqual(validateProduct({ ...structuredClone(good), spec: { styleNumber: ' CS-1 ', season: 'SS27', sampleSize: 'L' } }).spec, { styleNumber: 'CS-1', season: 'SS27', sampleSize: 'L' });
  // Projects keep the design; older projects without one stay valid.
  const project = validateProject({ ...createProject(), product: good });
  assert.deepEqual(project.product, good);
  assert.equal(validateProject(createProject()).product, undefined);
});

test('pattern pieces follow the measurements', () => {
  const p = ringer(), pieces = patternPieces(p);
  assert.deepEqual(pieces.map(piece => piece.part), [...partsOf(p)]);
  const front = pieces[0];
  assert.equal(front.width, panelSize(topMeasurements(p)).width);
  assert.equal(front.height, topMeasurements(p).length);
  const wider = patternPieces({ ...p, measurements: { ...topMeasurements(p), chest: topMeasurements(p).chest + 20 } });
  assert.ok(wider[0].areaCm2 > front.areaCm2 && wider[2].areaCm2 > pieces[2].areaCm2);
  const v = patternPieces({ ...p, neckline: 'v' });
  assert.equal(Math.max(...v[0].outline.filter(pt => pt.y < 20 && Math.abs(pt.x - v[0].width / 2) < 1e-9).map(pt => pt.y)), 15, 'the V-neck front dips 15 cm');
});

test('the 3D garment is sewn from its pattern pieces: front and back meet at the seams, sleeves are set in, hem, cuffs and neck stay open', () => {
  const p = ringer(), meshes = teeMesh(p, Delaunator);
  assert.deepEqual(meshes.map(m => m.part), [...partsOf(p)]);
  for (const mesh of meshes) {
    assert.equal(mesh.positions.length / 3, mesh.uvs.length / 2);
    assert.ok(mesh.indices.length > 30 && mesh.indices.every(i => i < mesh.positions.length / 3), mesh.part);
  }
  const body = meshes.find(m => m.part === 'front')!, back = meshes.find(m => m.part === 'back')!;
  const points = (mesh: typeof body) => Array.from({ length: mesh.positions.length / 3 }, (_, i) => ({ x: mesh.positions[i * 3], y: mesh.positions[i * 3 + 1], z: mesh.positions[i * 3 + 2] }));
  const f = points(body), b = points(back), half = panelSize(topMeasurements(p)).width / 2, top = topMeasurements(p).length;
  assert.ok(f.every(q => q.z >= 0) && b.every(q => q.z <= 0), 'front faces the viewer, back faces away');
  // Side seams: vertices on x = ±half are pinned at z = 0 on both sides, so the shell is closed there.
  const side = (pts: typeof f) => pts.filter(q => Math.abs(Math.abs(q.x) - half) < 1e-9 && q.y < top - 35);
  assert.ok(side(f).length > 10 && side(f).every(q => Math.abs(q.z) < 1e-9) && side(b).every(q => Math.abs(q.z) < 1e-9));
  // The hem stays open: away from the sides, hem vertices stand off the seam plane.
  const hem = f.filter(q => Math.abs(q.y) < 1e-9 && Math.abs(q.x) < half - 8);
  assert.ok(hem.length > 5 && hem.every(q => q.z > 5), 'open hem');
  // Each sleeve's cap shares its armhole vertices with the front and back, so there is no gap at the seam, and its
  // two underarm seams meet: the sleeve is a closed tube.
  const sleeveMesh = meshes.find(m => m.part === 'sleeveLeft')!, sleeve = points(sleeveMesh);
  const key = (q: { x: number; y: number; z: number }) => `${q.x.toFixed(6)},${q.y.toFixed(6)},${q.z.toFixed(6)}`;
  const shared = (pts: typeof f) => { const keys = new Set(pts.map(key)); return sleeve.filter(q => keys.has(key(q))).length; };
  assert.ok(shared(f) >= 15 && shared(b) >= 15, `shared armhole vertices: ${shared(f)}, ${shared(b)}`);
  const counts = new Map<string, number>();
  for (const q of sleeve) counts.set(key(q), (counts.get(key(q)) ?? 0) + 1);
  assert.ok([...counts.values()].filter(n => n === 2).length >= 8, 'underarm seam');
  // UVs are flat pattern cm: across the front they span its width, and the sleeve's span its pattern piece.
  const us = body.uvs.filter((_, i) => i % 2 === 0);
  assert.ok(Math.abs(Math.max(...us) - Math.min(...us) - 2 * half) < 1e-9, 'front body UVs span its flat width in cm');
  const piece = patternPieces(p).find(piece => piece.part === 'sleeveLeft')!, su = sleeveMesh.uvs.filter((_, i) => i % 2 === 0), sv = sleeveMesh.uvs.filter((_, i) => i % 2 === 1);
  assert.ok(Math.abs(Math.min(...su)) < 1e-9 && Math.abs(Math.max(...su) - piece.width) < 1e-6 && Math.abs(Math.min(...sv)) < 1e-6 && Math.abs(Math.max(...sv) - piece.height) < 1e-9, 'sleeve UVs are its pattern piece');
  // The sleeve hangs from the shoulder point along the sleeve angle, past the body's side.
  const d = teeDimensions(p);
  assert.ok(sleeve.some(q => Math.abs(q.x - d.shoulderX) < 1e-9 && Math.abs(q.y - (top - d.shoulderDrop)) < 1e-9 && Math.abs(q.z) < 1e-9), 'cap top at the shoulder point');
  assert.ok(Math.max(...sleeve.map(q => q.x)) > d.half + 5, 'the sleeve reaches past the side seam');
  // Measurements reshape the garment.
  const long = teeMesh({ ...p, measurements: { ...topMeasurements(p), sleeve: 60 } }, Delaunator).find(m => m.part === 'sleeveLeft')!;
  assert.ok(Math.max(...long.positions.filter((_, i) => i % 3 === 0)) > Math.max(...sleeve.map(q => q.x)) + 25);
});

test('repeat layouts place four motifs per tile with the documented offsets', () => {
  assert.deepEqual(motifPlacements('grid').map(m => [m.x, m.y]), [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]);
  assert.deepEqual(motifPlacements('half-drop').map(m => [m.x, m.y]), [[0.25, 0.25], [0.75, 0.5], [0.25, 0.75], [0.75, 0]]);
  assert.deepEqual(motifPlacements('half-brick').map(m => [m.x, m.y]), [[0.25, 0.25], [0.75, 0.25], [0.5, 0.75], [0, 0.75]]);
  assert.deepEqual(motifPlacements('mirror').map(m => [m.flipX, m.flipY]), [[false, false], [true, false], [false, true], [true, true]]);
});

test('uploaded motifs are validated, referenced by prints and named in the tech pack', async () => {
  const { buildTechPack } = await import('../src/techpack.ts');
  const { printName } = await import('../src/product.ts');
  const png = pngUrl(64,64);
  const base = ringer(), motif = { id: 'm1', name: 'Star', dataUrl: png, width: 64, height: 64 };
  const design = validateProduct({ ...base, motifs: [motif], parts: { ...base.parts, front: { ...base.parts.front, print: { motif: 'upload:m1', color: '#000000', scaleCm: 8, layout: 'half-drop' } } } });
  assert.equal(printName(design.parts.front.print!, design), 'Star');
  assert.match(buildTechPack(design, '2026-10-13').bom[0].description, /Star print from supplied artwork in its own colours, half drop repeat 8 cm/);
  const bad: [string, (p: Record<string, unknown>) => void][] = [
    ['unknown upload', p => { p.parts = { ...base.parts, back: { ...base.parts.back, print: { motif: 'upload:m9', color: '#000000', scaleCm: 8, layout: 'grid' } } }; }],
    ['upload without motifs', p => { delete p.motifs; }],
    ['script url', p => { p.motifs = [{ ...motif, dataUrl: 'javascript:alert(1)' }]; }],
    ['svg', p => { p.motifs = [{ ...motif, dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }]; }],
    ['too large', p => { p.motifs = [{ ...motif, dataUrl: `data:image/png;base64,${'A'.repeat(900_000)}` }]; }],
    ['duplicate ids', p => { p.motifs = [motif, motif]; }],
    ['too many', p => { p.motifs = Array.from({ length: 7 }, (_, i) => ({ ...motif, id: `m${i}` })); }],
  ];
  for (const [label, mutate] of bad) { const p = structuredClone(design) as unknown as Record<string, unknown>; mutate(p); assert.throws(() => validateProduct(p), Error, label); }
  // Colorways may use uploaded motifs too.
  assert.doesNotThrow(() => validateProduct({ ...design, colorways: [{ id: 'c1', name: 'Stars', parts: design.parts, units: 1 }] }));
});

test('sweatshirts and hoodies have their own parts, rib bands, hood and pocket in 3D, pattern and tech pack', async () => {
  const { buildTechPack } = await import('../src/techpack.ts');
  const { BAND_CM, partsOf: parts, teeDimensions } = await import('../src/product.ts');
  const sweat = template('crew-sweat'), hoodie = template('hoodie');
  assert.deepEqual([...parts(sweat)], ['front', 'back', 'sleeveLeft', 'sleeveRight', 'neckband', 'cuffLeft', 'cuffRight', 'hemBand']);
  assert.deepEqual([...parts(hoodie)], ['front', 'back', 'sleeveLeft', 'sleeveRight', 'cuffLeft', 'cuffRight', 'hemBand', 'hood', 'pocket']);
  // Parts must match the base exactly; a hoodie cannot have a V-neck.
  assert.throws(() => validateProduct({ ...hoodie, neckline: 'v' }), /hood/);
  assert.throws(() => validateProduct({ ...hoodie, parts: { ...hoodie.parts, neckband: hoodie.parts.front } }), Error);
  assert.throws(() => validateProduct({ ...sweat, base: 'tee' }), Error);
  assert.throws(() => validateProduct({ ...sweat, base: 'jacket' }), /base product/);

  for (const design of [sweat, hoodie]) {
    const meshes = teeMesh(design, Delaunator), byPart = new Map(meshes.map(mesh => [mesh.part, mesh]));
    assert.deepEqual(meshes.map(mesh => mesh.part), [...parts(design)]);
    const points = (part: string) => { const mesh = byPart.get(part as never)!; return Array.from({ length: mesh.positions.length / 3 }, (_, i) => ({ x: mesh.positions[i * 3], y: mesh.positions[i * 3 + 1], z: mesh.positions[i * 3 + 2] })); };
    const key = (q: { x: number; y: number; z: number }) => `${q.x.toFixed(6)},${q.y.toFixed(6)},${q.z.toFixed(6)}`;
    // The hem band runs along the bottom and shares its top edge with the body; each cuff shares an edge with its sleeve.
    const band = points('hemBand'), body = new Set(points('front').map(key));
    assert.ok(Math.min(...band.map(q => q.y)) < 1e-9 && Math.max(...band.map(q => q.y)) <= BAND_CM + 1e-9);
    assert.ok(band.filter(q => body.has(key(q))).length >= 10, 'hem band joins the body');
    const sleeve = new Set(points('sleeveLeft').map(key));
    assert.ok(points('cuffLeft').filter(q => sleeve.has(key(q))).length >= 4, 'cuff joins the sleeve');
    // Long sleeves end in narrow cuffs.
    assert.ok(teeDimensions(design).cuffHalf < teeDimensions(template('ringer')).cuffHalf);
    const pieces = patternPieces(design);
    assert.deepEqual(pieces.map(piece => piece.part).sort(), [...parts(design)].sort());
    assert.equal(pieces.find(piece => piece.part === 'front')!.height, topMeasurements(design).length - BAND_CM, 'the body ends above the hem band');
  }
  // The hood rises above the shoulders and stays open at the face; the pocket sits proud of the front body.
  const meshes = teeMesh(hoodie, Delaunator), hood = meshes.find(mesh => mesh.part === 'hood')!, pocket = meshes.find(mesh => mesh.part === 'pocket')!;
  const hoodY = hood.positions.filter((_, i) => i % 3 === 1);
  assert.ok(Math.max(...hoodY) > topMeasurements(hoodie).length + 30, 'hood height');
  const front = meshes.find(mesh => mesh.part === 'front')!;
  const zAt = (mesh: typeof front, x: number, y: number) => { let best = Infinity, z = 0; for (let i = 0; i < mesh.positions.length; i += 3) { const d = Math.hypot(mesh.positions[i] - x, mesh.positions[i + 1] - y); if (d < best) { best = d; z = mesh.positions[i + 2]; } } return z; };
  assert.ok(zAt(pocket, 0, 15) > zAt(front, 0, 15), 'pocket is on top of the front');
  assert.equal(patternPieces(hoodie).find(piece => piece.part === 'hood')!.cutCount, 2);

  const packs = [buildTechPack(sweat, '2026-10-13'), buildTechPack(hoodie, '2026-10-13')];
  assert.deepEqual(packs.map(pack => pack.poms.map(p => p.code).join('')), ['ABCDEFGHIJKLMU', 'ABCDEFGHIJKLMNOU']);
  assert.deepEqual(packs.map(pack => pack.base), ['Crew sweatshirt', 'Pullover hoodie']);
  assert.ok(packs[1].construction.some(row => row.area === 'Hood') && packs[1].construction.some(row => row.area === 'Kangaroo pocket'));
  assert.ok(!packs[1].construction.some(row => row.area === 'Neck rib'));
  assert.ok(packs[0].construction.some(row => row.area === 'Cuffs') && !packs[0].construction.some(row => row.area === 'Body hem'));
  // Consumption includes the bands, hood and pocket.
  const { fabricUsage } = await import('../src/techpack.ts');
  const area = (design: typeof hoodie) => fabricUsage(design).reduce((sum, usage) => sum + usage.areaM2, 0);
  assert.ok(area(hoodie) > area({ ...hoodie, base: 'sweatshirt', parts: Object.fromEntries(parts(sweat).map(id => [id, hoodie.parts[id] ?? hoodie.parts.front])) as typeof hoodie.parts }));
});

test('modules: a curved hem and a chest pocket follow through validation, 3D, pattern pieces, tech pack and colorways', async () => {
  const { buildTechPack, fabricUsage, measurementDiagram } = await import('../src/techpack.ts');
  const { DEFAULT_OPTIONS, HEM_CURVE_CM, POCKET_FOLD_CM, optionsOf, teeDimensions, withOptions } = await import('../src/product.ts');
  const tee = template('ringer'), sweat = template('crew-sweat'), hoodie = template('hoodie');
  assert.deepEqual(optionsOf(tee), DEFAULT_OPTIONS, 'saved designs without modules keep the defaults');
  const withColorway = { ...tee, colorways: [{ id: 'c1', name: 'Red', parts: structuredClone(tee.parts), units: 10 }] };
  const curved = validateProduct(withOptions(withColorway, { hem: 'curved', chestPocket: true }));
  assert.deepEqual(curved.options, { hem: 'curved', chestPocket: true });
  assert.deepEqual([...partsOf(curved)], [...partsOf(tee), 'chestPocket']);
  assert.deepEqual(curved.parts.chestPocket, tee.parts.front, 'a new chest pocket starts in the front body style');
  assert.deepEqual(curved.colorways![0].parts.chestPocket, tee.parts.front, 'and so does each colorway’s');
  assert.deepEqual(validateProduct(JSON.parse(JSON.stringify(curved))), curved, 'saved projects round-trip');
  const off = validateProduct(withOptions(curved, { hem: 'straight', chestPocket: false }));
  assert.ok(!('chestPocket' in off.parts) && !('chestPocket' in off.colorways![0].parts));
  // Parts must match the modules; banded or kangaroo-pocket bases refuse what they cannot have.
  assert.throws(() => validateProduct({ ...curved, parts: tee.parts }), Error);
  assert.throws(() => validateProduct({ ...tee, options: { hem: 'wavy', chestPocket: false } }), /straight or curved/);
  assert.throws(() => validateProduct({ ...tee, options: { hem: 'straight', chestPocket: 'yes' } }), /on or off/);
  assert.throws(() => withOptions(sweat, { hem: 'curved', chestPocket: false }), /hem band/);
  assert.throws(() => validateProduct({ ...sweat, options: { hem: 'curved', chestPocket: false } }), /curved hem/);
  assert.throws(() => withOptions(hoodie, { hem: 'straight', chestPocket: true }), /kangaroo/);
  assert.deepEqual([...partsOf(validateProduct(withOptions(sweat, { hem: 'straight', chestPocket: true })))].at(-1), 'chestPocket');

  // Pattern: the body hem curves up to the side seams; the pocket piece carries its top facing.
  const pieces = patternPieces(curved), front = pieces.find(piece => piece.part === 'front')!, dims = teeDimensions(curved);
  const lowest = (x: number) => Math.max(...front.outline.filter(p => Math.abs(p.x - x) < 1e-9).map(p => p.y));
  assert.equal(front.height, topMeasurements(curved).length, 'centre length is the body length');
  assert.equal(lowest(0), topMeasurements(curved).length - HEM_CURVE_CM, 'the side seam is shorter');
  assert.ok(front.areaCm2 < patternPieces(tee).find(piece => piece.part === 'front')!.areaCm2);
  const pocket = pieces.find(piece => piece.part === 'chestPocket')!;
  assert.deepEqual([pocket.width, pocket.height, pocket.cutCount], [dims.chestPocketWidth, dims.chestPocketHeight + POCKET_FOLD_CM, 1]);

  // 3D: the hem is open and lower at the centre than at the sides; the pocket sits proud of the front, on the wearer's left.
  const meshes = teeMesh(curved, Delaunator), byPart = new Map(meshes.map(mesh => [mesh.part, mesh]));
  assert.deepEqual(meshes.map(mesh => mesh.part), [...partsOf(curved)]);
  const ys = (part: 'front' | 'chestPocket', near: (x: number) => boolean) => { const mesh = byPart.get(part)!, out: number[] = []; for (let i = 0; i < mesh.positions.length; i += 3) if (near(mesh.positions[i])) out.push(mesh.positions[i + 1]); return out; };
  const half = panelSize(topMeasurements(curved)).width / 2;
  assert.ok(Math.abs(Math.min(...ys('front', x => Math.abs(x) < 1))) < 1e-9, 'hem at centre front reaches the full length');
  assert.ok(Math.abs(Math.min(...ys('front', x => Math.abs(x - half) < 1e-6)) - HEM_CURVE_CM) < 1e-9, 'hem at the side seam rises by the curve');
  const body = byPart.get('front')!, patch = byPart.get('chestPocket')!;
  const xs = patch.positions.filter((_, i) => i % 3 === 0);
  assert.ok(Math.min(...xs) > 0, 'chest pocket on the wearer’s left (viewer’s right)');
  const zAt = (mesh: typeof body, x: number, y: number) => { let best = Infinity, z = 0; for (let i = 0; i < mesh.positions.length; i += 3) { const d = Math.hypot(mesh.positions[i] - x, mesh.positions[i + 1] - y); if (d < best) { best = d; z = mesh.positions[i + 2]; } } return z; };
  const py = topMeasurements(curved).length - dims.chestPocketY - dims.chestPocketHeight / 2;
  assert.ok(zAt(patch, dims.chestPocketX, py) > zAt(body, dims.chestPocketX, py), 'pocket on top of the front');

  // Tech pack: pocket fabric, measurements and construction; curved-hem side length and hem detail.
  const pack = buildTechPack(curved, '2026-10-13'), codes = pack.poms.map(p => p.code).join('');
  assert.equal(codes, 'ABCDEFGHIJKSTUPQRV');
  assert.equal(buildTechPack(tee, '2026-10-13').poms.map(p => p.code).join(''), 'ABCDEFGHIJKU', 'no module rows without modules');
  const side = pack.poms.find(p => p.code === 'S')!.values.M;
  assert.equal(side, Math.round((dims.length - HEM_CURVE_CM - dims.shoulderDrop - dims.armDepth) * 2) / 2);
  assert.match(pack.construction.find(row => row.area === 'Body hem')!.detail, /Curved shirttail/);
  assert.match(pack.construction.find(row => row.area === 'Chest pocket')!.detail, /wearer’s left/);
  assert.ok(fabricUsage(curved).some(usage => usage.parts.includes('chestPocket')), 'the pocket is in the fabric consumption');
  assert.match(measurementDiagram(curved), />P<\/text>.*>Q<\/text>.*>S<\/text>/s);
  // The cutting files carry the pocket piece and the curved hem.
  const { layoutPattern, patternDxf } = await import('../src/pattern-export.ts');
  assert.match(patternDxf(curved), /\nChest pocket\n/);
  assert.equal(layoutPattern(curved).pieces.length, patternPieces(curved).length);
});

test('shorts and trousers: leg measurements, two-leg 3D, paired leg panels, waistband and a trouser tech pack', async () => {
  const { buildTechPack, fabricUsage, measurementDiagram } = await import('../src/techpack.ts');
  const { WAISTBAND_CM, garmentHeight, legMeasurements, partName, trouserDimensions, withOptions } = await import('../src/product.ts');
  const shorts = template('shorts'), trousers = template('trousers');
  assert.deepEqual([...partsOf(trousers)], ['front', 'back', 'waistband']);
  assert.deepEqual([partName(trousers, 'front'), partName(trousers, 'back'), partName(template('ringer'), 'front')], ['Front legs', 'Back legs', 'Front body']);
  assert.deepEqual(legMeasurements(shorts), { waist: 76, hip: 102, rise: 28, inseam: 18, legOpening: 58 });
  assert.throws(() => topMeasurements(trousers), /leg measurements/);
  // Validation: leg measurements belong to bottoms, the waistband must pass the hips, and tops-only modules are refused.
  assert.throws(() => validateProduct({ ...trousers, measurements: template('ringer').measurements }), /Leg measurements/);
  assert.throws(() => validateProduct({ ...template('ringer'), measurements: trousers.measurements }), Error);
  assert.throws(() => validateProduct({ ...trousers, measurements: { ...legMeasurements(trousers), waist: 110, hip: 100 } }), /pull on over the hips/);
  assert.throws(() => validateProduct({ ...trousers, measurements: { ...legMeasurements(trousers), legOpening: 85 } }), /Leg opening/);
  assert.throws(() => validateProduct({ ...trousers, neckline: 'v' }), /no neckline/);
  assert.throws(() => validateProduct({ ...trousers, artwork: template('ringer').artwork.concat([{ part: 'front', dataUrl: 'data:image/png;base64,AA==', width: 1, height: 1, name: 'a', xCm: 0, yCm: 5, widthCm: 5 }]) }), /tops/);
  assert.throws(() => withOptions(trousers, { hem: 'straight', chestPocket: true }), /top/);
  assert.throws(() => withOptions(trousers, { hem: 'curved', chestPocket: false }), /hem/);

  // Pattern: front and back leg panels cut in mirrored pairs; the back is 3 cm taller at the centre back; a folded waistband.
  const d = trouserDimensions(trousers), pieces = patternPieces(trousers), byPart = new Map(pieces.map(piece => [piece.part, piece]));
  assert.deepEqual(pieces.map(piece => [piece.part, piece.cutCount]), [['front', 2], ['back', 2], ['waistband', 1]]);
  assert.equal(byPart.get('front')!.height, d.rise + d.inseam);
  assert.equal(byPart.get('back')!.height, d.rise + d.inseam + d.backRaise);
  assert.ok(byPart.get('back')!.width > byPart.get('front')!.width, 'the back has the longer crotch extension');
  assert.deepEqual([byPart.get('waistband')!.width, byPart.get('waistband')!.height], [legMeasurements(trousers).hip + 6, WAISTBAND_CM * 2]);
  const area = (design: typeof trousers) => fabricUsage(design).reduce((sum, usage) => sum + usage.areaM2, 0);
  assert.ok(area(trousers) > area(shorts) * 1.6, 'full-length legs use much more fabric');

  // 3D: meshed from the leg panels (UVs are pattern cm); two legs open at the hems, joined at the side seams, inseams
  // and centre seams, meeting at the crotch point; the waistband sits on the open waist.
  const meshes = teeMesh(trousers, Delaunator), mesh = new Map(meshes.map(m => [m.part, m]));
  assert.deepEqual(meshes.map(m => m.part), ['front', 'back', 'waistband']);
  const points = (part: 'front' | 'back' | 'waistband') => { const m = mesh.get(part)!; return Array.from({ length: m.positions.length / 3 }, (_, i) => ({ x: m.positions[i * 3], y: m.positions[i * 3 + 1], z: m.positions[i * 3 + 2] })); };
  const front = points('front'), back = points('back');
  assert.ok(front.every(q => q.z >= 0) && back.every(q => q.z <= 0));
  for (const part of ['front', 'back'] as const) {
    const uvs = mesh.get(part)!.uvs, piece = byPart.get(part)!;
    const us = uvs.filter((_, i) => i % 2 === 0), vs = uvs.filter((_, i) => i % 2 === 1);
    assert.ok(Math.abs(Math.max(...us) - piece.width) < 1e-6 && Math.abs(Math.max(...vs) - piece.height) < 1e-6 && Math.min(...us) > -1e-9 && Math.min(...vs) > -1e-9, `${part} UVs are its pattern piece`);
  }
  const hem = front.filter(q => q.y < 1e-9);
  assert.ok(hem.length > 10 && hem.some(q => q.z > 3), 'the leg hems are open');
  assert.ok(Math.min(...hem.map(q => Math.abs(q.x))) > 2, 'nothing between the legs at the hem');
  const crotch = front.filter(q => Math.abs(q.x) < 1e-9 && Math.abs(q.y - legMeasurements(trousers).inseam) < 1e-9);
  assert.ok(crotch.length && crotch.every(q => Math.abs(q.z) < 1e-9), 'front and back meet at the crotch');
  const key = (q: { x: number; y: number; z: number }) => [q.x, q.y, q.z].map(v => Math.round(v * 1000)).join();
  const backKeys = new Set(back.map(key)), seam = front.filter(q => Math.abs(q.z) < 1e-9);
  assert.ok(seam.length > 40 && seam.every(q => backKeys.has(key(q))), 'side seams and inseams are joined');
  const centre = front.filter(q => Math.abs(q.x) < 1e-9);
  assert.ok(centre.length > 10 && centre.every(q => front.filter(o => key(o) === key(q)).length === 2), 'the two legs share the centre seam');
  const band = points('waistband');
  assert.ok(Math.abs(Math.max(...band.map(q => q.y)) - (d.length + WAISTBAND_CM)) < 1e-9 && Math.abs(Math.min(...band.map(q => q.y)) - d.length) < 1e-9);
  assert.equal(garmentHeight(trousers), d.length + WAISTBAND_CM);

  // Tech pack: trouser measurements, elastic, construction and the leg-panel diagram.
  const pack = buildTechPack(trousers, '2026-10-13'), shortPack = buildTechPack(shorts, '2026-10-13');
  assert.equal(pack.poms.map(p => p.code).join(''), 'ABCDEFGHIJ');
  assert.deepEqual([pack.base, shortPack.base, pack.neckline], ['Pull-on trousers', 'Pull-on shorts', 'Elasticated waistband']);
  assert.equal(pack.poms.find(p => p.code === 'G')!.values.M, 78);
  assert.ok(pack.poms.find(p => p.code === 'E')!.values.M > pack.poms.find(p => p.code === 'D')!.values.M, 'back rise is longer than front rise');
  assert.match(pack.bom.find(row => row.item.includes('elastic'))!.quantity, /^72\.0 cm/);
  assert.match(pack.bom[0].placement, /Front legs, Back legs, Waistband/);
  assert.ok(['Inseams', 'Side seams', 'Crotch seam', 'Waistband', 'Leg hems'].every(area => pack.construction.some(row => row.area === area)));
  assert.match(measurementDiagram(trousers), />E<\/text>/);
});

test('fit: edited points of measure drive the pattern, the 3D shell and the tech pack together', async () => {
  const { buildTechPack } = await import('../src/techpack.ts');
  const { flare, teeDimensions } = await import('../src/product.ts');
  const tee = template('ringer'), d0 = teeDimensions(tee);
  // Without fit, the pattern's shoulder point now sits where the 3D shell and tech pack put it.
  const shoulderOf = (design: typeof tee) => patternPieces(design).find(piece => piece.part === 'front')!.outline[1];
  assert.ok(Math.abs(shoulderOf(tee).x - (d0.half - d0.shoulderX)) < 1e-9);
  const vertexAt = (design: typeof tee, part: 'front' | 'back', x: number, y: number) => { const mesh = teeMesh(design, Delaunator).find(m => m.part === part)!; return mesh.positions.some((_, i) => i % 3 === 0 && Math.abs(mesh.positions[i] - x) < 1e-9 && Math.abs(mesh.positions[i + 1] - y) < 1e-9 && Math.abs(mesh.positions[i + 2]) < 1e-9); };
  assert.ok(vertexAt(tee, 'front', d0.shoulderX, topMeasurements(tee).length - d0.shoulderDrop) && vertexAt(tee, 'back', -d0.shoulderX, topMeasurements(tee).length - d0.shoulderDrop));

  const fitted = validateProduct({ ...tee, fit: { shoulderWidth: 40, neckWidth: 18, frontNeckDrop: 11, armholeDepth: 24, hemWidth: 46, sleeveOpening: 14 } });
  const d = teeDimensions(fitted), front = patternPieces(fitted).find(piece => piece.part === 'front')!, sleeve = patternPieces(fitted).find(piece => piece.part === 'sleeveLeft')!;
  assert.deepEqual([d.shoulderX * 2, d.neckHalf * 2, d.neckDepthFront, d.armDepth, d.hemHalf * 2, d.cuffHalf], [40, 18, 11, 24, 46, 14]);
  assert.ok(Math.abs(front.outline[1].x - (d.half - 20)) < 1e-9, 'pattern shoulder point');
  assert.equal(Math.max(...front.outline.filter(p => p.y < 20 && Math.abs(p.x - d.half) < 1e-9).map(p => p.y)), 11, 'front neck drop');
  const hemXs = front.outline.filter(p => Math.abs(p.y - topMeasurements(fitted).length) < 1e-9).map(p => p.x);
  assert.ok(Math.abs(Math.max(...hemXs) - Math.min(...hemXs) - 46) < 1e-9, 'tapered hem is 46 cm side to side');
  // The sleeve is drafted from the armhole: its cap is CAP_EASE longer than the front and back armholes together.
  const length = (points: { x: number; y: number }[]) => points.slice(1).reduce((sum, q, i) => sum + Math.hypot(q.x - points[i].x, q.y - points[i].y), 0);
  const armhole = front.outline.slice(1, front.outline.findIndex(q => q.x === 0) + 1), cap = sleeve.outline.slice(0, 13);
  assert.ok(Math.abs(length(cap) - 2 * length(armhole) * (1 + CAP_EASE)) < 0.01, `cap ${length(cap)} for armholes ${2 * length(armhole)}`);
  assert.ok(Math.abs(armhole.at(-1)!.y - (d.shoulderDrop + 24)) < 1e-9, 'the armhole is as deep as asked');
  assert.ok(Math.abs(sleeve.outline.at(-2)!.x - sleeve.outline.at(-1)!.x - 28) < 1e-9, 'sleeve opening');
  assert.ok(vertexAt(fitted, 'front', 20, topMeasurements(fitted).length - d.shoulderDrop) && vertexAt(fitted, 'front', 23, 0), '3D shoulder and hem corners');
  const pack = buildTechPack(fitted, '2026-10-13'), value = (code: string) => pack.poms.find(p => p.code === code)!.values.M;
  assert.deepEqual(['E', 'F', 'G', 'D', 'I', 'J'].map(value), [40, 18, 11, 24, 46, 14]);
  // The shell stays closed at the sleeves with an edited armhole.
  const meshes = teeMesh(fitted, Delaunator), key = (m: typeof meshes[number], i: number) => `${m.positions[i * 3].toFixed(6)},${m.positions[i * 3 + 1].toFixed(6)},${m.positions[i * 3 + 2].toFixed(6)}`;
  const body = meshes.find(m => m.part === 'front')!, arm = meshes.find(m => m.part === 'sleeveLeft')!;
  const bodyKeys = new Set(Array.from({ length: body.positions.length / 3 }, (_, i) => key(body, i)));
  assert.ok(Array.from({ length: arm.positions.length / 3 }, (_, i) => key(arm, i)).filter(k => bodyKeys.has(k)).length >= 10);

  // An A-line hem wider than the chest flares the piece, which still starts at x = 0; a banded hem follows the hem width.
  const aline = validateProduct({ ...tee, fit: { hemWidth: 70 } }), alineFront = patternPieces(aline).find(piece => piece.part === 'front')!;
  assert.equal(flare(aline), 35 - teeDimensions(aline).half);
  assert.ok(Math.min(...alineFront.outline.map(p => p.x)) === 0 && Math.abs(alineFront.width - 70) < 1e-9);
  const sweat = validateProduct({ ...template('crew-sweat'), fit: { hemWidth: 50 } });
  assert.equal(patternPieces(sweat).find(piece => piece.part === 'hemBand')!.width, 50 * 2 * 0.85);
  assert.ok(teeMesh(sweat, Delaunator).find(m => m.part === 'hemBand')!.indices.length > 30);

  // Validation keeps a garment: known keys, ranges, the neck inside the shoulders, tops only.
  assert.throws(() => validateProduct({ ...tee, fit: { shoulderWidth: 30, neckWidth: 26 } }), /narrower than the shoulders/);
  assert.throws(() => validateProduct({ ...tee, fit: { hemWidth: 94 } }), /Hem width/);
  assert.throws(() => validateProduct({ ...tee, fit: { waist: 70 } }), Error);
  assert.throws(() => validateProduct({ ...tee, fit: { armholeDepth: 50 } }), /Armhole depth/);
  assert.throws(() => validateProduct({ ...template('trousers'), fit: { hemWidth: 50 } }), /tops/);
  assert.deepEqual(validateProduct(JSON.parse(JSON.stringify(fitted))), fitted, 'saved projects round-trip');
});

test('stripe direction survives validation while legacy prints and invalid direction data stay strict', () => {
  const p = template('breton');
  assert.equal(p.parts.front.print!.direction, undefined);
  p.parts.front.print!.direction = 'vertical';
  assert.deepEqual(validateProduct(p), p);
  for (const direction of [null, undefined, 90, 'diagonal', '']) {
    const bad = structuredClone(p); Reflect.set(bad.parts.front.print!, 'direction', direction);
    assert.throws(() => validateProduct(bad), /Stripe direction/);
  }
  const dots = structuredClone(p); dots.parts.front.print!.motif = 'dots';
  assert.throws(() => validateProduct(dots), /only applies to stripes/);
});
