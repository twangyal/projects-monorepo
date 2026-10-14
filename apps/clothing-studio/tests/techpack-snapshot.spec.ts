import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
interface RenderGate { armed: boolean; waiting: boolean; lost: number; release: () => void }
declare global { interface Window { renderGate: RenderGate } }
async function exportPack(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download printable tech pack ↓', exact: true }).click(); const file = await wait; return { name: file.suggestedFilename(), html: (await readFile((await file.path())!)).toString() }; }
const renders = (html: string) => [...html.matchAll(/<img src="(data:image\/png;base64,[^"]+)"/g)].map(m => createHash('sha256').update(Buffer.from(m[1].split(',')[1], 'base64')).digest('hex'));

test('tech pack keeps both original renders, tables and filename while a genuine PNG delivery is held across edits', async ({ page }) => {
  test.setTimeout(120000); page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    const watched = new WeakSet<HTMLCanvasElement>();
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      if (args[0] === 'webgl2' && !watched.has(this)) { watched.add(this); this.addEventListener('webglcontextlost', () => { window.renderGate.lost++; }); }
      return getContext.apply(this, args);
    } as typeof getContext;
    const original = HTMLCanvasElement.prototype.toBlob;
    const gate: RenderGate = { armed: false, waiting: false, lost: 0, release: () => {} }; window.renderGate = gate;
    HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
      if (!gate.armed) return original.call(this, callback, type, quality);
      gate.armed = false;
      return original.call(this, blob => { gate.waiting = true; gate.release = () => callback(blob); }, type, quality);
    };
  });
  await page.goto('/');
  const editor = page.locator('#product-editor');
  await editor.getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await page.getByLabel('Concept name', { exact: true }).fill('Original garment');
  const baseline = await exportPack(page); expect(renders(baseline.html)).toHaveLength(2);
  await page.evaluate(() => { window.renderGate.armed = true; });
  await page.getByRole('button', { name: 'Download printable tech pack ↓', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.renderGate.waiting)).toBe(true);
  await expect(page.getByRole('button', { name: 'Download printable tech pack ↓', exact: true })).toBeDisabled();
  await editor.getByRole('button', { name: /^Use the Ringer tee template/ }).click();
  await page.getByLabel('Concept name', { exact: true }).fill('Newer garment');
  const backupWait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click();
  const before = (await readFile((await (await backupWait).path())!)).toString();
  // Start waiting for the original file after the intervening backup download.
  const originalWait = page.waitForEvent('download');
  await page.evaluate(() => window.renderGate.release());
  const file = await originalWait, html = (await readFile((await file.path())!)).toString();
  expect(renders(html)).toEqual(renders(baseline.html));
  expect(html).toContain('Blank tee'); expect(html).not.toContain('Ringer tee');
  expect(file.suggestedFilename()).toBe('Original garment-tech-pack.html');
  await expect.poll(() => page.evaluate(() => window.renderGate.lost)).toBe(2);
  await expect(page.getByRole('button', { name: 'Download printable tech pack ↓', exact: true })).toBeEnabled();
  expect(await page.locator('#product-canvas').evaluate(c => (c as HTMLCanvasElement).getContext('webgl2')!.isContextLost())).toBe(false);
  const afterWait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click();
  expect((await readFile((await (await afterWait).path())!)).toString()).toBe(before);
  await expect(editor.locator('#product-status')).toContainText('Ringer tee');
});

test('snapshot tech-pack images include genuine uploaded motif and front artwork after decoding', async ({ page }) => {
  test.setTimeout(120000); await page.goto('/');
  const editor = page.locator('#product-editor');
  await editor.getByRole('button', { name: /^Use the Blank tee template/ }).click();
  const image = async (color: string) => Buffer.from(await page.evaluate(color => { const c = document.createElement('canvas'); c.width = c.height = 256; c.getContext('2d')!.fillStyle = color; c.getContext('2d')!.fillRect(0, 0, 256, 256); return c.toDataURL('image/png').split(',')[1]; }, color), 'base64');
  await editor.locator('#motif-file').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: await image('#ed1010') });
  await expect(page.locator('#message')).toContainText('“red” repeats');
  await editor.locator('#artwork-file').setInputFiles({ name: 'blue.png', mimeType: 'image/png', buffer: await image('#1010ed') });
  await expect(page.locator('#message')).toContainText('Artwork placed');
  const pack = await exportPack(page), source = /<img src="(data:image\/png;base64,[^"]+)"/.exec(pack.html)![1];
  const counts = await page.evaluate(async source => {
    const b = new Blob([Uint8Array.from(atob(source.split(',')[1]), c => c.charCodeAt(0))], { type: 'image/png' }), bitmap = await createImageBitmap(b), c = document.createElement('canvas');
    try { c.width = bitmap.width; c.height = bitmap.height; const x = c.getContext('2d')!; x.drawImage(bitmap, 0, 0);
      const pixels = x.getImageData(0, 0, c.width, c.height).data; let red = 0, blue = 0;
      for (let i = 0; i < pixels.length; i += 4) { if (pixels[i] > pixels[i + 2] * 2 && pixels[i] > 90) red++; if (pixels[i + 2] > pixels[i] * 2 && pixels[i + 2] > 90) blue++; }
      return { red, blue };
    } finally { bitmap.close(); }
  }, source);
  expect(counts.red).toBeGreaterThan(100); expect(counts.blue).toBeGreaterThan(100);
});
