import { test, expect, type Page } from './helpers/expanded-workspace.ts';

const editor = (page: Page) => page.locator('#product-editor');
const status = (page: Page) => editor(page).locator('#garment-drape-status');
async function shot(page: Page, name: string) {
  if (process.env.DRAPE_SHOTS) await editor(page).locator('#product-canvas').screenshot({ path: `${process.env.DRAPE_SHOTS}/${name}.png` });
}
const pixels = (page: Page) => editor(page).locator('#product-canvas').evaluate(node => (node as HTMLCanvasElement).toDataURL('image/png'));

test('drape on a body: a top settles on a body, keeps its drape when recoloured and drapes again when reshaped', async ({ page }) => {
  test.setTimeout(180000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Ringer tee template/ }).click();
  await expect(status(page)).toContainText('styling shell');
  const chest = editor(page).getByLabel('Body chest girth (cm)', { exact: true });
  await expect(chest).toHaveValue('94');
  await shot(page, 'shell');
  const shell = await pixels(page);

  await editor(page).getByRole('button', { name: 'Drape on a body', exact: true }).click();
  await expect(status(page)).toContainText('Draped on a body with a 94 cm chest: 10 cm of ease at the chest', { timeout: 90000 });
  await expect(status(page)).not.toContainText('still settling');
  await expect.poll(() => pixels(page)).not.toBe(shell);
  await shot(page, 'draped-front');
  await editor(page).getByRole('button', { name: 'Left', exact: true }).click();
  await shot(page, 'draped-left');

  // Recolouring keeps the drape; the design is saved as usual and the drape is not part of it.
  await editor(page).locator('#part-color').fill('#2d6a4f');
  await expect(status(page)).toContainText('Draped on a body with a 94 cm chest');

  // A bigger garment drapes again on the same body.
  await editor(page).getByLabel('Chest (cm)', { exact: true }).fill('112');
  await editor(page).getByRole('button', { name: 'Apply measurements', exact: true }).click();
  await expect(status(page)).toContainText('Draped on a body with a 94 cm chest: 18 cm of ease at the chest', { timeout: 90000 });

  // An impossible body is refused; back to the styling shell.
  await chest.fill('200');
  await editor(page).getByRole('button', { name: 'Drape again', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Body chest must be from 70 to 140 cm');
  await editor(page).getByRole('button', { name: 'Show styling shell', exact: true }).click();
  await expect(status(page)).toContainText('styling shell');
  await expect(editor(page).getByRole('button', { name: 'Show styling shell', exact: true })).toBeHidden();
});

test('drape on a body: a hoodie hangs from the shoulders with its hood, and trousers hang from a gathered waistband', async ({ page }) => {
  test.setTimeout(180000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Pullover hoodie template/ }).click();
  await editor(page).getByRole('button', { name: 'Drape on a body', exact: true }).click();
  await expect(status(page)).toContainText('Draped on a body with a 102 cm chest', { timeout: 90000 });
  await shot(page, 'hoodie-front');
  await editor(page).getByRole('button', { name: 'Back', exact: true }).click();
  await shot(page, 'hoodie-back');

  await editor(page).getByRole('button', { name: /^Use the Straight trousers template/ }).click();
  await expect(status(page)).toContainText(/Draped on a body with a 76 cm waist and \d+ cm hip, the elastic waistband gathered onto the waist, with 6 cm of hip ease/, { timeout: 90000 });
  await expect(editor(page).getByLabel('Body chest girth (cm)')).toBeHidden();
  await expect(editor(page).getByLabel('Body waist girth (cm, optional)')).toHaveAttribute('placeholder', 'Auto: 76');
  await shot(page, 'trousers-front');
});

test('an entered body height says where the hem and trouser legs end, and is saved with the design', async ({ page }) => {
  test.setTimeout(180000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Straight trousers template/ }).click();
  await editor(page).locator('#top-body-shape').evaluate(node => { (node as HTMLDetailsElement).open = true; });
  await editor(page).getByLabel('Body height (cm, optional)', { exact: true }).fill('158');
  await editor(page).getByRole('button', { name: 'Apply body settings', exact: true }).click();
  await editor(page).getByRole('button', { name: 'Drape on a body', exact: true }).click();
  await expect(status(page)).toContainText(/On this 158 cm body the hems would reach \d+ cm below the floor, too long for this body\./, { timeout: 90000 });
  await editor(page).getByLabel('Body height (cm, optional)', { exact: true }).fill('190');
  await editor(page).getByRole('button', { name: 'Apply body settings', exact: true }).click();
  await editor(page).getByRole('button', { name: 'Drape again', exact: true }).click();
  await expect(status(page)).toContainText(/On this 190 cm body the hems end \d+ cm above the floor\./, { timeout: 90000 });
  await page.reload();
  await editor(page).locator('#top-body-shape').evaluate(node => { (node as HTMLDetailsElement).open = true; });
  await expect(editor(page).getByLabel('Body height (cm, optional)', { exact: true })).toHaveValue('190');
});
