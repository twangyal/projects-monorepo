import { pngUrl } from './helpers/raster.ts';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('canonical budget rejects a compact backup whose pretty export exceeds 6 MiB, retaining current work and raw input', async ({ page }) => {
  test.setTimeout(90000); await page.goto('/');
  const editor = page.locator('#product-editor');
  await editor.getByRole('button', { name: /^Use the Ringer tee template/ }).click();
  await page.getByLabel('Concept name', { exact: true }).fill('Original complete work');
  async function backup() { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
  const before = await backup(), incoming = structuredClone(before);
  // Genuine PNG containers padded to exercise the canonical graph budget.
  incoming.product.motifs = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, name: 'motif', dataUrl: pngUrl(768,768,500000), width: 768, height: 768 }));
  incoming.product.artwork = ['front', 'back'].map(part => ({ part, dataUrl: pngUrl(1024,1024,1500000), width: 1024, height: 1024, name: 'art', xCm: 0, yCm: 10, widthCm: 20 }));
  const encoded = (text: string) => new TextEncoder().encode(text).length;
  const cap = 6 * 1024 * 1024;
  incoming.note += 'a'.repeat((cap + 4 - encoded(JSON.stringify(incoming, null, 2))) % 4);
  incoming.product.artwork[0].dataUrl = pngUrl(1024,1024,1500000 + cap + 4 - encoded(JSON.stringify(incoming, null, 2)));
  const compact = JSON.stringify(incoming);
  expect(encoded(compact)).toBeLessThan(cap);
  expect(encoded(JSON.stringify(incoming, null, 2))).toBe(cap + 4);
  await editor.getByLabel('Body length (cm)', { exact: true }).fill('75');
  await page.locator('#project-file').setInputFiles({ name: 'oversized-canonical.json', mimeType: 'application/json', buffer: Buffer.from(compact) });
  await expect(page.locator('#message')).toContainText('Apply or discard');
  await expect(editor.getByLabel('Body length (cm)', { exact: true })).toHaveValue('75');
  expect(await backup()).toEqual(before);
  await editor.getByRole('button', { name: 'Discard all product drafts', exact: true }).click();
  await page.locator('#project-file').setInputFiles({ name: 'oversized-canonical.json', mimeType: 'application/json', buffer: Buffer.from(compact) });
  await expect(page.locator('#message')).toContainText('6 MiB');
  expect(await backup()).toEqual(before);
});
