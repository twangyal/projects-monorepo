import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function download(page: Page, name: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  const file = await pending;
  return { name: file.suggestedFilename(), text: await readFile((await file.path())!, 'utf8') };
}
async function backup(page: Page) { return JSON.parse((await download(page, 'Export project backup')).text); }

for (const width of [1280, 390]) for (const paper of ['A4', 'US Letter']) test(`${paper} product tiles print the chosen grade without editing the sample at ${width}px`, async ({ page, context }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  const initial = await backup(page);
  await page.locator('#product-editor').getByRole('button', { name: /^Use the Oxford shirt template/ }).click();
  const before = await backup(page);
  await page.getByRole('combobox', { name: 'Pattern export size', exact: true }).selectOption('L');
  await page.getByRole('combobox', { name: 'Size shown', exact: true }).selectOption('XL');
  await expect(page.getByRole('button', { name: `Download ${paper} tiled pattern (HTML) ↓`, exact: true })).toBeVisible();
  const file = await download(page, `Download ${paper} tiled pattern (HTML) ↓`);
  expect(file.name).toMatch(/-size-L-pattern-(a4|letter)-tiles\.html$/);
  expect(file.text).toContain('size L');
  expect(file.text).toContain('data-fold="collar"');
  expect(file.text).not.toMatch(/<script|<image|foreignObject/);
  expect(await backup(page)).toEqual(before);
  const printed = await context.newPage();
  let requests = 0;
  await printed.route('**/*', route => { requests++; return route.abort(); });
  await printed.setContent(file.text);
  await printed.emulateMedia({ media: 'print' });
  await expect(printed.locator('.sheet').first()).toContainText('Red dash-dot: fold');
  const pages = await printed.locator('.sheet').count();
  expect(pages).toBeGreaterThan(7);
  const square = await printed.locator('.sheet').first().locator('rect').evaluate(node => {
    const element = node as SVGGraphicsElement, bounds = element.getBBox(), matrix = element.getScreenCTM()!;
    return [bounds.width * matrix.a, bounds.height * matrix.d];
  });
  for (const side of square) expect(side).toBeCloseTo(50 * 96 / 25.4, 2);
  const pdf = (await printed.pdf({ preferCSSPageSize: true, printBackground: true })).toString('latin1');
  expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(pages);
  const boxes = [...pdf.matchAll(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/g)];
  expect(boxes).toHaveLength(pages);
  for (const box of boxes) {
    expect(Math.abs(Number(box[1]) - (paper === 'A4' ? 210 : 215.9) * 72 / 25.4)).toBeLessThan(.5);
    expect(Math.abs(Number(box[2]) - (paper === 'A4' ? 297 : 279.4) * 72 / 25.4)).toBeLessThan(.5);
  }
  expect(requests).toBe(0);
  await printed.close();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await backup(page)).toEqual(initial);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect(await backup(page)).toEqual(before);
});

test('tiled product downloads refuse unapplied drafts and unsupported grades without changing raw input', async ({ page }) => {
  await page.setViewportSize({ width:390, height:900 });
  await page.goto('/');
  const before = await backup(page), files: string[] = [];
  page.on('download', file => files.push(file.suggestedFilename()));
  const chest = page.getByLabel('Chest (cm)', { exact:true });
  await chest.fill('119');
  await page.getByRole('button', { name:'Download A4 tiled pattern (HTML) ↓', exact:true }).click();
  await expect(page.locator('#message')).toContainText('Apply or discard pending product edits');
  await expect(chest).toHaveValue('119');
  expect(files).toEqual([]);
  await page.getByRole('button', { name:'Discard all product drafts', exact:true }).click();
  await chest.fill('146');
  await page.getByRole('button', { name:'Apply measurements', exact:true }).click();
  await page.getByRole('combobox', { name:'Pattern export size', exact:true }).selectOption('XL');
  await page.getByRole('button', { name:'Download US Letter tiled pattern (HTML) ↓', exact:true }).click();
  await expect(page.locator('#message')).toContainText('Size XL would be outside');
  expect(files).toEqual([]);
  await page.getByRole('button', { name:'Undo', exact:true }).click();
  expect(await backup(page)).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
