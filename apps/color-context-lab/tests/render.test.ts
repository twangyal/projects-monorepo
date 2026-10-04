import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoImage, renderComparison } from '../src/render.ts';
import type { Project, Settings } from '../src/types.ts';
const settings: Settings = { mode: 'solid', border: 1, colorA: '#ff0000', colorB: '#0000ff', cellSize: 4 };
function project(): Project {
  return { schemaVersion: 1, id: '12345678-1234-4234-8234-123456789012', title: 'Original study', image: { id: '12345678-1234-4234-8234-123456789013', width: 2, height: 1, rgba: btoa(String.fromCharCode(9, 8, 7, 0, 100, 20, 30, 1)), source: { fileName: 'original.png', format: 'png', width: 2, height: 1 } }, settings: { ...settings } };
}
test('solid surrounds preserve every center byte and measure encoded RGB and linear luminance over whole output', () => {
  const source = project();
  const before = JSON.stringify(source);
  const result = renderComparison(source);
  assert.equal(JSON.stringify(source), before);
  assert.equal(result.result.width, 4); assert.equal(result.result.height, 3);
  for (const raster of [result.baseline, result.result]) assert.deepEqual([...raster.rgba.slice(20, 28)], [9, 8, 7, 0, 100, 20, 30, 1]);
  assert.deepEqual([...result.result.rgba.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...result.baseline.rgba.slice(0, 4)], [128, 128, 128, 255]);
  assert.equal(result.metrics.artworkChangedPixels, 0); assert.equal(result.metrics.artworkMaxChannelDelta, 0);
  assert.equal(result.metrics.surroundPixels, 10); assert.equal(result.metrics.totalPixels, 12);
  assert.equal(result.metrics.maxRgbDelta, 128);
  assert.equal(result.metrics.rgbRmse, Math.sqrt(10 * (127 ** 2 + 128 ** 2 * 2) / 36));
  const grayY = ((128 / 255 + .055) / 1.055) ** 2.4;
  assert.ok(Math.abs(result.metrics.meanAbsoluteLuminanceDelta - 10 / 12 * Math.abs(.2126 - grayY)) < 1e-15);
  result.result.rgba.fill(0);
  assert.notEqual(renderComparison(source).result.rgba[0], 0);
});
test('checker phase is anchored to complete output, while zero-border comparisons are byte-identical', () => {
  const p = project(); p.settings = { ...settings, mode: 'checker', border: 4 };
  const r = renderComparison(p);
  const pixel = (x: number, y: number) => [...r.result.rgba.slice((y * r.result.width + x) * 4, (y * r.result.width + x) * 4 + 4)];
  assert.deepEqual(pixel(0, 0), [255, 0, 0, 255]); assert.deepEqual(pixel(4, 0), [0, 0, 255, 255]); assert.deepEqual(pixel(4, 8), [0, 0, 255, 255]);
  p.settings.border = 0;
  const z = renderComparison(p);
  assert.deepEqual(z.baseline.rgba, z.result.rgba);
  assert.deepEqual(z.metrics, { artworkChangedPixels: 0, artworkMaxChannelDelta: 0, surroundPixels: 0, totalPixels: 2, rgbRmse: 0, maxRgbDelta: 0, meanAbsoluteLuminanceDelta: 0 });
});
test('procedural original has exact center, alpha bands and retained transparent RGB', () => {
  const demo = createDemoImage();
  assert.equal(demo.width, 128); assert.equal(demo.height, 128);
  assert.deepEqual(demo.source, { fileName: 'Procedural color study', format: 'procedural', width: 128, height: 128 });
  const bytes = Uint8Array.from(atob(demo.rgba), c => c.charCodeAt(0));
  const at = (x: number, y: number) => [...bytes.slice((y * 128 + x) * 4, (y * 128 + x) * 4 + 4)];
  assert.deepEqual(at(0, 0), [0, 0, 255, 0]); assert.deepEqual(at(8, 0), [16, 0, 247, 64]); assert.deepEqual(at(16, 0), [32, 0, 239, 255]);
  assert.deepEqual(at(64, 64), [239, 85, 93, 255]); assert.deepEqual(at(94, 64), [188, 128, 161, 255]);
});
