import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';
interface AssetOracle { waiting: boolean; closed: number; release: () => void }
declare global { interface Window { assetOracle: AssetOracle } }
async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('clothing-studio', 1); r.onsuccess = () => resolve(r.result); });
    try { return await new Promise<unknown>(resolve => { const r = db.transaction('project').objectStore('project').get('current'); r.onsuccess = () => resolve(r.result); }); }
    finally { db.close(); }
  });
}
async function setup(page: Page) {
  await page.addInitScript(() => {
    const decode = window.createImageBitmap.bind(window);
    const state: AssetOracle = { waiting: false, closed: 0, release: () => {} };
    window.assetOracle = state;
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      const bitmap = await decode(...args);
      if (args[0] instanceof File && args[0].name === 'held.png') {
        const close = bitmap.close.bind(bitmap); bitmap.close = () => { state.closed++; close(); };
        state.waiting = true; await new Promise<void>(resolve => { state.release = resolve; });
      }
      return bitmap;
    }) as typeof createImageBitmap;
  });
  await page.goto('/');
  await page.locator('#product-editor').getByRole('button', { name: /^Use the Blank tee template/ }).click();
  return Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 256; c.getContext('2d')!.fillRect(0, 0, 256, 256); return c.toDataURL('image/png').split(',')[1]; }), 'base64');
}
for (const kind of ['motif', 'artwork'] as const) for (const scenario of ['raw draft', 'new template', 'newer upload'] as const) {
  test(`${kind} decode retains ${scenario} and closes its retired real bitmap`, async ({ page }) => {
    test.setTimeout(90000); page.on('dialog', dialog => dialog.accept());
    const buffer = await setup(page), editor = page.locator('#product-editor');
    const file = editor.locator(`#${kind}-file`);
    const before = await backup(page);
    await file.setInputFiles({ name: 'held.png', mimeType: 'image/png', buffer });
    await expect.poll(() => page.evaluate(() => window.assetOracle.waiting)).toBe(true);
    if (scenario === 'raw draft') await editor.getByLabel('Body length (cm)', { exact: true }).fill('75');
    else if (scenario === 'new template') await editor.getByRole('button', { name: /^Use the Ringer tee template/ }).click();
    else {
      await file.setInputFiles({ name: 'fresh.png', mimeType: 'image/png', buffer });
      await expect(page.locator('#message')).toContainText(kind === 'motif' ? '“fresh” repeats' : 'Artwork placed');
    }
    if (scenario !== 'raw draft') await expect.poll(async () => {
      const saved = await stored(page) as typeof before;
      return scenario === 'new template' ? saved.product?.name : kind === 'motif' ? saved.product?.motifs?.[0]?.name : saved.product?.artwork?.[0]?.name;
    }).toBe(scenario === 'new template' ? 'Ringer tee' : kind === 'motif' ? 'fresh' : 'fresh.png');
    // Read native persistence without clicking an export button: the tested editing action alone retires the decode.
    const newer = scenario === 'raw draft' ? before : await stored(page) as typeof before;
    const message = await page.locator('#message').textContent();
    await page.evaluate(() => window.assetOracle.release());
    await expect.poll(() => page.evaluate(() => window.assetOracle.closed)).toBe(1);
    await expect(page.locator('#message')).toHaveText(message!);
    expect(await backup(page)).toEqual(newer);
    if (scenario === 'raw draft') {
      expect(newer).toEqual(before);
      await expect(editor.getByLabel('Body length (cm)', { exact: true })).toHaveValue('75');
    }
    if (scenario === 'newer upload') {
      expect(kind === 'motif' ? newer.product.motifs[0].name : newer.product.artwork[0].name).toBe(kind === 'motif' ? 'fresh' : 'fresh.png');
    }
  });
}
