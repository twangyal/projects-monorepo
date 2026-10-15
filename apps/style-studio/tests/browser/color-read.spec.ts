import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from './expanded-workspace.ts';

/** A 360×480 photo of a simple garment silhouette on a backdrop, drawn natively and encoded as PNG. */
async function garmentPhoto(page: Page, backdrop: string, garment: string, shape: 'top' | 'bottom' | 'shoes'): Promise<Buffer> {
  const data = await page.evaluate(({ backdrop, garment, shape }) => {
    const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 480;
    const context = canvas.getContext('2d')!;
    context.fillStyle = backdrop; context.fillRect(0, 0, 360, 480);
    context.fillStyle = garment;
    if (shape === 'top') { context.fillRect(100, 90, 160, 280); context.fillRect(40, 90, 280, 90); }
    else if (shape === 'bottom') { context.fillRect(110, 60, 140, 70); context.fillRect(110, 120, 60, 320); context.fillRect(190, 120, 60, 320); }
    else { context.beginPath(); context.ellipse(120, 300, 70, 35, 0, 0, Math.PI * 2); context.ellipse(250, 300, 70, 35, 0, 0, Math.PI * 2); context.fill(); }
    return canvas.toDataURL('image/png').split(',')[1];
  }, { backdrop, garment, shape });
  return Buffer.from(data, 'base64');
}

async function addPhotographedPiece(page: Page, name: string, category: 'top' | 'bottom' | 'shoes', photo: Buffer, expected: { palette: string; color: RegExp }) {
  const form = page.locator('#piece-form');
  await form.locator('[name="name"]').fill(name);
  await form.locator('[name="category"]').selectOption(category);
  await form.locator('[name="palette"]').selectOption(expected.palette === 'bright' ? 'neutral' : 'bright');
  await form.locator('input[type="file"]').setInputFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: photo });
  const read = page.locator('#piece-color-read');
  await expect(read).toContainText(`Suggested palette: ${expected.palette[0].toUpperCase()}${expected.palette.slice(1)}.`);
  await expect(read.locator('.swatches')).toContainText(expected.color);
  // The suggestion never changes the tag by itself.
  await expect(form.locator('[name="palette"]')).not.toHaveValue(expected.palette);
  await read.getByRole('button', { name: /^Use suggested palette/ }).click();
  await expect(form.locator('[name="palette"]')).toHaveValue(expected.palette);
  await form.getByRole('button', { name: 'Add wardrobe piece', exact: true }).click();
  await expect(page.locator('#wardrobe-list')).toContainText(name);
  await expect(read).toBeHidden();
}

test('photo colors suggest palette tags on request and explain how a chosen outfit’s colors relate', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#piece-form [name="name"]')).toBeEnabled();
  await addPhotographedPiece(page, 'Navy overshirt', 'top', await garmentPhoto(page, '#ffffff', '#1f2a4f', 'top'), { palette: 'cool', color: /navy \d+%/ });
  await addPhotographedPiece(page, 'Tan chinos', 'bottom', await garmentPhoto(page, '#f4f2ee', '#b58b5a', 'bottom'), { palette: 'warm', color: /tan \d+%/ });
  await addPhotographedPiece(page, 'Black loafers', 'shoes', await garmentPhoto(page, '#ffffff', '#1c1c1c', 'shoes'), { palette: 'neutral', color: /black \d+%/ });

  // An undetectable garment says so instead of guessing.
  await page.locator('#piece-form input[type="file"]').setInputFiles({ name: 'white.png', mimeType: 'image/png', buffer: await garmentPhoto(page, '#ffffff', '#fbfbfb', 'top') });
  await expect(page.locator('#piece-color-read')).toContainText('could not be separated from its background');
  await page.locator('#remove-piece-photo').click();

  const compose = page.locator('#compose-form');
  await compose.locator('[name="top"]').selectOption({ label: 'Navy overshirt' });
  await compose.locator('[name="bottom"]').selectOption({ label: 'Tan chinos' });
  await compose.locator('[name="shoes"]').selectOption({ label: 'Black loafers' });
  await page.locator('#compose-assess').click();
  const notes = page.locator('#compose-colors');
  await expect(notes).toContainText('Navy overshirt (navy) and Tan chinos (tan): strong light–dark contrast; complementary hues.');
  await expect(notes).toContainText('Navy overshirt (navy) and Black loafers (black): similar lightness (tonal); a neutral anchors the pair.');
  await expect(notes).toContainText('fixed color rules');

  // Only the explicitly applied tags were saved; the profile format is unchanged.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export profile', exact: true }).click();
  const exported = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(exported.pieces.map((piece: { name: string; tags: { palette: string } }) => [piece.name, piece.tags.palette]))
    .toEqual([['Navy overshirt', 'cool'], ['Tan chinos', 'warm'], ['Black loafers', 'neutral']]);
  expect(Object.keys(exported.pieces[0]).sort()).toEqual(['category', 'id', 'name', 'photoId', 'tags']);
});

test('the color panel fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#piece-form [name="name"]')).toBeEnabled();
  await page.locator('#piece-form input[type="file"]').setInputFiles({ name: 'navy.png', mimeType: 'image/png', buffer: await garmentPhoto(page, '#ffffff', '#1f2a4f', 'top') });
  await expect(page.locator('#piece-color-read')).toContainText('Suggested palette: Cool.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
