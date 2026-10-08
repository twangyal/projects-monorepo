import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { buildHtmlReport } from '../src/report.ts';
import type { Project } from '../src/types.ts';
function fixture(): Project {
  return { schemaVersion: 1, id: '12345678-1234-4234-8234-123456789012', title: '<script>&" study', image: { id: '12345678-1234-4234-8234-123456789013', width: 1, height: 1, rgba: btoa(String.fromCharCode(10, 20, 30, 1)), source: { fileName: '<img onerror="evil">.png', format: 'png', width: 1, height: 1 } }, settings: { mode: 'solid', border: 0, colorA: '#ffffff', colorB: '#000000', cellSize: 4 } };
}
test('HTML derives source SHA and exact hidden-RGB images, escapes literals and states numerical limitations', async () => {
  const project = fixture();
  const report = await buildHtmlReport(project);
  assert.match(report, /&lt;script&gt;&amp;&quot; study/);
  assert.match(report, /&lt;img onerror=&quot;evil&quot;&gt;.png/);
  assert.doesNotMatch(report, /<script|<img onerror/);
  assert.match(report, new RegExp(createHash('sha256').update(Uint8Array.of(10, 20, 30, 1)).digest('hex')));
  assert.match(report, /default-src &#39;none&#39;/);
  assert.match(report, /img-src data:/);
  assert.match(report, /normalized/i); assert.match(report, /protection/i); assert.match(report, /perceptual/i); assert.match(report, /encoded-sRGB/i); assert.match(report, /linear/i);
  const images = [...report.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)];
  assert.equal(images.length, 2);
  for (const image of images) {
    const png = Buffer.from(image[1]!, 'base64');
    let at = 8; const compressed: Buffer[] = [];
    while (at < png.length) { const length = png.readUInt32BE(at); if (png.toString('ascii', at + 4, at + 8) === 'IDAT') compressed.push(png.subarray(at + 8, at + 8 + length)); at += 12 + length; }
    assert.deepEqual([...inflateSync(Buffer.concat(compressed))], [0, 10, 20, 30, 1]);
  }
});
test('report admits detached snapshot before async hash and rejects pre/post-await cancellation', async () => {
  const project = fixture();
  const pending = buildHtmlReport(project);
  project.title = 'Later title'; project.settings.border = 1;
  const report = await pending;
  assert.doesNotMatch(report, /Later title/);
  assert.equal([...report.matchAll(/data:image\/png;base64,/g)].length, 2);
  const before = new AbortController(); before.abort();
  await assert.rejects(buildHtmlReport(fixture(), before.signal), { name: 'AbortError' });
  const during = new AbortController(); const cancelled = buildHtmlReport(fixture(), during.signal); during.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
});
test('maximum976 report remains complete within16MiB and owns its true hash', async () => {
  const project = fixture();
  const rgba = new Uint8Array(720 * 720 * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = i & 255;
  let raw = ''; for (let at = 0; at < rgba.length; at += 16384) raw += String.fromCharCode(...rgba.subarray(at, at + 16384));
  project.image.width = project.image.height = 720; project.image.rgba = btoa(raw); project.image.source.width = project.image.source.height = 720; project.settings.border = 128;
  const html = await buildHtmlReport(project);
  assert.ok(Buffer.byteLength(html) <= 16 * 1024 * 1024);
  assert.match(html, /<\/html>$/);
  assert.match(html, /976/);
  assert.match(html, new RegExp(createHash('sha256').update(rgba).digest('hex')));
});
