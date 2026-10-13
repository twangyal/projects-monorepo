import test from 'node:test';
import assert from 'node:assert/strict';
import { patternPieces, template } from '../src/product.ts';
import { cleanOutline, layoutPattern, offsetOutline, patternDxf, patternSvg } from '../src/pattern-export.ts';

const area = (points: { x: number; y: number }[]) => { let s = 0; for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s) / 2; };
const perimeter = (points: { x: number; y: number }[]) => points.reduce((sum, p, i) => sum + Math.hypot(points[(i + 1) % points.length].x - p.x, points[(i + 1) % points.length].y - p.y), 0);

test('seam allowance moves every edge outward by the allowance, in either winding', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  for (const outline of [square, [...square].reverse()]) {
    const cut = offsetOutline(outline, 1);
    assert.deepEqual(cut.map(p => [Math.round(p.x * 1e6) / 1e6, Math.round(p.y * 1e6) / 1e6]).sort(), [[-1, -1], [-1, 11], [11, -1], [11, 11]].sort());
  }
  assert.deepEqual(cleanOutline([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0 }]), [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
  // For real pieces the cutting area is about the finished area plus perimeter × allowance, never smaller.
  for (const id of ['ringer', 'garden', 'crew-sweat', 'hoodie']) {
    for (const piece of patternPieces(template(id))) {
      const sewing = cleanOutline(piece.outline), cut = offsetOutline(sewing, 1), expected = area(sewing) + perimeter(sewing);
      assert.ok(area(cut) > area(sewing), `${id} ${piece.part} grows`);
      assert.ok(Math.abs(area(cut) - expected) / expected < 0.06, `${id} ${piece.part}: ${area(cut).toFixed(1)} vs ${expected.toFixed(1)}`);
    }
  }
});

test('the DXF holds a closed cutting and sewing polyline per piece in millimetres, with labels and grainlines', () => {
  const product = template('hoodie'), dxf = patternDxf(product), layout = layoutPattern(product);
  const lines = dxf.trim().split('\n'), pairs: [string, string][] = [];
  for (let i = 0; i < lines.length; i += 2) pairs.push([lines[i].trim(), lines[i + 1]]);
  assert.deepEqual(pairs.slice(0, 2), [['0', 'SECTION'], ['2', 'HEADER']]);
  assert.deepEqual(pairs.at(-1), ['0', 'EOF']);
  const layers = (entity: string) => pairs.flatMap((pair, i) => (pair[0] === '0' && pair[1] === entity ? [pairs[i + 1][1]] : []));
  assert.equal(layers('POLYLINE').filter(layer => layer === 'CUT').length, layout.pieces.length);
  assert.equal(layers('POLYLINE').filter(layer => layer === 'SEW').length, layout.pieces.length);
  assert.equal(layers('LINE').length, layout.pieces.length);
  assert.ok(dxf.includes('\n1\nHood\n') && dxf.includes('cut 2 (mirror)'));
  // Every polyline is closed (70 = 1) and coordinates are millimetres: the front's cut height is (72 + 2) cm.
  assert.ok(pairs.every((pair, i) => pair[1] !== 'POLYLINE' || pair[0] !== '0' || pairs.slice(i, i + 5).some(p => p[0] === '70' && p[1] === '1')));
  // The sewing line ends above the hem band; mitred corners put the cutting line at least 1 cm beyond it.
  const front = layout.pieces[0], span = (points: { y: number }[]) => Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y));
  assert.ok(Math.abs(span(front.sewing) - (product.measurements.length - 6)) < 1e-6, 'hoodie front ends above the hem band');
  assert.ok(span(front.cutting) - span(front.sewing) >= 2 - 1e-9 && span(front.cutting) - span(front.sewing) < 3);
  const vertexYs = pairs.filter(pair => pair[0] === '20').map(pair => Number(pair[1]));
  assert.ok(Math.min(...vertexYs) < -700, 'y in mm, pointing up');
  // Text is plain ASCII: braces and backslashes from the name are removed, other characters become \\U+XXXX.
  const texts = (source: string) => { const l = source.split('\n'); return l.flatMap((line, i) => (line === '1' && i % 2 === 0 && l[i - 2] !== '9' ? [l[i + 1]] : [])); };
  const detail = texts(patternDxf({ ...product, name: 'Café {x}\\' }))[1];
  assert.ok(detail.startsWith('Caf\\U+00E9  x  '), detail);
  assert.ok(/^[\x20-\x7e]*$/.test(detail) && !/[{}]/.test(detail) && !/\\(?!U\+[0-9A-F]{4})/.test(detail));
});

test('the printable SVG is 1:1 in centimetres with a 10 cm check square', () => {
  const product = { ...template('ringer'), name: 'Ringer <tee>' }, svg = patternSvg(product), layout = layoutPattern(product);
  assert.match(svg, new RegExp(`^<svg[^>]+width="${layout.width.toFixed(2)}cm"`));
  assert.match(svg, /<rect width="10" height="10"/);
  assert.equal((svg.match(/<g data-piece=/g) ?? []).length, 5);
  assert.ok(svg.includes('Ringer &lt;tee&gt;') && !svg.includes('<tee>'));
});
