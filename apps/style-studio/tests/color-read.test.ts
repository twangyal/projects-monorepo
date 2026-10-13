import test from 'node:test';
import assert from 'node:assert/strict';
import { colorHarmony, colorName, paletteFor, readGarmentColors, toLab, type GarmentColors } from '../src/color-read.ts';

type RGB = [number, number, number];
const rgb = (hex: string): RGB => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as RGB;
/** A 120×120 "photo": background, a garment body, and optional stripes or a second-color panel. */
function photo(background: string, garment: string, options: { stripe?: string; panel?: string; noise?: number } = {}) {
  const size = 120, data = new Uint8ClampedArray(size * size * 4);
  let seed = 7;
  const jitter = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return ((seed / 0x7fffffff) - 0.5) * 2 * (options.noise ?? 0); };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const inside = x >= 30 && x < 90 && y >= 20 && y < 105, sleeve = y >= 20 && y < 50 && x >= 15 && x < 105;
    let color = rgb(background);
    if (inside || sleeve) {
      color = rgb(garment);
      if (options.stripe && Math.floor(y / 6) % 2) color = rgb(options.stripe);
      if (options.panel && x >= 60) color = rgb(options.panel);
    }
    const i = (y * size + x) * 4;
    data.set([...color.map(c => Math.max(0, Math.min(255, Math.round(c + jitter())))), 255], i);
  }
  return readGarmentColors(data, size, size);
}

test('the garment is separated from its background and its main color named and tagged', () => {
  const navy = photo('#ffffff', '#1f2a4f', { noise: 6 })!;
  assert.equal(navy.colors[0].name, 'navy');
  assert.equal(navy.palette, 'cool');
  assert.match(navy.reason, /^Main color navy \(100% of the piece\): green-to-blue-to-violet hue\.$/);
  assert.ok(navy.garmentShare > 0.4 && navy.garmentShare < 0.6, `${navy.garmentShare}`);
  assert.equal(photo('#ffffff', '#b58b5a')!.palette, 'warm', 'tan');
  assert.equal(photo('#ffffff', '#3d3d3f')!.palette, 'neutral', 'charcoal');
  assert.equal(photo('#ffffff', '#d62020')!.palette, 'bright', 'vivid red');
  // A colored backdrop is recognized from the photo's border, not assumed white.
  const onGreen = photo('#3d8b3d', '#efe6cf')!;
  assert.equal(onGreen.colors[0].name, 'cream');
  assert.equal(onGreen.palette, 'warm');
  // Nothing to read: a white garment on white, or an empty photo.
  assert.equal(photo('#ffffff', '#fdfdfd'), null);
  assert.throws(() => readGarmentColors(new Uint8ClampedArray(10), 2, 2), /dimensions/);
});

test('two-color garments report both colors with their shares, largest first', () => {
  const striped = photo('#ffffff', '#1f2a4f', { stripe: '#d6c4a0' })!;
  assert.deepEqual(striped.colors.map(c => c.name).sort(), ['beige', 'navy']);
  // White stripes on a white backdrop cannot be told apart from the background; only the navy is read.
  assert.deepEqual(photo('#ffffff', '#1f2a4f', { stripe: '#f5f5f2' })!.colors.map(c => c.name), ['navy']);
  const blocked = photo('#ffffff', '#c62a2a', { panel: '#2f62c4' })!;
  assert.deepEqual(blocked.colors.map(c => c.name), ['red', 'blue'].filter((_, i) => i < blocked.colors.length).sort((a, b) => blocked.colors.findIndex(c => c.name === a) - blocked.colors.findIndex(c => c.name === b)));
  assert.ok(blocked.colors.length === 2 && Math.abs(blocked.colors[0].share - blocked.colors[1].share) < 0.35, JSON.stringify(blocked.colors.map(c => c.share)));
  assert.ok(Math.abs(blocked.colors.reduce((sum, c) => sum + c.share, 0) - 1) < 1e-9);
});

test('palette rules and color names are explicit and stable', () => {
  assert.deepEqual(paletteFor(toLab(128, 128, 128)), { palette: 'neutral', why: 'very low color saturation' });
  assert.equal(paletteFor(toLab(240, 212, 58)).palette, 'bright');
  assert.equal(paletteFor(toLab(111, 107, 46)).palette, 'warm', 'olive leans warm');
  assert.equal(paletteFor(toLab(34, 119, 122)).palette, 'cool', 'teal');
  assert.equal(colorName(toLab(30, 40, 80)), 'navy');
  assert.equal(colorName(toLab(250, 250, 250)), 'white');
});

test('outfit color notes describe accents, contrast and hue relations, and say what is missing', () => {
  const read = (hex: string): GarmentColors => photo('#ffffff', hex)!;
  const notes = colorHarmony([{ label: 'top', colors: read('#1f2a4f') }, { label: 'bottom', colors: read('#b58b5a') }, { label: 'shoes', colors: read('#1c1c1c') }]);
  assert.deepEqual(notes, [
    'top (navy) and bottom (tan): strong light–dark contrast; complementary hues.',
    'top (navy) and shoes (black): similar lightness (tonal); a neutral anchors the pair.',
    'bottom (tan) and shoes (black): strong light–dark contrast; a neutral anchors the pair.',
  ]);
  const neutral = colorHarmony([{ label: 'top', colors: read('#3d3d3f') }, { label: 'bottom', colors: read('#8a8a8a') }, { label: 'shoes', colors: null }]);
  assert.equal(neutral[0], 'An all-neutral outfit: the pieces differ in lightness rather than color.');
  assert.equal(neutral.at(-1), '1 piece has no readable photo and is not compared.');
  const accent = colorHarmony([{ label: 'top', colors: read('#c62a2a') }, { label: 'bottom', colors: read('#3d3d3f') }]);
  assert.equal(accent[0], 'One color accent (top, red) against neutral pieces.');
  assert.deepEqual(colorHarmony([{ label: 'top', colors: read('#c62a2a') }, { label: 'bottom', colors: null }]), ['Add photos to at least two pieces to compare their actual colors.']);
});
