import assert from 'node:assert/strict';
import test from 'node:test';
import { PNG } from 'pngjs';
import { planeScale, projectPoint, renderPixels, presentFrame } from '../src/render.ts';
import type { Project, Raster, Settings } from '../src/types.ts';

const settings: Settings = { mode: 'fixed', sourceFocal: 50, targetFocal: 50, shiftX: 0, shiftY: 0, near: 0.6, far: 2 };
function fixture(width: number, height: number, pixels?: number[], labels?: number[]): { source: Raster; project: Project } {
  const rgba = pixels ? new Uint8ClampedArray(pixels) : new Uint8ClampedArray(width * height * 4).fill(255);
  const png = PNG.sync.write({ width, height, data: Buffer.from(rgba) } as PNG);
  return { source: { width, height, rgba }, project: {
    schemaVersion: 1, id: '11111111-1111-4111-8111-111111111111', title: 'Numerical test',
    photo: { id: '22222222-2222-4222-8222-222222222222', width, height, dataUrl: `data:image/png;base64,${png.toString('base64')}` },
    settings: { ...settings }, depth: { width, height, labels: Buffer.from(labels ?? new Array(width * height).fill(1)).toString('base64') },
  } };
}
function close(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) <= 1e-12, `${actual} != ${expected}`); }

test('analytical projection scales and translated points use exact subject anchoring', () => {
  const s = { ...settings, mode: 'perspective' as const, targetFocal: 40 };
  close(planeScale(s, 0), 1.2); assert.equal(planeScale(s, 1), 1); close(planeScale(s, 2), 8 / 9);
  s.targetFocal = 85; close(planeScale(s, 0), 51 / 65); assert.equal(planeScale(s, 1), 1); close(planeScale(s, 2), 34 / 27);
  assert.deepEqual(projectPoint({ x: 2, y: 3 }, { ...s, shiftX: 0.25, shiftY: -0.5 }, 1, 8, 6), { x: 4, y: 0 });
  close(planeScale({ ...settings, targetFocal: 100 }, 2), 2);
});

test('identity is byte exact for mixed depths and alpha, canonicalizing only transparent RGB', () => {
  const { source, project } = fixture(3, 2, [20, 40, 60, 255, 128, 64, 32, 1, 10, 30, 80, 0, 42, 99, 250, 10, 255, 0, 0, 128, 0, 10, 30, 200], [0, 1, 2, 2, 0, 1]);
  const original = source.rgba.slice(); const before = JSON.stringify(project); project.settings.mode = 'perspective';
  const expected = original.slice(); expected.set([0, 0, 0, 0], 8);
  const result = renderPixels(source, project); assert.deepEqual(result.rgba, expected); assert.equal(result.missingFraction, 0);
  assert.deepEqual(source.rgba, original); project.settings.mode = 'fixed'; assert.equal(JSON.stringify(project), before);
  assert.notEqual(result.rgba.buffer, source.rgba.buffer);
});

test('fixed 2x crop inverse-samples pixel centers and wider field leaves sampled holes', () => {
  const { source, project } = fixture(2, 1, [255, 0, 0, 255, 0, 0, 255, 255]);
  project.settings.targetFocal = 100;
  assert.deepEqual([...renderPixels(source, project).rgba], [191, 0, 64, 255, 64, 0, 191, 255]);
  const wide = fixture(4, 4); wide.project.settings.targetFocal = 25;
  const result = renderPixels(wide.source, wide.project); assert.equal(result.missingFraction, 0.75);
  assert.equal(result.rgba[3], 0); assert.equal(result.rgba[(1 * 4 + 1) * 4 + 3], 255);
  const tiny = fixture(1, 1); tiny.project.settings.targetFocal = 25;
  assert.equal(renderPixels(tiny.source, tiny.project).missingFraction, 0);
});

test('source bounds do not clamp, and premultiplied interpolation avoids transparent blue fringes', () => {
  const { source, project } = fixture(2, 1, [255, 0, 0, 255, 0, 0, 255, 0]);
  project.settings.shiftX = 0.25;
  const result = renderPixels(source, project);
  assert.deepEqual([...result.rgba], [255, 0, 0, 128, 255, 0, 0, 128]); assert.equal(result.missingFraction, 0.25);
  project.settings.shiftX = 0.5;
  assert.deepEqual([...renderPixels(source, project).rgba], [0, 0, 0, 0, 255, 0, 0, 255]);
});

test('rounded-zero alpha canonicalizes RGB and original transparency does not mean missing coverage', () => {
  const low = fixture(2, 1, [255, 99, 33, 1, 0, 0, 0, 0]); low.project.settings.shiftX = 0.375;
  assert.deepEqual([...renderPixels(low.source, low.project).rgba.slice(0, 4)], [0, 0, 0, 0]);
  const transparent = fixture(1, 1, [100, 200, 250, 0]);
  const result = renderPixels(transparent.source, transparent.project);
  assert.equal(result.missingFraction, 0); assert.deepEqual([...result.rgba], [0, 0, 0, 0]);
});

test('all-subject manual perspective remains unchanged at both lens directions', () => {
  const { source, project } = fixture(2, 2, [12, 34, 56, 255, 250, 128, 33, 1, 99, 72, 55, 100, 1, 2, 3, 255]);
  project.settings.mode = 'perspective';
  for (const target of [40, 85]) { project.settings.targetFocal = target; assert.deepEqual(renderPixels(source, project).rgba, source.rgba); }
});

test('public geometry and render entries reject unsafe settings, masks, dimensions and raster data', () => {
  const { source, project } = fixture(2, 1);
  for (const bad of [{ ...settings, targetFocal: NaN }, { ...settings, targetFocal: 301 }, { ...settings, sourceFocal: 300, targetFocal: 10 },
    { ...settings, mode: 'perspective', targetFocal: 20 }, { ...settings, shiftX: 0.00001 }, { ...settings, extra: 1 }]) assert.throws(() => planeScale(bad as Settings, 0));
  assert.throws(() => planeScale(settings, 3 as never));
  assert.throws(() => projectPoint({ x: Infinity, y: 0 }, settings, 1, 2, 1));
  assert.throws(() => projectPoint({ x: 3, y: 0 }, settings, 1, 2, 1));
  assert.throws(() => projectPoint({ x: 0, y: 0 }, settings, 1, 1281, 1));
  assert.throws(() => renderPixels({ ...source, rgba: new Uint8ClampedArray(1) }, project));
  assert.throws(() => renderPixels({ ...source, width: 1 }, project));
  assert.throws(() => renderPixels(source, { ...project, depth: { ...project.depth, labels: 'AQM=' } }));
});

test('presentFrame rejects invalid bytes before calling the canvas', () => {
  const ctx = { putImageData() { assert.fail('Invalid raster must not reach Canvas'); } } as unknown as CanvasRenderingContext2D;
  assert.throws(() => presentFrame(ctx, { width: 1, height: 1, rgba: new Uint8ClampedArray(0) }));
});
