import test from 'node:test';
import assert from 'node:assert/strict';
import { template, validateProduct, patternPieces, teeDimensions } from '../src/product.ts';
import { buildTechPack, measurementDiagram, fabricUsage } from '../src/techpack.ts';

// Independent measurements of the exported sewing outline, not nominal dimensions.
function necklineLength(product: ReturnType<typeof template>): number {
  return (['front', 'back'] as const).reduce((sum, part) => {
    const outline = patternPieces(product).find(p => p.part === part)!.outline;
    const right = outline.reduce((last, p, i) => p.y === 0 ? i : last, 0);
    const seam = [...outline.slice(right), outline[0]];
    return sum + seam.slice(1).reduce((length, p, i) => length + Math.hypot(p.x - seam[i].x, p.y - seam[i].y), 0);
  }, 0);
}
function chestEnds(product: ReturnType<typeof template>) {
  const outline = patternPieces(product).find(p => p.part === 'front')!.outline;
  const d = teeDimensions(product), y = d.shoulderDrop + d.armDepth + 2.5;
  const xs = outline.flatMap((a, i) => {
    const b = outline[(i + 1) % outline.length];
    return (a.y <= y && b.y > y) || (b.y <= y && a.y > y) ? [a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y)] : [];
  });
  assert.equal(xs.length, 2);
  return { left: Math.min(...xs), right: Math.max(...xs), y };
}

test('neck rib sewing length follows the edited front and back opening with explicit 15% reduction', () => {
  for (const id of ['ringer', 'crew-sweat']) for (const neckline of ['crew', 'v'] as const) for (const neckWidth of [12, 28]) {
    const product = validateProduct({ ...template(id), neckline, fit: { neckWidth, frontNeckDrop: neckline === 'v' ? 15 : 10 } });
    const expected = necklineLength(product) * 0.85;
    const rib = patternPieces(product).find(p => p.part === 'neckband')!;
    assert.ok(Math.abs(rib.width - expected) < 1e-9, `${id} ${neckline} ${neckWidth}: rib ${rib.width}, expected ${expected}`);
    assert.ok(Math.abs(teeDimensions(product).ribLength - expected) < 1e-9);
    assert.match(buildTechPack(product, '2026-10-13').construction.find(c => c.area === 'Neck rib')!.detail, new RegExp(`${expected.toFixed(1)} cm`));
    assert.ok(fabricUsage(product).some(row => row.parts.includes('neckband')));
  }
});

test('chest POM and diagram meet the actual side seams on flared, tapered, curved and banded patterns', () => {
  const designs = [
    validateProduct({ ...template('ringer'), measurements: { chest: 150, length: 55, sleeve: 21 }, fit: { hemWidth: 95 } }),
    validateProduct({ ...template('ringer'), fit: { hemWidth: 40 } }),
    validateProduct({ ...template('ringer'), fit: { hemWidth: 70 }, options: { hem: 'curved', chestPocket: false } }),
    validateProduct({ ...template('crew-sweat'), fit: { hemWidth: 50 } }),
  ];
  for (const product of designs) {
    const ends = chestEnds(product), width = ends.right - ends.left;
    assert.equal(buildTechPack(product, '2026-10-13').poms[0].values.M, Math.round(width * 2) / 2);
    const diagram = measurementDiagram(product), line = /<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"[^>]*\/><text[^>]*>A<\/text>/.exec(diagram)!;
    const shift = Number(/<g transform="translate\(([^ ]+) 0\)">/.exec(diagram)![1]);
    assert.ok(Math.abs(Number(line[1]) + shift - ends.left) < 1e-9);
    assert.ok(Math.abs(Number(line[3]) + shift - ends.right) < 1e-9);
    assert.equal(Number(line[2]), ends.y); assert.equal(Number(line[4]), ends.y);
  }
});
