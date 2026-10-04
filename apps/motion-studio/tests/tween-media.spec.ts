import { test, expect } from '@playwright/test';
import { parseGIF, decompressFrames } from 'gifuct-js';
import type { Project, DrawingLayer } from '../src/model.ts';

// Original literal artwork and scalar expected positions; no producer-generated oracle.
function source(): Project {
  return { schemaVersion: 2, title: 'Native tween fixture', background: '#ffffff', frameCount: 12,
    layers: [{ id: 'ink', name: 'Ink', kind: 'drawing', keys: [
      { frame: 0, x: 100, y: 100, scale: 1, rotation: 0, opacity: 1, easing: 'linear' },
      { frame: 10, x: 110, y: 100, scale: 1, rotation: 0, opacity: 1, easing: 'linear' }],
    cels: [{ frame: 0, strokes: [{ color: '#ff0000', width: 12, points: [{ x: 0, y: 0 }] }] },
      { frame: 10, strokes: [{ color: '#0000ff', width: 12, points: [{ x: 100, y: 0 }] }] }] }] };
}
test.beforeEach(async ({ page }) => { await page.goto('/tests/tween-harness.html'); await expect(page.locator('#ready')).toHaveText('Actual tween modules ready'); });

test('native preview renders sampled coincident dots with separate pose movement and original holds', async ({ page }) => {
  const results = await page.evaluate(project => {
    const h = window.tweenHarness;
    const proposal = h.buildDrawingTween(project, { layerId: 'ink', startFrame: 0, endFrame: 10 }, {
      pairs: [{ startStroke: 0, endStroke: 0, reverseEnd: false }], frames: [5] });
    const candidate = h.previewDrawingTween(project, proposal);
    const canvas = document.querySelector<HTMLCanvasElement>('#preview')!;
    const notifications: number[] = [];
    const preview = h.createTweenPreview(canvas, candidate, new Map(), 0, 10, frame => notifications.push(frame));
    const pixels = [];
    for (const [frame, x] of [[0, 100], [4, 104], [5, 155], [9, 159], [10, 210]]) {
      preview.showFrame(frame); const ctx = canvas.getContext('2d')!;
      pixels.push(Array.from(ctx.getImageData(x, 100, 1, 1).data));
    }
    const original = JSON.stringify(project), actual = h.applyDrawingTween(project, proposal);
    preview.dispose();
    return { pixels, notifications, sourceUnchanged: JSON.stringify(project) === original,
      start: (actual.layers[0] as DrawingLayer).cels[0], end: (actual.layers[0] as DrawingLayer).cels[2], size: [canvas.width, canvas.height] };
  }, source());
  expect(results.pixels).toEqual([[255, 0, 0, 255], [255, 0, 0, 255], [128, 0, 128, 255], [128, 0, 128, 255], [0, 0, 255, 255]]);
  expect(results.sourceUnchanged).toBe(true); expect(results.size).toEqual([0, 0]);
  expect(results.start).toEqual((source().layers[0] as DrawingLayer).cels[0]);
  expect(results.end).toEqual((source().layers[0] as DrawingLayer).cels[1]);
});

test('actual PNG independently decodes admitted intermediate artwork', async ({ page }) => {
  const result = await page.evaluate(async project => {
    const h = window.tweenHarness, proposal = h.buildDrawingTween(project, { layerId: 'ink', startFrame: 0, endFrame: 10 }, {
      pairs: [{ startStroke: 0, endStroke: 0, reverseEnd: false }], frames: [5] });
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    h.createFrameRenderer(h.applyDrawingTween(project, proposal), new Map()).render(canvas.getContext('2d')!, 5);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
    const bitmap = await createImageBitmap(blob), decoded = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = decoded.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0); const rgba = Array.from(ctx.getImageData(155, 100, 1, 1).data), outside = Array.from(ctx.getImageData(105, 100, 1, 1).data);
    const dimensions = [bitmap.width, bitmap.height]; bitmap.close(); return { dimensions, rgba, outside, bytes: blob.size };
  }, source());
  expect(result.dimensions).toEqual([640, 360]); expect(result.rgba).toEqual([128, 0, 128, 255]);
  expect(result.outside).toEqual([255, 255, 255, 255]); expect(result.bytes).toBeGreaterThan(100);
});

test('actual worker GIF contains independent held/intermediate/end pixels at all12 frames', async ({ page }) => {
  const encoded = await page.evaluate(async project => {
    const h = window.tweenHarness, proposal = h.buildDrawingTween(project, { layerId: 'ink', startFrame: 0, endFrame: 10 }, {
      pairs: [{ startStroke: 0, endStroke: 0, reverseEnd: false }], frames: [5] });
    const blob = await h.exportGif(h.applyDrawingTween(project, proposal), () => {}, new AbortController().signal);
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, source());
  const gif = parseGIF(Uint8Array.from(encoded).buffer), frames = decompressFrames(gif, true);
  expect(frames).toHaveLength(12); expect(frames.reduce((sum, frame) => sum + frame.delay, 0)).toBe(1000);
  for (let f = 0; f < 12; f++) {
    const poseX = f <= 10 ? 100 + f : 110, x = f < 5 ? poseX : f < 10 ? poseX + 50 : poseX + 100;
    const rgba = Array.from(frames[f].patch!.subarray((100 * 640 + x) * 4, (100 * 640 + x) * 4 + 4));
    expect(rgba, `scalar position at frame${f}`).toEqual(f < 5 ? [255, 0, 0, 255] : f < 10 ? [146, 0, 170, 255] : [0, 0, 255, 255]);
  }
});

test('native rAF playback reaches end and disposal leaves a blank released canvas', async ({ page }) => {
  const result = await page.evaluate(async project => {
    const canvas = document.querySelector<HTMLCanvasElement>('#preview')!;
    const frames: number[] = [], preview = window.tweenHarness.createTweenPreview(canvas, project, new Map(), 0, 2, frame => frames.push(frame));
    preview.play(); preview.play();
    const started = performance.now();
    while (preview.frame !== 2 && performance.now() - started < 3000) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const ended = preview.frame; preview.dispose();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    return { ended, frames, dimensions: [canvas.width, canvas.height] };
  }, source());
  expect(result.ended).toBe(2); expect(result.frames[0]).toBe(0); expect(result.frames.at(-1)).toBe(2); expect(result.dimensions).toEqual([0, 0]);
});
