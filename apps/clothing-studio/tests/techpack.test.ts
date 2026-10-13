import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { template, validateProduct, type Product, topMeasurements } from '../src/product.ts';
import { buildTechPack, crc32, measurementDiagram, techPackHtml, techPackXlsx } from '../src/techpack.ts';

/** Minimal ZIP reader (store or deflate) to check the workbook really is a valid package. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = new Map<string, string>();
  let end = bytes.length - 22; while (view.getUint32(end, true) !== 0x06054b50) end--;
  let at = view.getUint32(end + 16, true);
  for (let i = 0; i < view.getUint16(end + 10, true); i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const method = view.getUint16(at + 10, true), crc = view.getUint32(at + 16, true), size = view.getUint32(at + 20, true), nameLength = view.getUint16(at + 28, true), local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    assert.equal(view.getUint32(local, true), 0x04034b50, name);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true), raw = bytes.subarray(start, start + size);
    const data = method === 0 ? raw : new Uint8Array(inflateRawSync(raw));
    assert.equal(crc32(data), crc, `${name} checksum`);
    out.set(name, new TextDecoder().decode(data));
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return out;
}

const design = (): Product => validateProduct({ ...template('ringer'), spec: { styleNumber: 'CS-001', season: 'SS27', sampleSize: 'M' } });

test('the tech pack is derived from the design: fabrics with consumption, trims, artwork, graded measurements and construction', () => {
  const product = design(), pack = buildTechPack(product, '2026-10-13');
  assert.equal(pack.styleNumber, 'CS-001'); assert.equal(pack.season, 'SS27'); assert.equal(pack.neckline, 'Crew neck');
  // Ringer: one slub body fabric (front + back), one red sleeve fabric, the rib — three fabric lines plus three trims.
  const fabrics = pack.bom.filter(row => row.item.startsWith('F'));
  assert.equal(fabrics.length, 3, JSON.stringify(fabrics.map(f => f.placement)));
  assert.match(fabrics[0].placement, /Front body, Back body/);
  assert.ok(pack.bom.some(row => row.item.startsWith('T2')));
  const area = (row: { quantity: string }) => Number(/^([\d.]+) m²/.exec(row.quantity)![1]);
  // Front and back are each about 60 × 72 cm; with 15% waste the body fabric is near 2 × 0.43 × 1.15 m².
  assert.ok(area(fabrics[0]) > 0.8 && area(fabrics[0]) < 1.1, fabrics[0].quantity);
  const bigger = buildTechPack({ ...product, measurements: { ...topMeasurements(product), chest: topMeasurements(product).chest + 20 } }, '2026-10-13');
  assert.ok(area(bigger.bom[0]) > area(fabrics[0]), 'consumption follows the measurements');
  // Points of measure A–K; the sample size column equals the design; grading is monotonic.
  assert.deepEqual(pack.poms.map(p => p.code), [...'ABCDEFGHIJK']);
  const chest = pack.poms[0];
  assert.equal(chest.values.M, Math.round((topMeasurements(product).chest / 2 + 2) * 2) / 2);
  assert.ok(chest.values.XS < chest.values.S && chest.values.S < chest.values.M && chest.values.M < chest.values.L && chest.values.L < chest.values.XL);
  assert.equal(pack.poms.find(p => p.code === 'B')!.values.M, topMeasurements(product).length);
  // Changing the sample size re-centres the grade on the design's measurements.
  const large = buildTechPack({ ...product, spec: { ...product.spec!, sampleSize: 'L' } }, '2026-10-13');
  assert.equal(large.poms[0].values.L, chest.values.M);
  // V-neck and artwork show up where a factory needs them.
  const v = buildTechPack({ ...product, neckline: 'v', artwork: [{ part: 'back', dataUrl: 'data:image/png;base64,AAAA', width: 200, height: 100, name: 'logo.png', xCm: 0, yCm: 12, widthCm: 20 }] }, '2026-10-13');
  assert.equal(v.poms.find(p => p.code === 'G')!.values.M, 15);
  assert.match(v.construction.find(c => c.area === 'Neck rib')!.detail, /Mitred/);
  const art = v.bom.find(row => row.item.startsWith('A'))!;
  assert.match(art.placement, /^Back: 12\.0 cm below shoulder, centred/); assert.equal(art.quantity, '20.0 cm × 10.0 cm');
  assert.ok(v.construction.some(c => c.area === 'Back artwork'));
  // Without details the pack still builds with sample size M.
  assert.equal(buildTechPack(template('blank'), '2026-10-13').sampleSize, 'M');
});

test('the Excel workbook is a valid Office Open XML package with four sheets', () => {
  const product = design(); product.name = 'Ringer <tee> & co';
  const files = unzip(techPackXlsx(buildTechPack(product, '2026-10-13')));
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet4.xml']) assert.ok(files.has(name), name);
  assert.deepEqual([...files.get('xl/workbook.xml')!.matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1]), ['Cover', 'Bill of materials', 'Points of measure', 'Construction']);
  const cover = files.get('xl/worksheets/sheet1.xml')!;
  assert.match(cover, /Ringer &lt;tee&gt; &amp; co/);
  assert.match(cover, /<c r="B3" t="inlineStr"><is><t xml:space="preserve">CS-001<\/t>/);
  const pom = files.get('xl/worksheets/sheet3.xml')!;
  assert.match(pom, /M \(sample\)/);
  assert.match(pom, /<c r="A2" t="inlineStr"><is><t xml:space="preserve">A<\/t><\/is><\/c>/);
  assert.match(pom, /<c r="I12"><v>/, 'the XL column of the last point of measure is numeric');
  for (const [name, text] of files) if (name.endsWith('.xml') || name.endsWith('.rels')) assert.match(text, /^<\?xml version="1.0"/, name);
});

test('the printable tech pack escapes text, only embeds PNG data renders and draws the measurement diagram', () => {
  const product = design(); product.name = '<script>alert(1)</script>';
  const diagram = measurementDiagram(product);
  assert.match(diagram, /^<svg[^>]+role="img"/);
  for (const code of 'ABCDEFGIJ') assert.match(diagram, new RegExp(`>${code}</text>`));
  const page = techPackHtml(buildTechPack(product, '2026-10-13'), { front: 'data:image/png;base64,iVBORw0KGgo=', back: 'javascript:alert(1)', diagram });
  assert.ok(!page.includes('<script>') && page.includes('&lt;script&gt;'));
  assert.match(page, /<img src="data:image\/png;base64,iVBORw0KGgo=" alt="Front render">/);
  assert.ok(!page.includes('javascript:'));
  assert.match(page, /Content-Security-Policy/);
  assert.match(page, /<h2>Points of measure \(cm\)<\/h2>/);
});
