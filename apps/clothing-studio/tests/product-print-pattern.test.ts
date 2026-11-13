import test from 'node:test';
import assert from 'node:assert/strict';
import { template, patternPieces } from '../src/product.ts';
import { gradedProduct } from '../src/size-grades.ts';
import { productTileLayouts, tiledProductPatternHtml } from '../src/product-print-pattern.ts';
import { drawingTileLayout, tiledDrawingHtml } from '../src/print-pattern.ts';

test('product tiles cover each cutting piece at physical scale with exactly one cm overlap', () => {
  for (const paper of ['a4', 'letter'] as const) for (const id of ['shirt', 'hoodie', 'trousers', 'flared-skirt']) {
    const product = gradedProduct(template(id), 'L'), before = structuredClone(product);
    const layouts = productTileLayouts(product, paper), pieces = patternPieces(product);
    assert.deepEqual(layouts.map(item => item.part), pieces.map(piece => piece.part));
    for (const { layout } of layouts) {
      assert.equal(layout.paperWidth, paper === 'a4' ? 21 : 21.59);
      assert.equal(layout.paperHeight, paper === 'a4' ? 29.7 : 27.94);
      assert.ok(layout.columns * layout.rows === layout.tiles.length);
      const coverWidth = (layout.columns - 1) * (layout.tileWidth - 1) + layout.tileWidth;
      const coverHeight = (layout.rows - 1) * (layout.tileHeight - 1) + layout.tileHeight;
      assert.ok(coverWidth >= layout.patternWidth && coverHeight >= layout.patternHeight);
      assert.ok(layout.columns === 1 || coverWidth - layout.tileWidth + 1 < layout.patternWidth);
      assert.ok(layout.rows === 1 || coverHeight - layout.tileHeight + 1 < layout.patternHeight);
      for (const tile of layout.tiles) assert.deepEqual([tile.x, tile.y], [tile.column * (layout.tileWidth - 1), tile.row * (layout.tileHeight - 1)]);
    }
    assert.deepEqual(product, before);
  }
});

test('printable product pages retain sewing guidance and resolve grain markers within each tile', () => {
  const product = template('shirt'); product.name = '<script>private & style</script>';
  for (const paper of ['a4', 'letter'] as const) {
    const layouts = productTileLayouts(product, paper), count = layouts.reduce((sum, item) => sum + item.layout.tiles.length, 0);
    const html = tiledProductPatternHtml(product, paper);
    assert.equal((html.match(/class="sheet"/g) ?? []).length, count + 1);
    assert.match(html, /5 cm × 5 cm/);
    assert.match(html, /1 cm overlap/);
    assert.match(html, /print at 100%/);
    assert.match(html, /cut 2 \(mirror\)/);
    assert.match(html, /data-fold="collar"/);
    assert.ok(html.includes('&lt;script&gt;private &amp; style&lt;/script&gt;'));
    assert.doesNotMatch(html, /<script|<image|foreignObject|https?:\/\/(?!www.w3.org\/2000\/svg)/);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, 'no duplicate SVG ids across printed pieces or tiles');
    for (const reference of html.matchAll(/url\(#([^)]*)\)/g)) assert.ok(ids.includes(reference[1]), `unresolved ${reference[1]}`);
    assert.ok(new TextEncoder().encode(html).length < 2_000_000);
    assert.ok(count <= 256);
  }
});

test('paper, size and resource limits refuse instead of silently scaling or truncating a product pattern', () => {
  assert.throws(() => productTileLayouts(template('blank'), 'poster' as 'a4'), /paper/i);
  assert.throws(() => tiledProductPatternHtml({ ...template('blank'), measurements: { chest: NaN, length: 70, sleeve: 20 } }, 'a4'));
  // A highly detailed pleated skirt must either fit the explicit limits or refuse the whole document.
  const product = template('pleated-skirt');
  for (const paper of ['a4', 'letter'] as const) {
    const html = tiledProductPatternHtml(product, paper);
    assert.ok(new TextEncoder().encode(html).length <= 2_000_000);
    assert.ok((html.match(/class="sheet"/g) ?? []).length <= 257);
  }
});

test('the shared printer rejects excessive tile counts and complete documents over two MB', () => {
  assert.throws(() => drawingTileLayout('<svg viewBox="0 0 100000 100000"></svg>', 'a4'), /256-tile/);
  const layout = drawingTileLayout('<svg viewBox="0 0 1 1"></svg>', 'a4');
  const item = { layout, label:'Piece', detail:'cut 1' }, text = { title:'Pattern', description:'Pattern', calibrationNote:'Scale check' };
  assert.throws(() => tiledDrawingHtml(Array.from({ length:257 }, () => item), 'a4', text), /256-tile/);
  const large = drawingTileLayout(`<svg viewBox="0 0 1 1">${' '.repeat(2_000_000)}</svg>`, 'a4');
  assert.throws(() => tiledDrawingHtml([{ ...item, layout:large }], 'a4', text), /2 MB/);
});

test('the printed calibration page keeps the construction-mark legend when screen instructions are hidden', () => {
  const html = tiledProductPatternHtml(template('pleated-skirt'), 'letter');
  const calibration = html.slice(html.indexOf('<main>'), html.indexOf('</section>', html.indexOf('<main>')));
  assert.match(calibration, /Solid: cut/);
  assert.match(calibration, /Red dash-dot: fold/);
  assert.match(calibration, /pleat fold\/placement/);
  assert.match(calibration, /V: sew dart legs/);
});
