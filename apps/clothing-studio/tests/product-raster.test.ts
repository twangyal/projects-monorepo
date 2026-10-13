import test from 'node:test';
import assert from 'node:assert/strict';
import { template, validateProduct } from '../src/product.ts';
import { pngUrl } from './helpers/raster.ts';
for (const kind of ['motifs', 'artwork'] as const) test(`${kind} admission inspects encoded container and dimensions`, () => {
  const base = template('ringer');
  const asset = kind === 'motifs' ? {id:'m1', name:'logo', dataUrl:pngUrl(10, 8), width:10, height:8} : {part:'front', name:'logo', dataUrl:pngUrl(10, 8), width:10, height:8, xCm:0,yCm:10,widthCm:10};
  assert.doesNotThrow(() => validateProduct({...base, [kind]:[asset]}));
  for (const data of [{dataUrl:'data:image/png;base64,AA=='}, {width:11}, {dataUrl:pngUrl(9000,1),width:1,height:1}, {dataUrl:asset.dataUrl.slice(0,-4)}]) {
    assert.throws(() => validateProduct({...base,[kind]:[{...asset,...data}]}), Error, JSON.stringify(data).slice(0,80));
  }
});
