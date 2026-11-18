import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function download(page: Page, name: string) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); return readFile((await (await wait).path())!); }
async function backup(page: Page) { return JSON.parse((await download(page, 'Export project backup')).toString()); }
async function glbNodes(page: Page): Promise<string[]> {
  const bytes = await download(page, 'Export 3D model (GLB) ↓'), json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  return json.nodes.map((node: { name?: string }) => node.name);
}
const editor = (page: Page) => page.locator('#product-editor');
type Saved = { part: string; xCm: number; yCm: number; widthCm: number; rotation?: number };

test('artwork goes on either sleeve: uploaded or described, picked on the sleeve in 3D, and gone when the top is made sleeveless', async ({ page }) => {
  test.setTimeout(150000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Blank tee template/ }).click();
  const side = editor(page).locator('#artwork-side');
  await side.selectOption('sleeveLeft');
  await expect(editor(page).locator('#artwork-x-label')).toHaveText('From sleeve centre line (cm)');
  await expect(editor(page).locator('#artwork-y-label')).toHaveText('Below shoulder point (cm)');
  await expect(editor(page).locator('#sleeve-artwork-help')).toBeVisible();

  // Uploaded artwork lands on the upper arm, on the sleeve's centre line.
  const image = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 160; c.height = 80; c.getContext('2d')!.fillRect(0, 0, 160, 80); return c.toDataURL('image/png').split(',')[1]!; }), 'base64');
  await page.locator('#artwork-file').setInputFiles({ name: 'mark.png', mimeType: 'image/png', buffer: image });
  await expect(page.locator('#message')).toContainText('Artwork placed on the left sleeve.');
  let left = (await backup(page)).product.artwork.find((art: Saved) => art.part === 'sleeveLeft');
  expect(left).toMatchObject({ xCm: 0, widthCm: 8 });
  // The 3D model carries it on the sleeve, and the tech pack prints it on the cut sleeve.
  expect(await glbNodes(page)).toContain('Left sleeve artwork');
  const techpack = editor(page).locator('#techpack-preview');
  await expect(techpack).toContainText(`Left sleeve: top ${left.yCm.toFixed(1)} cm below the shoulder point, on the sleeve’s centre line`);
  await expect(techpack).toContainText('Screen print or DTG on the cut sleeve, before sewing');

  // Picking turns the view to that side; a point on the sleeve sets the placement drafts, applied as one edit.
  await page.getByRole('button', { name: 'Pick artwork centre in 3D', exact: true }).click();
  await expect(page.locator('#artwork-placement-status')).toContainText('Click the visible left sleeve at the artwork centre.');
  const box = (await page.locator('#product-canvas').boundingBox())!;
  let chosen = false;
  // The sleeve comes toward the camera from the shoulder: look for it down the middle of the view.
  for (let at = 0.2; at < 0.7 && !chosen; at += 0.02) {
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * at);
    chosen = /Point chosen/.test(await page.locator('#artwork-placement-status').textContent() ?? '');
  }
  expect(chosen, 'a point on the left sleeve').toBe(true);
  await page.locator('#apply-artwork').click();
  await expect(page.locator('#message')).toContainText('Artwork placement applied.');
  left = (await backup(page)).product.artwork.find((art: Saved) => art.part === 'sleeveLeft');
  expect(left.yCm).toBeGreaterThanOrEqual(0);

  // A sleeve placement that would cross a seam is refused, with where it fits.
  await page.locator('#artwork-x').fill('30');
  await page.locator('#apply-artwork').click();
  await expect(page.locator('#message')).toContainText('Artwork on the left sleeve must lie within the sleeve, clear of its seams');
  await editor(page).locator('#discard-product-drafts').click();
  await expect(page.locator('#artwork-x')).toHaveValue(String(left.xCm));

  // Described text runs down the right sleeve.
  await page.getByLabel('Describe a style', { exact: false }).first().fill('black tee with "TEAM" down the right sleeve');
  await page.getByRole('button', { name: 'Apply to the garment', exact: true }).click();
  await expect(page.locator('#describe-result')).toContainText('Artwork: text “TEAM” on the right sleeve, running down it');
  const right = (await backup(page)).product.artwork.find((art: Saved) => art.part === 'sleeveRight');
  expect(right).toMatchObject({ rotation: 90 });
  expect(right.widthCm).toBeGreaterThan(8);
  expect(await glbNodes(page)).toEqual(expect.arrayContaining(['Left sleeve artwork', 'Right sleeve artwork']));

  // Made sleeveless, the top loses its sleeves' artwork, and the sleeves are no longer offered for it.
  await editor(page).getByRole('button', { name: 'Sleeveless sleeve, 0 cm', exact: true }).click();
  await expect(page.locator('#message')).toContainText('The artwork on the sleeves went with them');
  expect((await backup(page)).product.artwork.filter((art: Saved) => art.part.startsWith('sleeve'))).toEqual([]);
  await expect(side).toHaveValue('front');
  await expect(side.locator('option[value="sleeveLeft"]')).toHaveJSProperty('disabled', true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(side.locator('option[value="sleeveLeft"]')).toHaveJSProperty('disabled', false);
  expect((await backup(page)).product.artwork.map((art: Saved) => art.part).sort()).toEqual(['sleeveLeft', 'sleeveRight']);
});
