import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
for (const [id, value, panel] of [['product-length', '75', ''], ['fit-frontNeckDrop', '10', '#fit-panel'], ['spec-style', 'Pending style', ''], ['cost-make', '12', '']] as const) {
  test(`unapplied ${id} survives part selection and unrelated style edits until deliberate apply or discard`, async ({ page }) => {
    await page.goto('/'); const editor = page.locator('#product-editor');
    await editor.getByRole('button', { name: /^Use the Blank tee template/ }).click();
    if (panel) await editor.locator(`${panel} summary`).click();
    const field = editor.locator(`#${id}`); await field.fill(value);
    await editor.getByRole('radio', { name: 'Back body', exact: true }).check();
    await expect(field).toHaveValue(value);
    await editor.getByRole('button', { name: 'Apply Linen', exact: false }).click();
    await expect(field).toHaveValue(value);
    await editor.getByRole('button', { name: 'Discard all product drafts', exact: true }).click();
    await expect(field).not.toHaveValue(value);
  });
}
test('applying one draft group keeps another, refuses replacement/history while pending, and preserves complete committed work', async ({ page }) => {
  page.on('dialog', d => d.accept()); await page.goto('/'); const editor = page.locator('#product-editor');
  await editor.getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await editor.locator('#product-length').fill('75'); await editor.locator('#spec-style').fill('Pending style');
  await editor.getByRole('button', { name: 'Apply measurements', exact: true }).click();
  await expect(editor.locator('#spec-style')).toHaveValue('Pending style');
  const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click();
  const before = JSON.parse((await readFile((await (await wait).path())!)).toString());
  expect(before.product.measurements.length).toBe(75); expect(before.product.spec).toBeUndefined();
  await editor.getByRole('button', { name: /^Use the Ringer tee template/ }).click();
  await expect(page.locator('#message')).toContainText('Apply or discard');
  await page.getByRole('button', { name: 'New concept', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Apply or discard');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(editor.locator('#product-length')).toHaveValue('75');
  await expect(editor.locator('#spec-style')).toHaveValue('Pending style');
  await editor.getByRole('button', { name: 'Apply details', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Tech pack details applied');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(editor.locator('#spec-style')).toHaveValue('');
  await expect(editor.locator('#product-length')).toHaveValue('75');
});

test('artwork placement draft keeps its side through selection and only applies deliberately', async ({ page }) => {
  await page.goto('/'); const editor = page.locator('#product-editor');
  await editor.getByRole('button', { name: /^Use the Blank tee template/ }).click();
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 256; c.getContext('2d')!.fillRect(0, 0, 256, 256); return c.toDataURL('image/png').split(',')[1]; });
  await editor.locator('#artwork-file').setInputFiles({ name: 'real.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.locator('#message')).toContainText('Artwork placed');
  await editor.locator('#artwork-width').fill('20');
  await editor.getByRole('radio', { name: 'Back body', exact: true }).check();
  await expect(editor.locator('#artwork-width')).toHaveValue('20');
  await editor.locator('#artwork-side').selectOption('back');
  await expect(editor.locator('#artwork-side')).toHaveValue('front');
  await expect(editor.locator('#artwork-width')).toHaveValue('20');
  await editor.getByRole('button', { name: 'Apply placement', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Artwork placement applied');
  const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click();
  const saved = JSON.parse((await readFile((await (await wait).path())!)).toString());
  expect(saved.product.artwork[0]).toMatchObject({ part: 'front', widthCm: 20 });
});

test('a genuine delayed motif decode redraw retains a raw text draft, focus and caret', async ({ page }) => {
  await page.addInitScript(() => {
    const decode = HTMLImageElement.prototype.decode;
    const state = { armed: false, waiting: false, redraws: 0, release: () => {} }; Object.assign(window, { draftDecode: state });
    HTMLImageElement.prototype.decode = async function() { await decode.call(this); if (state.armed) { state.armed = false; state.waiting = true; await new Promise<void>(resolve => { state.release = resolve; }); } };
  });
  await page.goto('/'); const editor = page.locator('#product-editor');
  await editor.getByRole('button', { name: /^Use the Blank tee template/ }).click();
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 256; c.getContext('2d')!.fillRect(0, 0, 256, 256); return c.toDataURL('image/png').split(',')[1]; });
  await page.evaluate(() => { (window as unknown as { draftDecode: { armed: boolean } }).draftDecode.armed = true; });
  await editor.locator('#motif-file').setInputFiles({ name: 'late.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect.poll(() => page.evaluate(() => (window as unknown as { draftDecode: { waiting: boolean } }).draftDecode.waiting)).toBe(true);
  await editor.locator('#spec-style').fill('Pending text');
  await page.evaluate(() => {
    (document.getElementById('spec-style') as HTMLInputElement).setSelectionRange(3, 3);
    const state = (window as unknown as { draftDecode: { redraws: number } }).draftDecode;
    new MutationObserver(() => { state.redraws++; }).observe(document.getElementById('product-pieces')!, { childList: true });
  });
  await page.evaluate(() => (window as unknown as { draftDecode: { release: () => void } }).draftDecode.release());
  await expect.poll(() => page.evaluate(() => (window as unknown as { draftDecode: { redraws: number } }).draftDecode.redraws)).toBeGreaterThan(0);
  await expect(editor.locator('#spec-style')).toHaveValue('Pending text');
  await expect(editor.locator('#spec-style')).toBeFocused();
  expect(await editor.locator('#spec-style').evaluate(f => (f as HTMLInputElement).selectionStart)).toBe(3);
});

test('pending fit draft refuses a pointer drag before moving the visible pattern handle', async ({ page }) => {
  await page.goto('/'); const editor = page.locator('#product-editor');
  await editor.getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await editor.locator('#fit-panel summary').click(); await editor.locator('#fit-frontNeckDrop').fill('10');
  const handle = editor.getByRole('slider', { name: 'Shoulder point: Shoulder width', exact: true });
  await handle.scrollIntoViewIfNeeded(); const before = await handle.getAttribute('cx'), box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 8, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
  await expect(handle).toHaveAttribute('cx', before!);
  await expect(editor.locator('#fit-frontNeckDrop')).toHaveValue('10');
});
test('blank fabric price refuses Apply and retains the raw price and complete committed project', async ({ page }) => {
  await page.goto('/'); const editor = page.locator('#product-editor');
  await editor.getByRole('button', { name: /^Use the Blank tee template/ }).click();
  async function backup() { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return (await readFile((await (await wait).path())!)).toString(); }
  const before = await backup(), price = editor.locator('#fabric-prices input').first();
  await price.fill(''); await editor.getByRole('button', { name: 'Apply costing', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Fill in every costing value');
  await expect(price).toHaveValue(''); expect(await backup()).toBe(before);
});
