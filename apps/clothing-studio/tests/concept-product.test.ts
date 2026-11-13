import test from 'node:test';
import assert from 'node:assert/strict';
import { conceptTee } from '../src/concept-product.ts';
import { createProject, validateProject, ProjectHistory, parseProject, serializeProject } from '../src/model.ts';
import { template, topMeasurements, patternPieces } from '../src/product.ts';
import { replaceOutfitProduct } from '../src/outfit-edit.ts';

test('concept proportions, colour and neckline become an editable tee without mutating source work', () => {
  const project = validateProject({ ...createProject(), title: 'River tee', note: 'Keep my idea', product: template('hoodie') });
  project.garment.color = '#123456'; project.garment.neckline = 'v';
  const before = structuredClone(project), plan = conceptTee(project, 104);
  assert.equal(plan.product.base, 'tee'); assert.equal(plan.product.name, 'River tee');
  assert.deepEqual(topMeasurements(plan.product), { chest: 104, length: 65.3, sleeve: 14.5 });
  assert.equal(plan.product.neckline, 'v');
  assert.ok(Object.values(plan.product.parts).every(part => part.color === '#123456'));
  assert.equal(plan.product.parts.front.material, 'jersey-180');
  assert.equal(plan.product.parts.neckband.material, 'rib-220');
  assert.deepEqual(plan.product.artwork, []); assert.deepEqual(project, before);
  assert.ok(patternPieces(plan.product).some(piece => piece.part === 'front'));
});
test('stripe transfer is editable and crosshatch and capped proportions are explained', () => {
  const project = createProject(); project.garment.pattern = 'stripe'; project.garment.patternColor = '#abcdef';
  const plan = conceptTee(project, 104);
  assert.deepEqual(plan.product.parts.front.print, { motif: 'stripe', color: '#abcdef', scaleCm: 3.9, layout: 'grid', direction: 'horizontal' });
  assert.equal(plan.product.parts.neckband.print, null); assert.match(plan.summary, /horizontal/i);
  project.garment = { ...project.garment, bodyWidth: 160, bodyLength: 300, pattern: 'weave' };
  const capped = conceptTee(project, 150);
  assert.equal(topMeasurements(capped.product).length, 120);
  assert.match(capped.summary, /limited to 120/i); assert.match(capped.summary, /crosshatch.*source/i);
  assert.equal(capped.product.parts.front.print, null);
  for (const bad of [NaN, Infinity, 0, 79.9, 150.1]) assert.throws(() => conceptTee(project, bad), /chest/i);
});
test('concept replacement keeps compatible outfit copies, source/body data and complete one-step history', () => {
  const project = validateProject({ ...createProject(), product: template('blank'), wornWith: template('trousers'), topBody: { chest: 92, waist: 76, hip: 98, chestDepth: null } });
  const before = structuredClone(project), plan = replaceOutfitProduct(project, conceptTee(project, 110).product);
  assert.deepEqual(plan.removed, []); const next = validateProject(plan.project);
  assert.deepEqual(next.wornWith, project.wornWith); assert.deepEqual(next.topBody, project.topBody);
  assert.deepEqual(next.garment, project.garment); assert.deepEqual(next.strokes, project.strokes);
  const history = new ProjectHistory(project); history.commit(next);
  assert.deepEqual(history.undo(), before); assert.deepEqual(history.redo(), next);
  assert.deepEqual(parseProject(serializeProject(next)), next); assert.deepEqual(project, before);
});

test('extreme concept proportions still produce finite editable pattern and shell geometry', async () => {
  const { default: Delaunator } = await import('delaunator');
  const { teeMesh } = await import('../src/product.ts');
  for (const [bodyWidth, bodyLength, sleeveLength, chest] of [[160, 300, 65, 150], [260, 180, 25, 80], [160, 180, 25, 80], [260, 300, 65, 150]]) {
    const source = createProject(); Object.assign(source.garment, { bodyWidth, bodyLength, sleeveLength, neckline: 'v' });
    const { product } = conceptTee(source, chest);
    for (const piece of patternPieces(product)) assert.ok(piece.outline.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
    for (const mesh of teeMesh(product, Delaunator)) { assert.ok(mesh.positions.length > 0); assert.ok(mesh.positions.every(Number.isFinite)); }
  }
});
