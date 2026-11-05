import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOutfitBundle } from '../src/outfit-bundle.ts';
import { createProject } from '../src/model.ts';
import { template } from '../src/product.ts';
import { patternDxf, patternSvg } from '../src/pattern-export.ts';
import { buildTechPack, measurementDiagram, techPackHtml, techPackXlsx, crc32 } from '../src/techpack.ts';

function unpack(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), files = new Map<string, Uint8Array>();
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    assert.equal(view.getUint16(at + 8, true), 0);
    const size = view.getUint32(at + 18, true), nameLength = view.getUint16(at + 26, true), extra = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength)), start = at + 30 + nameLength + extra;
    assert.ok(!files.has(name)); const data = bytes.slice(start, start + size);
    assert.equal(crc32(data), view.getUint32(at + 14, true)); files.set(name, data); at = start + size;
  }
  assert.equal(view.getUint32(at, true), 0x02014b50); return files;
}
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test('two independent sample garments export the exact individual pattern and tech pack files without mutation', () => {
  const product = template('ringer'), wornWith = template('trousers');
  product.spec = { styleNumber:'TOP', season:'Summer', sampleSize:'L' };
  wornWith.spec = { styleNumber:'PANT', season:'Winter', sampleSize:'S' };
  const project = { ...createProject(), product, wornWith }, before = structuredClone(project), date = '2026-11-05';
  const files = unpack(buildOutfitBundle(project, date)), manifest = JSON.parse(text(files.get('manifest.json')!));
  assert.equal(manifest.garments.length, 2); assert.equal(files.size, 10);
  for (const [index, garment] of [product, wornWith].entries()) {
    const entry = manifest.garments[index], pack = buildTechPack(garment, date);
    assert.equal(entry.name, garment.name); assert.equal(entry.sampleSize, garment.spec!.sampleSize); assert.equal(entry.styleNumber, garment.spec!.styleNumber);
    assert.equal(text(files.get(entry.files.svg)!), patternSvg(garment));
    assert.equal(text(files.get(entry.files.dxf)!), patternDxf(garment));
    assert.deepEqual(files.get(entry.files.xlsx), techPackXlsx(pack));
    assert.equal(text(files.get(entry.files.html)!), techPackHtml(pack, {diagram:measurementDiagram(garment)}));
  }
  assert.deepEqual(project, before);
});

test('three-piece outfits keep distinct safe paths even for duplicate hostile names', () => {
  const project = { ...createProject(), product:template('hoodie'), wornWith:template('blank'), wornAlso:template('flared-skirt') };
  for (const garment of [project.product, project.wornWith, project.wornAlso]) garment.name = '../Same / outfit';
  const files = unpack(buildOutfitBundle(project, '2026-11-05')), manifest = JSON.parse(text(files.get('manifest.json')!));
  assert.equal(manifest.garments.length, 3); assert.equal(files.size, 14);
  for (const path of files.keys()) assert.ok(!path.includes('..') && !path.startsWith('/'));
  assert.deepEqual(manifest.garments.map((entry:{sampleSize:string})=>entry.sampleSize), ['M','M','M']);
});

test('missing, incompatible and invalid outfit garments refuse as a whole', () => {
  assert.throws(()=>buildOutfitBundle({...createProject(),product:template('blank')}, '2026-11-05'), /outfit|Wear with/i);
  const project = {...createProject(),product:template('blank'),wornWith:template('ringer')};
  assert.throws(()=>buildOutfitBundle(project,'2026-11-05'), /outfit|compatible/i);
  assert.throws(()=>buildOutfitBundle({...project,wornWith:template('trousers'),wornAlso:template('trousers')},'2026-11-05'), /outfit|compatible/i);
  const malformed = {...createProject(),product:template('blank'),wornWith:template('trousers')};
  malformed.wornWith.measurements = {...malformed.wornWith.measurements, waist: 1};
  const before = structuredClone(malformed);
  assert.throws(()=>buildOutfitBundle(malformed,'2026-11-05'), /waist/i);
  assert.deepEqual(malformed, before);
});
