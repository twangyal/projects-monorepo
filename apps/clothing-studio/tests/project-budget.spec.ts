import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('canonical budget rejects a compact backup whose pretty export exceeds 6 MiB, retaining current work and raw input', async ({ page }) => {
  test.setTimeout(90000); await page.goto('/');
  const editor = page.locator('#product-editor');
  await editor.getByRole('button', { name: /^Use the Ringer tee template/ }).click();
  await page.getByLabel('Concept name', { exact: true }).fill('Original complete work');
  async function backup() { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
  const before = await backup(), incoming = structuredClone(before);
  // Schema-budget fixture only: deliberately not an image-decode/visual-admission claim.
  incoming.product.motifs = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, name: 'motif', dataUrl: 'data:image/png;base64,' + 'A'.repeat(500000), width: 768, height: 768 }));
  incoming.product.artwork = ['front', 'back'].map(part => ({ part, dataUrl: 'data:image/png;base64,' + 'A'.repeat(1500000), width: 1024, height: 1024, name: 'art', xCm: 0, yCm: 10, widthCm: 20 }));
  const encoded = (text: string) => new TextEncoder().encode(text).length;
  const cap = 6 * 1024 * 1024;
  incoming.product.artwork[0].dataUrl += 'A'.repeat(cap + 4 - encoded(JSON.stringify(incoming, null, 2)));
  const compact = JSON.stringify(incoming);
  expect(encoded(compact)).toBeLessThan(cap);
  expect(encoded(JSON.stringify(incoming, null, 2))).toBe(cap + 4);
  await editor.getByLabel('Body length (cm)', { exact: true }).fill('75');
  await page.locator('#project-file').setInputFiles({ name: 'oversized-canonical.json', mimeType: 'application/json', buffer: Buffer.from(compact) });
  await expect(page.locator('#message')).toContainText('6 MiB');
  await expect(editor.getByLabel('Body length (cm)', { exact: true })).toHaveValue('75');
  expect(await backup()).toEqual(before);
});
