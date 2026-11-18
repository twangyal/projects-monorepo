import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { pngUrl } from './helpers/raster.ts';
import { placementFromSurface } from '../src/artwork-placement.ts';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { skirtBandHeight, skirtHeight } from '../src/product-skirt.ts';
import { gradedProduct } from '../src/size-grades.ts';
import { buildTechPack } from '../src/techpack.ts';
import {
  SIZES, artworkDefaults, bottomsArtworkFrame, bottomsArtworkProblem, teeMesh, template, trouserDimensions, trouserYoke, validateProduct, withLegCuffs, type Artwork, type Product,
} from '../src/product.ts';

const trousers = template('trousers') as Product, shorts = template('shorts') as Product, jeans = template('jeans') as Product, skirt = template('flared-skirt') as Product;
// A print twice as wide as it is tall, where new artwork goes on that side unless placed otherwise.
const art = (product: Product, part: Artwork['part'], placed: Partial<Artwork> = {}): Artwork =>
  ({ part, dataUrl: pngUrl(100, 50), width: 100, height: 50, name: 'mark.png', ...artworkDefaults(product, part), ...placed });
const tall = (placed: Artwork) => placed.widthCm * placed.height / placed.width;

test('trousers, shorts and skirts take artwork placed below the waist seam, within the garment', () => {
  // New artwork goes on the wearer's left hip in front and the right hip behind: clear of the centre seam, and all of it
  // on the side's surface, so neither of its sides wraps out of view.
  for (const product of [trousers, shorts, jeans]) for (const side of ['front', 'back'] as const) {
    const placed = art(product, side);
    assert.ok(placed.xCm >= placed.widthCm / 2, `${product.name} ${side}: ${JSON.stringify({ ...placed, dataUrl: '' })}`);
    for (const edge of [-1, 1]) assert.equal(bottomsArtworkProblem(product, { ...placed, xCm: placed.xCm + edge * placed.widthCm / 2 }), null, `${product.name} ${side} edge ${edge}`);
    assert.deepEqual(validateProduct({ ...product, artwork: [placed] }).artwork[0], placed);
  }
  // On a skirt it is centred below the waist.
  assert.equal(art(skirt, 'front').xCm, 0);
  assert.equal(validateProduct({ ...skirt, artwork: [art(skirt, 'front'), art(skirt, 'back')] }).artwork.length, 2);
  // Measured from the waist seam: the top of trousers' legs under the waistband, of a skirt's panels under any band.
  assert.equal(bottomsArtworkFrame(trousers).top, trouserDimensions(trousers).length);
  const banded = template('gathered-skirt') as Product;
  assert.ok(skirtBandHeight(banded) > 0);
  assert.equal(bottomsArtworkFrame(banded).top, skirtHeight(banded) - skirtBandHeight(banded));
  // In 3D it is projected straight onto its side, so its centre must lie over that side: not beside the hips ...
  assert.throws(() => validateProduct({ ...trousers, artwork: [art(trousers, 'front', { xCm: 30 })] }),
    /^Error: Artwork on pull-on trousers must be centred on the front legs, as seen from outside\. At 12 cm below the waist, the nearest place is 1[5-7](\.\d)? cm right of centre\.$/);
  // ... nor between the legs, where it says how far out the nearest leg is ...
  const between = bottomsArtworkProblem(trousers, art(trousers, 'front', { xCm: 0, yCm: 50 }))!, leg = Number(/nearest place is ([\d.]+) cm right/.exec(between)![1]);
  assert.ok(leg > 0 && leg < 6, between);
  assert.equal(bottomsArtworkProblem(trousers, art(trousers, 'front', { xCm: leg, yCm: 50 })), null);
  // ... nor on a jeans yoke, a part of its own.
  assert.ok(bottomsArtworkProblem(jeans, art(jeans, 'back', { yCm: 1 }))!.endsWith(
    `centred on the back legs, as seen from outside. Place it below the back yoke, which reaches ${Math.round(trouserYoke(jeans).back * 10) / 10} cm below the waist at the centre back.`));
  // And it must end above the hem (shorts are 46 cm long).
  assert.equal(bottomsArtworkFrame(shorts).length, 46);
  validateProduct({ ...shorts, artwork: [art(shorts, 'front', { yCm: 46 - 5 })] });
  assert.throws(() => validateProduct({ ...shorts, artwork: [art(shorts, 'front', { yCm: 42 })] }), /must end above the hem/);
});

test('a point picked on a leg places the artwork there, and the 3D decal lands on that leg', () => {
  const frame = bottomsArtworkFrame(trousers), front = art(trousers, 'front'), back = art(trousers, 'back');
  const centre = { x: front.xCm, y: frame.top - front.yCm - tall(front) / 2 };
  // The decal is projected onto the front legs at the artwork's centre: the legs' surface is there.
  const legs = teeMesh(trousers, Delaunator).find(mesh => mesh.part === 'front')!;
  let nearest = Infinity;
  for (let v = 0; v < legs.positions.length / 3; v++) nearest = Math.min(nearest, Math.hypot(legs.positions[v * 3]! - centre.x, legs.positions[v * 3 + 1]! - centre.y));
  assert.ok(nearest < 2, `${nearest} cm from the front legs`);
  assert.deepEqual(placementFromSurface(trousers, front, { part: 'front', x: 0, y: 0, at: centre }, front.widthCm), { xCm: front.xCm, yCm: front.yCm });
  // Behind, across is measured as seen from behind.
  assert.deepEqual(placementFromSurface(trousers, back, { part: 'back', x: 0, y: 0, at: { x: -back.xCm, y: frame.top - back.yCm - tall(back) / 2 } }, back.widthCm),
    { xCm: back.xCm, yCm: back.yCm });
  for (const [at, why] of [[{ x: 0, y: frame.top + 1 }, /lower point .* must start below the waist seam/], [{ x: 9, y: 2 }, /higher point .* must end above the hem/],
    [{ x: 40, y: 50 }, /must be centred on the front legs/]] as const) {
    assert.throws(() => placementFromSurface(trousers, front, { part: 'front', x: 0, y: 0, at }, front.widthCm), why);
  }
  assert.throws(() => placementFromSurface(trousers, front, { part: 'front', x: 0, y: 0 }, front.widthCm), /Choose a point on the garment/);
});

test('the tech pack places each print from the waist seam and says which leg it is on', () => {
  const front = art(trousers, 'front'), back = art(trousers, 'back', { rotation: 10 });
  const pack = buildTechPack({ ...trousers, artwork: [front, back] }, '2026-11-18');
  const rows = pack.bom.filter(row => row.item.endsWith(' Artwork'));
  assert.deepEqual(rows.map(row => row.placement), [
    `Front: ${front.yCm.toFixed(1)} cm below the waist seam, ${front.xCm.toFixed(1)} cm right of centre when viewed from outside, on the wearer’s left leg`,
    `Back: ${back.yCm.toFixed(1)} cm below the waist seam, ${back.xCm.toFixed(1)} cm right of centre when viewed from outside, on the wearer’s right leg, 10° clockwise about its centre`,
  ]);
  assert.deepEqual(rows.map(row => row.quantity), [`${front.widthCm.toFixed(1)} cm × ${tall(front).toFixed(1)} cm`, `${back.widthCm.toFixed(1)} cm × ${tall(back).toFixed(1)} cm`]);
  assert.ok(pack.construction.some(row => row.area === 'Front artwork' && row.detail.endsWith('on the wearer’s left leg')), JSON.stringify(pack.construction.at(-2)));
  const centred = buildTechPack({ ...trousers, artwork: [art(trousers, 'front', { xCm: 0 })] }, '2026-11-18');
  assert.match(centred.bom.find(row => row.item === 'A1 Artwork')!.placement, /below the waist seam, centred, across the centre seam$/);
  const skirted = buildTechPack({ ...skirt, artwork: [art(skirt, 'front')] }, '2026-11-18');
  assert.equal(skirted.bom.find(row => row.item === 'A1 Artwork')!.placement, 'Front: 12.0 cm below the waist seam, centred');
  assert.ok(skirted.construction.some(row => row.area === 'Front artwork' && row.detail.includes('below the waist seam')));
  // Tops still measure from the shoulder.
  const tee = template('blank') as Product;
  assert.match(buildTechPack({ ...tee, artwork: [art(tee, 'front')] }, '2026-11-18').bom.find(row => row.item === 'A1 Artwork')!.placement, /^Front: 10\.0 cm below shoulder, centred$/);
});

test('shorter legs, ankle cuffs and smaller sizes pull a print back inside instead of refusing the change', () => {
  // A print near the hem of full-length trousers (106 cm from waist seam to hem).
  const low = validateProduct({ ...trousers, artwork: [art(trousers, 'front', { yCm: 100 })] });
  // Described as shorts, the legs end 46 cm down, so the print moves up to end above the new hem.
  assert.equal(readDesignPrompt('shorts', low).product.artwork[0]!.yCm, 46 - 5);
  // Ankle cuffs shorten the legs too.
  const cuffed = withLegCuffs(low, 8);
  assert.equal(cuffed.artwork[0]!.yCm, bottomsArtworkFrame(cuffed).length - 5);
  // A print out at the side of the hips moves in on smaller sizes, so every size can be graded, shown and measured.
  const wide = validateProduct({ ...shorts, artwork: [art(shorts, 'front', { xCm: 17 })] });
  for (const size of SIZES) assert.equal(bottomsArtworkProblem(gradedProduct(wide, size), gradedProduct(wide, size).artwork[0]!), null, size);
  assert.ok(gradedProduct(wide, 'XS').artwork[0]!.xCm < 16);
  assert.equal(gradedProduct(wide, 'XL').artwork[0]!.xCm, 17);
  assert.ok(!buildTechPack(wide, '2026-11-18').notes.some(note => /fixed grade increments/.test(note)));
  // Text in quotes prints on bottoms, as on tops.
  const described = readDesignPrompt('"Run Club" on the back', shorts);
  assert.deepEqual([described.text?.text, described.text?.side], ['Run Club', 'back']);
});
