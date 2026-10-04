import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImageAsset, createProject, decodePixels } from '../src/model.ts';
import { renderComparison, createDemoImage } from '../src/render.ts';

function project(w:number,h:number,pixels:Uint8ClampedArray) {
  return createProject(createImageAsset({width:w,height:h,rgba:pixels}, {fileName:'Fixture.png',format:'png',width:w,height:h}));
}
test('odd artwork center is copied with hidden RGB while checker starts at output origin', () => {
  const pixels = new Uint8ClampedArray([11,22,33,0,44,55,66,1,77,88,99,64]);
  const p = project(3,1,pixels);
  p.settings = {mode:'checker',border:2,colorA:'#ff0000',colorB:'#0000ff',cellSize:4};
  const c = renderComparison(p);
  assert.equal(c.result.width,7); assert.equal(c.result.height,5);
  assert.deepEqual(c.result.rgba.slice((2*7+2)*4,(2*7+5)*4),pixels);
  assert.deepEqual(c.baseline.rgba.slice((2*7+2)*4,(2*7+5)*4),pixels);
  assert.deepEqual(c.result.rgba.slice(0,4),new Uint8ClampedArray([255,0,0,255]));
  assert.deepEqual(c.result.rgba.slice(16,20),new Uint8ClampedArray([0,0,255,255]));
  assert.deepEqual(c.result.rgba.slice(4*7*4,4*7*4+4),new Uint8ClampedArray([0,0,255,255]));
  assert.equal(c.metrics.artworkChangedPixels,0); assert.equal(c.metrics.artworkMaxChannelDelta,0);
  assert.equal(c.metrics.surroundPixels,32); assert.equal(c.metrics.totalPixels,35);
});
test('RMSE and linear luminance use whole-raster denominator, never alpha weighting', () => {
  const p = project(1,1,new Uint8ClampedArray([222,9,99,0]));
  p.settings = {mode:'solid',border:1,colorA:'#ffffff',colorB:'#000000',cellSize:4};
  const c = renderComparison(p);
  assert.ok(Math.abs(c.metrics.rgbRmse - 127*Math.sqrt(8/9)) < 1e-12);
  assert.equal(c.metrics.maxRgbDelta,127);
  const gray = ((128/255 + .055)/1.055)**2.4;
  assert.ok(Math.abs(c.metrics.meanAbsoluteLuminanceDelta - (1-gray)*8/9) < 1e-12);
});
test('zero border is exact source regardless of both surround colors', () => {
  const pixels = new Uint8ClampedArray([17,63,255,0,49,1,2,64]);
  const p = project(2,1,pixels); p.settings.border=0; p.settings.colorA='#010203'; p.settings.colorB='#ffffff';
  const c = renderComparison(p);
  assert.deepEqual(c.baseline.rgba,pixels); assert.deepEqual(c.result.rgba,pixels);
  assert.deepEqual(c.metrics,{artworkChangedPixels:0,artworkMaxChannelDelta:0,surroundPixels:0,totalPixels:2,rgbRmse:0,maxRgbDelta:0,meanAbsoluteLuminanceDelta:0});
  c.result.rgba[0]=99; assert.equal(c.baseline.rgba[0],17);
});
test('demo is original declared procedural raster with exact alpha regions', () => {
  const a=createDemoImage(); const r=decodePixels(a);
  assert.deepEqual(a.source,{fileName:'Procedural color study',format:'procedural',width:128,height:128});
  assert.deepEqual(r.rgba.slice(0,4),new Uint8ClampedArray([0,0,255,0]));
  assert.deepEqual(r.rgba.slice(8*4,9*4),new Uint8ClampedArray([16,0,247,64]));
  assert.deepEqual(r.rgba.slice((64*128+64)*4,(64*128+64)*4+4),new Uint8ClampedArray([239,85,93,255]));
});
test('maximum source is admitted without regex stack overflow and renders 976 square', () => {
  const pixels=new Uint8ClampedArray(720*720*4); pixels[0]=201; pixels[pixels.length-1]=7;
  const p=project(720,720,pixels); p.settings.border=128;
  const c=renderComparison(p);
  assert.equal(c.result.width,976); assert.equal(c.result.rgba.length,976*976*4);
  assert.equal(c.result.rgba[(128*976+128)*4],201);
  assert.equal(c.result.rgba[((128+719)*976+128+719)*4+3],7);
  assert.equal(c.metrics.surroundPixels,976*976-720*720);
});
