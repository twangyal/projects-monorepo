import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';
async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }

for (const width of [1280, 390]) test(`both outfit copies remain editable and recoverable at ${width}px`, async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width, height: 900 }); await page.goto('/');
  const swap = page.getByRole('button', { name: 'Edit worn garment', exact: true }); await expect(swap).toBeVisible(); await expect(swap).toBeDisabled();
  await page.locator('#product-editor').getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await page.getByRole('combobox', { name: 'Wear with', exact: true }).selectOption({ label: 'Straight trousers' });
  const original = await backup(page);
  await page.getByLabel('Body chest girth (cm)', { exact: true }).fill('100'); await page.getByRole('button', { name: 'Apply body settings', exact: true }).click();
  const applied = await backup(page);
  await page.getByRole('combobox', { name: 'Size shown', exact: true }).selectOption('L'); await page.getByRole('combobox', { name: 'Pattern export size', exact: true }).selectOption('XL');
  // An unapplied draft is kept, and no history/project mutation occurs.
  await page.locator('#product-chest').fill('115'); await swap.click(); await expect(page.locator('#message')).toContainText('Apply or discard');
  await expect(page.locator('#product-chest')).toHaveValue('115'); expect(await backup(page)).toEqual(applied);
  await page.getByRole('button', { name: 'Discard all product drafts', exact: true }).click(); await swap.click();
  const switched = await backup(page); expect(switched.product).toEqual(applied.wornWith); expect(switched.wornWith).toEqual(applied.product); expect(switched.topBody).toEqual(applied.topBody);
  await expect(page.getByRole('combobox', { name: 'Size shown', exact: true })).toHaveValue('M'); await expect(page.getByRole('combobox', { name: 'Pattern export size', exact: true })).toHaveValue('M');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(await backup(page)).toEqual(applied);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(await backup(page)).toEqual(switched);
  await page.locator('#part-color').fill('#bb3344'); await page.locator('#part-color').dispatchEvent('change'); const styledBottom = await backup(page);
  expect(styledBottom.product.parts.front.color).toBe('#bb3344'); expect(styledBottom.wornWith).toEqual(applied.product);
  await swap.click(); const back = await backup(page); expect(back.product).toEqual(applied.product); expect(back.wornWith).toEqual(styledBottom.product);
  await page.locator('#part-color').fill('#2244aa'); await page.locator('#part-color').dispatchEvent('change'); const styledBoth = await backup(page);
  expect(styledBoth.product.parts.front.color).toBe('#2244aa'); expect(styledBoth.wornWith).toEqual(styledBottom.product); expect(styledBoth.topBody).toEqual(applied.topBody);
  expect(original.product).toEqual(applied.product); await expect(page.locator('#save-state')).toHaveText('Locally saved'); await page.reload(); expect(await backup(page)).toEqual(styledBoth);
  await swap.click(); const reopened = await backup(page); expect(reopened.product).toEqual(styledBottom.product); expect(reopened.wornWith).toEqual(styledBoth.product);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test('switching during an outfit drape uses the new sample and exports both kept garments', async ({ page }) => {
  test.setTimeout(150000); await page.goto('/');
  await page.locator('#product-editor').getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await page.getByRole('combobox', { name: 'Wear with', exact: true }).selectOption({ label: 'Flared skirt' });
  const design = await backup(page);
  design.product.spec = { styleNumber: 'TOP', season: 'Summer', sampleSize: 'L' };
  design.wornWith.spec = { styleNumber: 'SKIRT', season: 'Summer', sampleSize: 'S' };
  design.topBody = { chest: 100, waist: 76, hip: 100, chestDepth: 24, height: 178, hipDepth: 20 };
  await page.getByLabel('Import project backup', { exact: true }).setInputFiles({ name: 'two-samples.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(design)) });
  await expect(page.getByRole('combobox', { name: 'Size shown', exact: true })).toHaveValue('L');
  await page.getByRole('combobox', { name: 'Size shown', exact: true }).selectOption('XL');
  await page.getByRole('combobox', { name: 'Pattern export size', exact: true }).selectOption('XS');
  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  await page.getByRole('button', { name: 'Edit worn garment', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Size shown', exact: true })).toHaveValue('S');
  await expect(page.getByRole('combobox', { name: 'Pattern export size', exact: true })).toHaveValue('S');
  await expect(page.locator('#garment-drape-status')).toContainText('Worn under the Blank tee', { timeout: 120000 });
  const switched = await backup(page); expect(switched.product).toEqual(design.wornWith); expect(switched.wornWith).toEqual(design.product); expect(switched.topBody).toEqual(design.topBody);
  await page.getByLabel('Include worn garment in PNG, GLB and video', { exact: true }).check();
  const wait = page.waitForEvent('download'); await page.locator('#product-glb').click(); const result = await wait;
  expect(result.suggestedFilename()).toMatch(/-outfit\.glb$/);
  const bytes = await readFile((await result.path())!); const size = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + size).toString());
  expect(json.nodes.some((n: { name?: string }) => n.name?.startsWith('Blank tee: '))).toBe(true);
  expect(json.nodes.some((n: { name?: string }) => n.name === 'Body')).toBe(false);
  expect(await backup(page)).toEqual(switched);
});

test('replacing an outfit companion keeps a compatible edited third garment', async ({ page }) => {
  await page.goto('/');
  await page.locator('#product-editor').getByRole('button', { name: /^Use the Blank tee template/ }).click();
  const wear = page.getByRole('combobox', { name: 'Wear with', exact: true });
  const also = page.getByRole('combobox', { name: 'And with', exact: true });
  await wear.selectOption({ label: 'Straight trousers' });
  await also.selectOption({ label: 'Crew sweatshirt' });
  const edited = await backup(page); edited.wornAlso.name = 'My outer layer'; edited.wornAlso.parts.front.color = '#2244aa';
  await page.getByLabel('Import project backup', { exact: true }).setInputFiles({ name: 'kept-layer.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(edited)) });
  await expect(also.locator('option:checked')).toContainText('My outer layer');
  await wear.selectOption({ label: 'Flared skirt' });
  const replaced = await backup(page);
  expect(replaced.wornWith.base).toBe('skirt');
  expect(replaced.wornAlso).toEqual(edited.wornAlso);
  await expect(also.locator('option:checked')).toContainText('My outer layer');

  page.once('dialog', async dialog => { expect(dialog.message()).toContain('My outer layer'); await dialog.dismiss(); });
  await wear.selectOption({ label: 'Pullover hoodie' });
  expect(await backup(page)).toEqual(replaced);
  await expect(wear.locator('option:checked')).toContainText('Flared skirt');
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('My outer layer'); await dialog.accept(); });
  await wear.selectOption({ label: 'Pullover hoodie' });
  const accepted = await backup(page);
  expect(accepted.wornWith.base).toBe('hoodie'); expect(accepted.wornAlso).toBeUndefined();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await backup(page)).toEqual(replaced);
});

test('tucking follows compatible bottoms and clears when changing to two tops', async ({ page }) => {
  await page.goto('/');
  await page.locator('#product-editor').getByRole('button', { name: /^Use the Blank tee template/ }).click();
  const wear = page.getByRole('combobox', { name: 'Wear with', exact: true });
  const tuck = page.getByRole('checkbox', { name: 'Tuck the top in', exact: true });
  await wear.selectOption({ label: 'Straight trousers' }); await tuck.check();
  await wear.selectOption({ label: 'Flared skirt' });
  await expect(tuck).toBeChecked(); expect((await backup(page)).tucked).toBe(true);
  await wear.selectOption({ label: 'Pullover hoodie' });
  await expect(tuck).toBeDisabled(); expect((await backup(page)).tucked).toBeUndefined();
  await wear.selectOption({ label: 'Straight trousers' }); await expect(tuck).not.toBeChecked();
});

for (const method of ['template', 'description']) test(`changing the primary by ${method} asks before removing an incompatible outfit piece`, async ({page}) => {
  await page.goto('/');
  const editor = page.locator('#product-editor');
  const wear = page.getByRole('combobox', { name: 'Wear with', exact: true });
  const also = page.getByRole('combobox', { name: 'And with', exact: true });
  await editor.getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await wear.selectOption({ label: 'Straight trousers' });
  await also.selectOption({ label: 'Crew sweatshirt' });
  const before = await backup(page);
  const prompt = editor.getByLabel('Describe a style',{exact:true});
  const choose = method === 'template' ? editor.getByRole('button', { name: /^Use the Flared skirt template/ })
    : editor.getByRole('button', { name: 'Apply to the garment', exact: true });
  if (method === 'description') {
    await prompt.fill('navy flared skirt');
    await editor.locator('#product-length').fill('72');
    await choose.click();
    await expect(page.locator('#message')).toContainText('Apply or discard pending product edits');
    await expect(editor.locator('#product-length')).toHaveValue('72');
    expect(await backup(page)).toEqual(before);
    await editor.getByRole('button', { name: 'Discard all product drafts', exact: true }).click();
  }
  const confirm = async (accept: boolean) => {
    const waiting = page.waitForEvent('dialog');
    const click = choose.click();
    const dialog = await waiting;
    const message = dialog.message();
    if (accept) await dialog.accept(); else await dialog.dismiss();
    await click;
    expect(message).toContain(before.wornWith.name);
    expect(message).not.toContain(before.wornAlso.name);
  };
  await confirm(false);
  expect(await backup(page)).toEqual(before);
  if (method === 'description') {
    await expect(prompt).toHaveValue('navy flared skirt');
    await expect(editor.locator('#describe-result')).toHaveText('');
  }
  await confirm(true);
  const changed = await backup(page);
  expect(changed.product.base).toBe('skirt');
  expect(changed.wornWith).toEqual(before.wornAlso);
  expect(changed.wornAlso).toBeUndefined();
  await expect(wear.locator('option:checked')).toContainText(before.wornAlso.name);
  await page.getByRole('button', {name:'Undo',exact:true}).click();
  expect(await backup(page)).toEqual(before);
});
