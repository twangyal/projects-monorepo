import { expect, test } from '@playwright/test';
import type { DrawingLayer, ImageLayer } from '../src/model.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/media-harness.html');
  await expect(page.locator('#ready')).toHaveText('Actual media modules ready');
});
test('PNG, JPEG, and static WebP genuinely decode and normalize with PNG alpha and edge limits', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.mediaHarness, source = document.createElement('canvas'); source.width = 1200; source.height = 600;
    const ctx = source.getContext('2d')!; ctx.fillStyle = '#FF0000'; ctx.fillRect(300, 150, 600, 300);
    const results = [];
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      const blob = await new Promise<Blob>(resolve => source.toBlob(blob => resolve(blob!), type));
      const layer = await h.importImage(new File([blob], 'Artwork.' + type.split('/')[1], { type }));
      const project = h.createProject(); project.layers = [layer]; await h.validateProjectImages(project);
      const assets = await h.loadAssets(project), bitmap = assets.get(layer.id)!;
      const check = new OffscreenCanvas(layer.image.width, layer.image.height), pixels = check.getContext('2d')!;
      pixels.drawImage(bitmap, 0, 0); const corner = Array.from(pixels.getImageData(0, 0, 1, 1).data);
      results.push({ width: layer.image.width, height: layer.image.height, png: layer.image.dataUrl.startsWith('data:image/png;base64,'), corner, center: Array.from(pixels.getImageData(400, 200, 1, 1).data) });
      h.closeAssets(assets);
    }
    return results;
  });
  for (const image of result) { expect(image.width).toBe(800); expect(image.height).toBe(400); expect(image.png).toBe(true); expect(image.center[0]).toBeGreaterThan(245); }
  expect(result[0].corner[3]).toBe(0); expect(result[2].corner[3]).toBe(0); expect(result[1].corner[3]).toBe(255);
});
test('high entropy valid artwork is downsampled further to respect embedded PNG budget', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = c.height = 800; const ctx = c.getContext('2d')!;
    const pixels = ctx.createImageData(800, 800); let seed = 123456789;
    for (let i = 0; i < pixels.data.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; pixels.data[i] = seed & 255; }
    ctx.putImageData(pixels, 0, 0); const blob = await new Promise<Blob>(resolve => c.toBlob(b => resolve(b!), 'image/png'));
    const layer = await window.mediaHarness.importImage(new File([blob], 'Noise.png', { type: 'image/png' }));
    return { original: blob.size, length: layer.image.dataUrl.length, width: layer.image.width, height: layer.image.height };
  });
  expect(result.original).toBeLessThan(4 * 1024 * 1024); expect(result.length).toBeLessThanOrEqual(1.5 * 1024 * 1024);
  expect(result.width).toBeLessThan(800); expect(result.width).toBe(result.height);
});
test('actual compressed-data failures release partially loaded bitmaps and saved dimensions are verified', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.mediaHarness, c = document.createElement('canvas'); c.width = c.height = 10;
    c.getContext('2d')!.fillRect(0, 0, 10, 10);
    const project = h.createProject(); const base = project.layers[0];
    const good: ImageLayer = { id: 'good', name: 'Good', kind: 'image', keys: base.keys, image: { dataUrl: c.toDataURL('image/png'), width: 10, height: 10 } };
    const bytes = Uint8Array.from(atob(good.image.dataUrl.split(',')[1]), c => c.charCodeAt(0));
    let cursor = 8;
    while (cursor + 12 <= bytes.length) {
      const count = new DataView(bytes.buffer).getUint32(cursor), name = String.fromCharCode(...bytes.subarray(cursor + 4, cursor + 8));
      if (name === 'IDAT') { bytes.fill(0, cursor + 8, cursor + 8 + count); break; } cursor += count + 12;
    }
    const bad: ImageLayer = { ...good, id: 'bad', image: { ...good.image, dataUrl: 'data:image/png;base64,' + btoa(String.fromCharCode(...bytes)) } };
    project.layers = [good, bad];
    const actual = window.createImageBitmap.bind(window), loaded: ImageBitmap[] = [];
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => { const bitmap = await actual(...args); loaded.push(bitmap); return bitmap; }) as typeof createImageBitmap;
    let error = ''; try { await h.loadAssets(project); } catch (e) { error = String(e); } finally { window.createImageBitmap = actual; }
    project.layers = [{ ...good, image: { ...good.image, width: 11 } }]; let mismatch = '';
    try { await h.validateProjectImages(project); } catch (e) { mismatch = String(e); }
    return { error, mismatch, count: loaded.length, widthAfterClose: loaded[0]?.width };
  });
  expect(result.error).toMatch(/decode/i); expect(result.mismatch).toMatch(/dimensions/i); expect(result.count).toBe(1); expect(result.widthAfterClose).toBe(0);
});
test('shared renderer applies local transforms, alpha, dots, layering and restores caller state', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.mediaHarness, project = h.createProject(); project.background = '#FFFFFF'; project.frameCount = 12;
    const layer = project.layers[0] as DrawingLayer;
    layer.strokes = [{ color: '#FF0000', width: 10, points: [{ x: 20, y: 0 }] }];
    layer.keys = [{ frame: 0, x: 100, y: 100, scale: 2, rotation: 90, opacity: 0.5, easing: 'linear' }];
    const c = document.createElement('canvas'); c.width = 640; c.height = 360; const ctx = c.getContext('2d')!;
    ctx.translate(7, 9); ctx.globalAlpha = 0.3;
    h.renderFrame(ctx, project, 0, new Map());
    const pixel = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    const transformed = pixel(100, 140), original = pixel(120, 100), state = [ctx.getTransform().e, ctx.getTransform().f, ctx.globalAlpha];
    const top = h.createDrawingLayer(); top.strokes = [{ color: '#0000FF', width: 12, points: [{ x: 0, y: 0 }] }]; top.keys[0].x = 100; top.keys[0].y = 140; project.layers.push(top);
    h.renderFrame(ctx, project, 0, new Map()); return { transformed, original, state, top: pixel(100, 140) };
  });
  expect(result.transformed).toEqual([255, 127, 127, 255]); expect(result.original).toEqual([255, 255, 255, 255]);
  expect(result.state[0]).toBe(7); expect(result.state[1]).toBe(9); expect(result.state[2]).toBeCloseTo(0.3); expect(result.top).toEqual([0, 0, 255, 255]);
});
test('DOM and OffscreenCanvas render identical transformed artwork and fitted centered images', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.mediaHarness, project = h.createProject(); project.background = '#FFFFFF'; project.frameCount = 24;
    const source = document.createElement('canvas'); source.width = 20; source.height = 10; const ink = source.getContext('2d')!;
    ink.fillStyle = '#FF0000'; ink.fillRect(0, 0, 10, 10); ink.fillStyle = '#0000FF'; ink.fillRect(10, 0, 10, 10);
    const layer = await h.importImage(new File([await new Promise<Blob>(resolve => source.toBlob(b => resolve(b!), 'image/png'))], 'Split.png', { type: 'image/png' }));
    layer.keys = [{ frame: 0, x: 100, y: 100, scale: 1, rotation: 90, opacity: 1, easing: 'ease' }, { frame: 23, x: 300, y: 180, scale: 2, rotation: 450, opacity: 0.5, easing: 'linear' }]; project.layers = [layer];
    const assets = await h.loadAssets(project), dom = document.createElement('canvas'); dom.width = 640; dom.height = 360;
    const off = new OffscreenCanvas(640, 360), a = dom.getContext('2d')!, b = off.getContext('2d')!;
    const equal = [];
    for (const frame of [0, 11.5, 23]) { h.renderFrame(a, project, frame, assets); h.renderFrame(b, project, frame, assets); const aa = a.getImageData(0, 0, 640, 360).data, bb = b.getImageData(0, 0, 640, 360).data; equal.push(aa.every((value, i) => value === bb[i])); }
    h.renderFrame(a, project, 0, assets); const pixel = (x: number, y: number) => Array.from(a.getImageData(x, y, 1, 1).data);
    const pixels = [pixel(100, 95), pixel(100, 105), pixel(100, 85)]; h.closeAssets(assets); return { equal, pixels, size: assets.size };
  });
  expect(result.equal).toEqual([true, true, true]); expect(result.pixels).toEqual([[255, 0, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]]); expect(result.size).toBe(0);
});
