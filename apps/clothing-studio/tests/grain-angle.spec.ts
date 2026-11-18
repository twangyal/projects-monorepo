import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';
async function download(page: Page, id: string) {
  const wait = page.waitForEvent('download'); await page.locator(id).click();
  return readFile((await (await wait).path())!);
}
async function backup(page: Page) { return JSON.parse((await download(page, '#backup')).toString()); }
function unpack(bytes: Buffer) {
  const files = new Map<string, string>(); let at = 0;
  while (bytes.readUInt32LE(at) === 0x04034b50) {
    const size = bytes.readUInt32LE(at + 18), names = bytes.readUInt16LE(at + 26), extra = bytes.readUInt16LE(at + 28), start = at + 30 + names + extra;
    files.set(bytes.subarray(at + 30, at + 30 + names).toString(), bytes.subarray(start, start + size).toString()); at = start + size;
  }
  return files;
}
for (const width of [1280, 390]) test(`part grain survives Undo, colourways and reload and reaches cutting exports at ${width}px`, async ({ page }) => {
  test.setTimeout(90000); await page.setViewportSize({ width, height: 900 }); await page.goto('/');
  await page.locator('#product-editor').getByRole('button', { name: /^Use the Oxford shirt template/ }).click();
  const grain = page.getByLabel('Fabric grain angle (°)', { exact: true });
  await expect(grain).toHaveValue('0'); const before = await backup(page);
  await grain.fill('45'); await grain.press('Tab');
  await expect(page.locator('#message')).toContainText('fabric grain updated');
  await expect(page.locator('#product-pieces [data-grain="front"]')).toHaveAttribute('data-angle', '45');
  let applied = await backup(page); expect(applied.product.parts.front.grainAngle).toBe(45);
  expect(applied.product.parts.front.print).toEqual(before.product.parts.front.print);
  expect(applied.product.measurements).toEqual(before.product.measurements);
  await page.locator('#undo').click(); await expect(grain).toHaveValue('0');
  await page.locator('#redo').click(); await expect(grain).toHaveValue('45');
  await page.locator('#part-list').getByRole('radio', { name: 'Back body', exact: true }).check(); await expect(grain).toHaveValue('0');
  await grain.fill('-45'); await grain.press('Tab');
  await page.locator('#colorway-name').fill('Bias pair'); await page.locator('#save-colorway').click();
  await page.getByRole('combobox', { name: 'Wear with', exact: true }).selectOption({ label: 'Straight trousers' });
  applied = await backup(page);
  expect(applied.product.colorways[0].parts.front.grainAngle).toBe(45);
  expect(applied.product.colorways[0].parts.back.grainAngle).toBe(-45);
  expect(applied.wornWith.parts.front.grainAngle).toBeUndefined();
  for (const id of ['#pattern-svg', '#pattern-dxf', '#pattern-a4', '#pattern-letter']) {
    const text = (await download(page, id)).toString(); expect(text).toContain('grain 45'); expect(text).toContain('grain -45'); expect(text).not.toMatch(/NaN|Infinity/);
  }
  const files = unpack(await download(page, '#outfit-bundle')), manifest = JSON.parse(files.get('manifest.json')!);
  expect(manifest.garments[0].grainAngles.front).toBe(45); expect(manifest.garments[0].grainAngles.back).toBe(-45);
  expect(manifest.garments[1].grainAngles.front).toBe(0);
  const pack = files.get(manifest.garments[0].files.html)!;
  expect(pack).toContain('grain 45°'); expect(pack).toContain('data-grain="front" data-angle="45"');
  expect(await backup(page)).toEqual(applied);
  await expect(page.locator('#save-state')).toContainText('Locally saved'); await page.reload();
  await page.locator('#part-list').getByRole('radio', { name: 'Front body', exact: true }).check(); await expect(grain).toHaveValue('45');
  expect((await backup(page)).product).toEqual(applied.product);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('invalid grain input preserves its raw value and leaves the applied design and Undo history alone', async ({ page }) => {
  await page.goto('/'); await page.locator('#product-editor').getByRole('button', { name: /^Use the Oxford shirt template/ }).click();
  const grain = page.getByLabel('Fabric grain angle (°)', { exact: true });
  await grain.fill('30'); await grain.press('Tab'); const before = await backup(page);
  for (const value of ['', '-91', '91']) {
    await grain.fill(value); await grain.press('Tab');
    await expect(page.locator('#message')).toContainText('grain angle'); await expect(grain).toHaveValue(value);
    expect(await backup(page)).toEqual(before);
  }
  await page.locator('#undo').click(); await expect(grain).toHaveValue('0');
});

test('narrow-piece preview grain markers are clipped to the actual sewing outline', async ({ page }) => {
  await page.goto('/'); await page.locator('#product-editor').getByRole('button', { name: /^Use the Jeans template/ }).click();
  await page.locator('#part-list input[value="yoke"]').check();
  const grain = page.getByLabel('Fabric grain angle (°)', { exact: true }); await grain.fill('-30'); await grain.press('Tab');
  const arrow = page.locator('#product-pieces [data-grain="yoke"]');
  await expect(arrow).toHaveAttribute('clip-path', 'url(#preview-grain-yoke)');
  const contained = await arrow.evaluate(line => {
    const svg = (line as SVGLineElement).ownerSVGElement!, clip = svg.querySelector('#preview-grain-yoke polygon') as SVGPolygonElement;
    const outline = line.closest('[data-piece]')!.querySelector('polygon')! as SVGPolygonElement;
    return clip.points.length === outline.points.length && Array.from({ length: clip.points.length }, (_, i) => {
      const a = clip.points.getItem(i), b = outline.points.getItem(i); return Math.hypot(a.x - b.x, a.y - b.y) < 0.01;
    }).every(Boolean);
  });
  expect(contained).toBe(true);
});
