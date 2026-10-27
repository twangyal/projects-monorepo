import test from 'node:test';
import assert from 'node:assert/strict';
import { colourDifference, paletteColorway, photoColours } from '../src/photo-colours.ts';
import { template, validateProduct } from '../src/product.ts';

/** An RGBA picture filled by `paint(x, y)`. */
function picture(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number?]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const [r, g, b, a = 255] = paint(x, y); data.set([r, g, b, a], (y * width + x) * 4); }
  return data;
}

test('a photo gives its main colours, most of the picture first, with a little noise merged', () => {
  // A navy garment in the middle of a cream background, with a red stripe; pixel noise of a few levels.
  const noise = (x: number, y: number) => ((x * 7 + y * 13) % 5) - 2;
  const data = picture(100, 100, (x, y) => {
    const n = noise(x, y);
    if (x > 22 && x < 78 && y > 12 && y < 88) return y > 45 && y < 52 ? [178 + n, 58 + n, 46 + n] : [31 + n, 42 + n, 79 + n];
    return [239 + n, 232 + n, 216 + n];
  });
  const colours = photoColours(data, 100, 100);
  assert.equal(colours.length, 3);
  assert.ok(colourDifference(colours[0]!.hex, '#1f2a4f') < 3, `navy first (${colours[0]!.hex})`);
  assert.ok(colourDifference(colours[1]!.hex, '#efe8d8') < 3, `cream second (${colours[1]!.hex})`);
  assert.ok(colourDifference(colours[2]!.hex, '#b23a2e') < 3, `red third (${colours[2]!.hex})`);
  assert.ok(Math.abs(colours.reduce((sum, colour) => sum + colour.share, 0) - 1) < 0.01);
});

test('transparent pixels are ignored and an empty picture has no colours', () => {
  const data = picture(20, 20, (x) => x < 10 ? [0, 0, 0, 0] : [200, 40, 40]);
  assert.deepEqual(photoColours(data, 20, 20).length, 1);
  assert.deepEqual(photoColours(picture(4, 4, () => [10, 10, 10, 0]), 4, 4), []);
});

test('a palette colorway puts the main colour on the body and a contrasting one on trims and prints', () => {
  const hoodie = template('hoodie'), palette = ['#1f2a4f', '#22305a', '#efe8d8', '#b23a2e'];
  const parts = paletteColorway(hoodie, palette);
  assert.equal(parts.front.color, '#1f2a4f');
  assert.equal(parts.hood.color, '#1f2a4f');
  assert.equal(parts.cuffLeft.color, '#efe8d8', 'the near-navy second colour is skipped for trims');
  assert.equal(parts.pocket.color, '#b23a2e');
  assert.equal(parts.front.material, hoodie.parts.front.material);
  const breton = paletteColorway(template('breton'), ['#efe8d8', '#1f2a4f']);
  assert.equal(breton.front.color, '#efe8d8');
  assert.equal(breton.front.print?.color, '#1f2a4f');
  assert.throws(() => paletteColorway(hoodie, []), /photo/);
});

test('a product keeps 1–8 distinct photo colours', () => {
  assert.deepEqual(validateProduct({ ...template('blank'), palette: ['#AABBCC', '#112233'] }).palette, ['#aabbcc', '#112233']);
  for (const palette of [[], ['#aabbcc', '#aabbcc'], Array.from({ length: 9 }, (_, i) => `#0000${i}${i}`), ['navy']]) assert.throws(() => validateProduct({ ...template('blank'), palette }));
});
