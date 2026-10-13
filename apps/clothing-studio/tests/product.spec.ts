import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function bytes(page: Page, name: string) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); return readFile((await (await wait).path())!); }
async function backup(page: Page) { return JSON.parse((await bytes(page, 'Export project backup')).toString()); }
const editor = (page: Page) => page.locator('#product-editor');
/** Drag a library swatch onto the garment at a point given as fractions of the 3D view. */
async function dropOn(page: Page, swatch: string, fx: number, fy: number) {
  const box = (await page.locator('#product-canvas').boundingBox())!;
  await page.evaluate(({ swatch, x, y }) => {
    const source = [...document.querySelectorAll<HTMLElement>('#product-editor [data-swatch]')].find(item => item.getAttribute('aria-label') === swatch)!;
    const data = new DataTransfer(); data.setData('application/x-clothing-swatch', source.dataset.swatch!);
    const canvas = document.getElementById('product-canvas')!;
    canvas.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new DragEvent('drop', { dataTransfer: data, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }, { swatch, x: box.x + box.width * fx, y: box.y + box.height * fy });
}

test('a template is styled part by part in 3D, with prints, artwork, linked pattern pieces and exports, as undoable saved edits', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await expect(editor(page).locator('#product-status')).toContainText('Choose a template');
  const before = await backup(page);
  expect(before.product).toBeUndefined();

  await editor(page).getByRole('button', { name: /^Use the Ringer tee template/ }).click();
  await expect(editor(page).locator('#product-status')).toContainText('Editing Ringer tee');
  let saved = (await backup(page)).product;
  expect(saved.parts.sleeveLeft.color).toBe('#b23a2e');
  expect(saved.parts.front.material).toBe('slub-160');

  // Dragging denim onto the middle of the front body changes only that part.
  await dropOn(page, 'Apply Denim twill', 0.5, 0.55);
  await expect(page.locator('#message')).toContainText('Front body: Denim twill');
  saved = (await backup(page)).product;
  expect(saved.parts.front.material).toBe('denim-340');
  expect(saved.parts.back.material).toBe('slub-160');

  // Selecting a part (via the linked pattern piece) and clicking a library print applies it there.
  await editor(page).locator('[data-piece="back"]').click();
  await expect(editor(page).locator('#inspector-heading')).toHaveText('Back body');
  await editor(page).getByRole('button', { name: 'Apply Polka dots print', exact: true }).click();
  await editor(page).getByRole('combobox', { name: 'Repeat', exact: true }).selectOption('half-drop');
  await editor(page).getByLabel('Repeat size (cm)').fill('4');
  await editor(page).getByLabel('Repeat size (cm)').dispatchEvent('change');
  saved = (await backup(page)).product;
  expect(saved.parts.back.print).toEqual({ motif: 'dots', color: '#1f2a4f', scaleCm: 4, layout: 'half-drop' });

  // Measurements reshape the 3D garment and the pattern pieces.
  await editor(page).getByLabel('Chest (cm)').fill('120');
  await editor(page).getByLabel('Sleeve length (cm)').fill('60');
  await editor(page).getByRole('button', { name: 'Apply measurements' }).click();
  await expect(editor(page).locator('[data-piece="front"]')).toHaveAttribute('aria-label', 'Front body, 62.0 by 72.0 cm');

  // Artwork keeps transparency and is placed by size and position in cm.
  const art = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 100; const x = c.getContext('2d')!; x.fillStyle = '#e63946'; x.beginPath(); x.arc(100, 50, 45, 0, Math.PI * 2); x.fill(); return c.toDataURL('image/png').split(',')[1]; });
  await editor(page).locator('#artwork-file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(art, 'base64') });
  await expect(page.locator('#message')).toContainText('Artwork placed on the front');
  await editor(page).getByLabel('Artwork width (cm)').fill('12');
  await editor(page).getByLabel('Below shoulder (cm)').fill('8');
  await editor(page).getByRole('button', { name: 'Apply placement' }).click();
  saved = (await backup(page)).product;
  expect(saved.artwork).toHaveLength(1);
  expect(saved.artwork[0]).toMatchObject({ part: 'front', widthCm: 12, yCm: 8, xCm: 0, width: 200, height: 100 });
  expect(saved.artwork[0].dataUrl.startsWith('data:image/png;base64,')).toBe(true);

  // The 3D view really draws the garment, and exports work.
  const png = await bytes(page, 'Export front render PNG ↓');
  expect([...png.subarray(1, 4)].map(c => String.fromCharCode(c)).join('')).toBe('PNG');
  const glb = await bytes(page, 'Export 3D model (GLB) ↓');
  expect(glb.subarray(0, 4).toString()).toBe('glTF');
  const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
  expect(gltf.nodes.map((node: { name: string }) => node.name)).toEqual(expect.arrayContaining(['Front body', 'Back body', 'Left sleeve', 'Right sleeve', 'Neck rib', 'Front artwork']));
  const painted = await page.locator('#product-canvas').evaluate(node => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d')!; x.drawImage(node as HTMLCanvasElement, 0, 0, 64, 64);
    const data = x.getImageData(0, 0, 64, 64).data; let opaque = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++; return opaque;
  });
  expect(painted).toBeGreaterThan(400);

  // Every change was one undo step; the design survives reload.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await backup(page)).product.artwork[0].widthCm).not.toBe(12);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('#save-state')).toHaveText('Locally saved');
  await page.reload();
  await expect(editor(page).locator('#product-status')).toContainText('Editing Ringer tee');
  expect((await backup(page)).product).toEqual(saved);
});

test('the product editor fits a phone screen and the library works without dragging', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Breton stripe template/ }).click();
  await expect(editor(page).locator('#product-status')).toContainText('Editing Breton stripe tee');
  await editor(page).getByRole('radio', { name: 'Right sleeve' }).check();
  await editor(page).getByRole('button', { name: 'Apply color #b23a2e', exact: true }).click();
  expect((await backup(page)).product.parts.sleeveRight.color).toBe('#b23a2e');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
