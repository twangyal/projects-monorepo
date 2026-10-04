import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { renderComparison, createDemoImage } from '../src/render.ts';
import { encodePng, inspectPng } from '../src/png.ts';
import { buildHtmlReport } from '../src/report.ts';
import { rawProject, scalar, TINY, literalRaster, originalPng, chunk } from './oracle/color-fixtures.ts';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) <= 1e-12, `${actual} versus ${expected}`);
function exact(settings: Parameters<typeof rawProject>[0]) {
  const project = rawProject(settings), expected = scalar(project), actual = renderComparison(project);
  assert.deepEqual(actual.baseline, expected.baseline); assert.deepEqual(actual.result, expected.result);
  for (const key of ['artworkChangedPixels','artworkMaxChannelDelta','surroundPixels','totalPixels','maxRgbDelta'] as const) assert.equal(actual.metrics[key], expected.metrics[key]);
  close(actual.metrics.rgbRmse, expected.metrics.rgbRmse); close(actual.metrics.meanAbsoluteLuminanceDelta, expected.metrics.meanAbsoluteLuminanceDelta);
  return actual;
}
test('zero border retains every zero/low alpha RGBA byte and every numerical difference is zero', () => {
  const actual = exact({ border: 0, mode: 'checker', colorA: '#ffffff', colorB: '#000000', cellSize: 4 });
  assert.deepEqual(actual.result.rgba, TINY); assert.deepEqual(actual.metrics, { artworkChangedPixels:0,artworkMaxChannelDelta:0,surroundPixels:0,totalPixels:6,rgbRmse:0,maxRgbDelta:0,meanAbsoluteLuminanceDelta:0 });
});
test('odd artwork and one-pixel white frame have independently computed exact opaque geometry', () => { exact({border:1,colorA:'#ffffff'}); });
test('checker parity uses full-output origin across partial cells and artwork holes', () => { exact({border:5,mode:'checker',colorA:'#090aff',colorB:'#f01000',cellSize:4}); });
test('neutral maximum border has zero difference but nonzero surrounding pixels', () => { const value=exact({border:128});assert.equal(value.metrics.rgbRmse,0);assert.equal(value.metrics.surroundPixels,259*258-6); });
test('one-pixel analytical white surround separates encoded RGB RMSE and linear luminance', () => {
  const project=rawProject({border:1,colorA:'#ffffff'},1,1,new Uint8ClampedArray([9,10,11,1]));
  const actual=renderComparison(project);close(actual.metrics.rgbRmse,127*Math.sqrt(8/9));assert.equal(actual.metrics.maxRgbDelta,127);
  const gray=((128/255+.055)/1.055)**2.4;close(actual.metrics.meanAbsoluteLuminanceDelta,(1-gray)*8/9);assert.equal(actual.metrics.artworkChangedPixels,0);
});
test('byte10/11 transfer-function branch is independently represented in context luminance', () => { exact({border:2,colorA:'#0a0b0a',colorB:'#0b0a0b',mode:'checker',cellSize:4}); });
test('returned source and result arrays are detached from each other and future comparisons', () => {
  const project=rawProject({border:1}), value=renderComparison(project);value.result.rgba.fill(0);value.baseline.rgba.fill(255);
  assert.deepEqual(renderComparison(project).result,scalar(project).result);assert.equal(project.image.rgba,Buffer.from(TINY).toString('base64'));
});
test('procedural demo formula retains hidden RGB and its explicit original128-square provenance', () => {
  const image=createDemoImage(),pixels=Buffer.from(image.rgba,'base64');assert.deepEqual(image.source,{fileName:'Procedural color study',format:'procedural',width:128,height:128});
  for(let y=0;y<128;y++)for(let x=0;x<128;x++){const inside=(x-64)**2+(y-64)**2<900,expected=[...(inside?[239,85,93]:[2*x,2*y,255-x]),x<8?0:x<16?64:255];assert.deepEqual([...pixels.subarray((y*128+x)*4,(y*128+x)*4+4)],expected);}
});
for(const [width,height] of [[3,2],[128,128],[976,976]] as const)test(`independent PNG decoder preserves all raw RGBA at${width}x${height} including stored-DEFLATE boundaries`,()=>{
  const raster=width===3?{width,height,rgba:TINY}:literalRaster(width!,height!),encoded=encodePng(raster),decoded=PNG.sync.read(Buffer.from(encoded));
  assert.equal(decoded.width,width);assert.equal(decoded.height,height);assert.deepEqual(decoded.data,Buffer.from(raster.rgba));assert.ok(encoded.length<=4*1024*1024);
  const names:string[]=[];for(let offset=8;offset<encoded.length;){const bytes=Buffer.from(encoded),size=bytes.readUInt32BE(offset);names.push(bytes.toString('ascii',offset+4,offset+8));offset+=size+12;}assert.deepEqual(names,['IHDR','sRGB','IDAT','IEND']);
});
test('independent supported original RGBA PNG is admitted, reserved type/eXIf/trailing/CRC cases refuse',()=>{
  const raster={width:3,height:2,rgba:TINY},valid=originalPng(raster);assert.deepEqual(inspectPng(valid),{width:3,height:2,colorType:6});
  for(const bytes of [Buffer.concat([valid,Buffer.from([0])]),originalPng(raster,[chunk('eXIf',Buffer.from([1]))]),originalPng(raster,[chunk('abcD',Buffer.from([1]))]),originalPng(raster,[chunk('acTL',Buffer.alloc(8))])])assert.throws(()=>inspectPng(bytes));
  const bad=Buffer.from(valid);bad[29]=bad[29]!^1;assert.throws(()=>inspectPng(bad));
});
test('HTML report owns actual raw pixel digest and embeds exact independently decoded baseline/result PNGs',async()=>{
  const project=rawProject({border:3,mode:'checker',colorA:'#ff0000',colorB:'#0000ff',cellSize:4}),expected=scalar(project),report=await buildHtmlReport(project);
  assert.ok(report.includes(createHash('sha256').update(TINY).digest('hex')));assert.ok(!report.includes('<script>'));assert.ok(!report.includes('<img src=x>'));
  assert.match(report,/default-src[^\n]*none/);assert.match(report,/not.*percept|percept.*not|numerical/i);
  const images=[...report.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)].map(match=>PNG.sync.read(Buffer.from(match[1]!,'base64')));
  assert.equal(images.length,2);for(const [index,raster]of[expected.baseline,expected.result].entries()){assert.equal(images[index]!.width,raster.width);assert.equal(images[index]!.height,raster.height);assert.deepEqual(images[index]!.data,Buffer.from(raster.rgba));}
});
