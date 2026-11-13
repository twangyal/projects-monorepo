import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { patternPieces, teeMesh, template, validateProduct, type Product } from '../src/product.ts';
import { gradedProduct } from '../src/size-grades.ts';
import { layoutPattern, patternDxf, patternSvg } from '../src/pattern-export.ts';
import { buildTechPack, fabricUsage, measurementDiagram, WASTE } from '../src/techpack.ts';

function collar(product: Product) {
  const piece = patternPieces(product).find(piece => piece.part === 'collar')!;
  const mesh = teeMesh(product, Delaunator).find(mesh => mesh.part === 'collar')!;
  const columns = mesh.uvs.length / 6;
  const flatArea = mesh.indices.reduce((sum, _, i, indices) => {
    if (i % 3) return sum;
    const [a, b, c] = indices.slice(i, i + 3).map(id => [mesh.uvs[id * 2]!, mesh.uvs[id * 2 + 1]!] as const);
    return sum + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }, 0);
  return { piece, mesh, columns, flatArea };
}

test('exported knit and woven collars contain exactly the flat cloth area simulated in every size', () => {
  for (const id of ['polo', 'shirt']) for (const size of ['XS', 'M', 'XL'] as const) {
    const product = gradedProduct(template(id), size), before = structuredClone(product);
    const { piece, flatArea, mesh, columns } = collar(product);
    assert.ok(Math.abs(piece.areaCm2 - flatArea) < 1e-6, `${id} ${size}: pattern ${piece.areaCm2}, simulated ${flatArea} cm²`);
    const edgeWidth = (y: number) => { const xs = piece.outline.filter(p => Math.abs(p.y - y) < 1e-8).map(p => p.x); return Math.max(...xs) - Math.min(...xs); };
    assert.ok(Math.abs(edgeWidth(0) - (mesh.uvs[(columns - 1) * 2]! - mesh.uvs[0]!)) < 1e-6, 'neck edge matches sewn mesh');
    assert.equal(piece.cutCount, id === 'shirt' ? 2 : 1);
    assert.deepEqual(product, before);
  }
});

test('neck edits and material changes update the collar pattern without depending on how the shirt is worn', () => {
  const original = template('shirt'), edited = validateProduct({ ...original, fit: { ...original.fit, neckWidth: 20, frontNeckDrop: 10 } });
  const changed = collar(edited);
  assert.ok(Math.abs(changed.piece.areaCm2 - changed.flatArea) < 1e-6);
  assert.notEqual(changed.piece.areaCm2, collar(original).piece.areaCm2);
  const open = validateProduct({ ...edited, options: { ...edited.options!, zipOpen: true } });
  assert.deepEqual(collar(open).piece, changed.piece);
  const knit = validateProduct({ ...edited, parts: { ...edited.parts, collar: { ...edited.parts.collar!, material: 'rib-220' } } });
  const knitted = collar(knit);
  assert.equal(knitted.piece.cutCount, 1);
  assert.ok(Math.abs(knitted.piece.areaCm2 - knitted.flatArea) < 1e-6);
  assert.ok(changed.piece.areaCm2 > knitted.piece.areaCm2, 'woven fall contains extra cloth rather than stretching a rectangular knit draft');
});

test('collar cutting, fold guidance and fabric consumption agree with the linked draft', () => {
  const product = template('shirt'), { piece, flatArea, mesh, columns } = collar(product);
  const fold = piece.foldLine;
  assert.ok(fold, 'stand/fall fold is supplied for exports');
  assert.equal(fold[0].y, mesh.uvs[columns * 2 + 1]);
  assert.equal(fold[1].y, fold[0].y);
  const foldWidth = mesh.uvs[(columns * 2 - 1) * 2]! - mesh.uvs[columns * 2]!;
  assert.ok(Math.abs(fold[1].x - fold[0].x - foldWidth) < 1e-6);
  assert.ok(layoutPattern(product).pieces.find(item => item.piece.part === 'collar')!.foldLine);
  assert.match(patternSvg(product), /data-fold="collar"/);
  assert.match(patternDxf(product), /\n8\nFOLD\n/);
  // Isolate collar usage with a unique colour: two woven layers, not one rectangular strip.
  const separate = { ...product, parts: { ...product.parts, collar: { ...product.parts.collar!, color: '#123456' } } };
  const usage = fabricUsage(separate).find(usage => usage.parts.length === 1 && usage.parts[0] === 'collar')!;
  assert.ok(Math.abs(usage.areaM2 - flatArea * 2 * WASTE / 10000) < 1e-9);
  const row = buildTechPack(product, '2026-11-12').construction.find(row => row.area === 'Collar')!;
  assert.match(row.detail, /cut 2/i);
  assert.match(row.detail, /fold/i);
  assert.match(measurementDiagram(product), /data-piece="collar"/);
  assert.match(measurementDiagram(product), /data-fold="collar"/);
});

test('the collar construction method follows its actual material rather than the button front', () => {
  for (const id of ['polo', 'shirt']) for (const fabric of ['rib-220', 'poplin-120']) {
    const product = template(id);
    product.parts.collar = { ...product.parts.collar!, material: fabric };
    const row = buildTechPack(product, '2026-11-12').construction.find(row => row.area === 'Collar')!;
    assert.match(row.operation, fabric === 'rib-220' ? /flat-knit/ : /sew and turn/);
    assert.match(row.detail, fabric === 'rib-220' ? /cut 1/i : /cut 2/i);
  }
});
