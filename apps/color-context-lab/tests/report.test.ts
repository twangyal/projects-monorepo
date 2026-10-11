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

test('two retained variants export named exact PNGs with independent neutral diagnostics and safe literals', async () => {
  const project=fixture();project.variants=[{name:'Warm <script>',settings:{...project.settings,border:2,colorA:'#ff0000'}},{name:'Cool',settings:{...project.settings,border:3,colorA:'#0000ff'}}];
  const {buildVariantReport}=await import('../src/report.ts');
  assert.equal(typeof buildVariantReport,'function');
  const html=await buildVariantReport(project,0,1);
  assert.match(html,/Warm &lt;script&gt;/);assert.match(html,/Cool/);assert.doesNotMatch(html,/<script/);
  const images=[...html.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)];assert.equal(images.length,2);
  const {PNG}=await import('pngjs');
  for(const [index,image] of images.entries()) {
    const png=PNG.sync.read(Buffer.from(image[1]!,'base64')), border=index===0?2:3, side=1+2*border;
    assert.equal(png.width,side);assert.equal(png.height,side);
    const offset=(border*side+border)*4;assert.deepEqual([...png.data.subarray(offset,offset+4)],[10,20,30,1]);
    assert.deepEqual([...png.data.subarray(0,4)], index===0?[255,0,0,255]:[0,0,255,255]);
  }
  assert.match(html,/each variant.*neutral/i);assert.match(html,/not.*perceptual/i);
});
test('variant report rejects missing/duplicate selections and snapshots before async work', async () => {
  const {buildVariantReport}=await import('../src/report.ts');
  const project=fixture();project.variants=[{name:'One',settings:project.settings},{name:'Two',settings:{...project.settings,colorA:'#ff0000'}}];
  for(const pair of [[0,0],[-1,1],[0,2],[0,.5],[NaN,1]]) await assert.rejects(buildVariantReport(project,pair[0]!,pair[1]!));
  const pending=buildVariantReport(project,0,1);project.variants[0]!.name='Changed later';
  const html=await pending;assert.match(html,/One/);assert.doesNotMatch(html,/Changed later/);
  const cancelled=new AbortController(), during=buildVariantReport(project,0,1,cancelled.signal);cancelled.abort();
  await assert.rejects(during,{name:'AbortError'});
});

test('two maximum976 retained variants stay complete inside the unchanged16MiB report bound',async()=>{
  const {buildVariantReport}=await import('../src/report.ts');const project=fixture(), raw=Buffer.alloc(720*720*4);
  for(let i=0;i<raw.length;i++)raw[i]=i%256;
  project.image={...project.image,width:720,height:720,rgba:raw.toString('base64'),source:{...project.image.source,width:720,height:720}};
  project.variants=[{name:'Maximum warm',settings:{...project.settings,border:128}},{name:'Maximum cool',settings:{...project.settings,border:128,colorA:'#0000ff'}}];
  const html=await buildVariantReport(project,0,1);assert.ok(Buffer.byteLength(html)<=16*1024*1024);assert.match(html,/<\/html>$/);
  const {PNG}=await import('pngjs');
  for(const image of html.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)) {
    const png=PNG.sync.read(Buffer.from(image[1]!,'base64'));assert.equal(png.width,976);assert.equal(png.height,976);
    for(let row=0;row<720;row++)assert.deepEqual(png.data.subarray(((row+128)*976+128)*4,((row+128)*976+848)*4),raw.subarray(row*720*4,(row+1)*720*4));
  }
});
