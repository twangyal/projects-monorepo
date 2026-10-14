import test from 'node:test';
import assert from 'node:assert/strict';
import { template, validateProduct } from '../src/product.ts';
import { buildTechPack } from '../src/techpack.ts';
import { pngUrl } from './helpers/raster.ts';
const artwork = {part:'front',name:'Blue mark',dataUrl:pngUrl(16,4),width:16,height:4,xCm:0,yCm:15,widthCm:20};
test('legacy artwork stays unchanged and explicit rotation is retained', () => {
  const legacy = {...template('blank'),artwork:[artwork]};
  assert.deepEqual(validateProduct(legacy).artwork, [artwork]);
  for (const rotation of [-180, -45, 0, 90, 180]) assert.equal((validateProduct({...legacy,artwork:[{...artwork,rotation}]}).artwork[0] as unknown as {rotation:number}).rotation, rotation);
});
test('rotation rejects nonfinite, out of range and nonnumeric values', () => {
  for (const rotation of [NaN, Infinity, -Infinity, -181, 181, '90', null]) assert.throws(() => validateProduct({...template('blank'),artwork:[{...artwork,rotation}]}), /rotation/i);
});
test('tech-pack artwork describes the saved rotation without changing its print dimensions', () => {
  const product = validateProduct({...template('blank'),artwork:[{...artwork,rotation:90}]});
  const row = buildTechPack(product, '2026-10-14').bom.find(row => row.item === 'A1 Artwork')!;
  assert.match(row.placement, /90° clockwise/); assert.match(row.quantity, /20.*5/);
});
