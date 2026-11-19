import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';
async function download(page: Page, id: string) {
  const pending = page.waitForEvent('download'); await page.locator(id).click(); return readFile((await (await pending).path())!);
}
const backup = async (page: Page) => JSON.parse((await download(page, '#backup')).toString());
function unpack(bytes: Buffer) {
  const files = new Map<string, string>(); let at = 0;
  while (bytes.readUInt32LE(at) === 0x04034b50) {
    const size = bytes.readUInt32LE(at + 18), nameLength = bytes.readUInt16LE(at + 26), extra = bytes.readUInt16LE(at + 28), start = at + 30 + nameLength + extra;
    files.set(bytes.subarray(at + 30, at + 30 + nameLength).toString(), bytes.subarray(start, start + size).toString()); at = start + size;
  }
  return files;
}
for (const width of [1280, 390]) test(`front pocket bag cuts follow grain, grades and pocket removal without new saved parts at ${width}px`, async ({ page }) => {
  test.setTimeout(90000); await page.setViewportSize({ width, height: 900 }); await page.goto('/');
  await page.locator('#product-editor').getByRole('button', { name: /^Use the Jeans template/ }).click();
  const inner = page.locator('#product-pieces [data-pattern-key="pocketBagInner"]'), outer = page.locator('#product-pieces [data-pattern-key="pocketBagOuter"]');
  await expect(inner).toHaveAccessibleName(/Front pocket bag \(inner\).*Cotton twill pocketing/); await expect(outer).toBeVisible();
  await expect(inner.locator('polygon')).toHaveAttribute('fill', '#e9dfcb');
  expect(await inner.evaluate(node => getComputedStyle(node).cursor)).toBe('default');
  await page.locator('#part-list input[value="frontPocket"]').check();
  await page.getByLabel('Fabric grain angle (°)', { exact: true }).fill('45'); await page.getByLabel('Fabric grain angle (°)', { exact: true }).press('Tab');
  await expect(inner.locator('[data-grain]')).toHaveAttribute('data-angle', '45'); await expect(outer.locator('[data-grain]')).toHaveAttribute('data-angle', '45');
  await page.getByRole('combobox', { name: 'Wear with', exact: true }).selectOption({ label: 'Blank tee' });
  const before = await backup(page);
  expect(Object.keys(before.product.parts)).not.toContain('pocketBagInner'); expect(Object.keys(before.product.parts)).not.toContain('pocketBagOuter');
  const referencesResolve = await page.locator('#product-pieces svg').evaluate(svg => {
    const ids = Array.from(svg.querySelectorAll('[id]'), node => node.id);
    const references = svg.outerHTML.matchAll(/url\(#([^)]*)\)/g);
    return ids.length === new Set(ids).size && [...references].every(match => ids.includes(match[1]));
  });
  expect(referencesResolve).toBe(true);
  const previewLabelsSeparate = await page.locator('#product-pieces svg').evaluate(svg => {
    const boxes = [...svg.querySelectorAll<SVGTextElement>('[data-pattern-key] > text')].map(text => {
      const b = text.getBBox(), m = (text.parentElement as unknown as SVGGElement).transform.baseVal.consolidate()!.matrix;
      return { x: b.x + m.e, y: b.y, w: b.width, h: b.height };
    });
    return boxes.every((a, i) => boxes.slice(i + 1).every(b => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y));
  });
  expect(previewLabelsSeparate).toBe(true);

  await page.getByRole('combobox', { name: 'Pattern export size', exact: true }).selectOption('L');
  for (const id of ['#pattern-svg', '#pattern-dxf', '#pattern-a4', '#pattern-letter']) {
    const text = (await download(page, id)).toString(); expect(text).toContain('Front pocket bag (inner)'); expect(text).toContain('Front pocket bag (outer)');
    expect(text).toContain('Cotton twill pocketing'); expect(text).toContain('grain 45'); expect(text).toContain('size L'); expect(text).not.toMatch(/NaN|Infinity/);
    if (id === '#pattern-svg') {
      const fits = await page.evaluate(text => {
        const svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
        svg.setAttribute('style', 'position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none'); document.body.append(svg);
        try {
          return [...svg.querySelectorAll<SVGGElement>('g[data-piece^="pocketBag"]')].every(group => {
            const cut = group.querySelector<SVGPolygonElement>('polygon')!.getBBox();
            return [...group.querySelectorAll<SVGTextElement>(':scope > text')].every(label => {
              const box = label.getBBox(); return box.width > 0 && box.x >= cut.x && box.x + box.width <= cut.x + cut.width;
            });
          });
        } finally { svg.remove(); }
      }, text);
      expect(fits).toBe(true);
    }
  }
  await page.getByRole('combobox', { name: 'Outfit export size', exact: true }).selectOption('S');
  const files = unpack(await download(page, '#outfit-bundle')), manifest = JSON.parse(files.get('manifest.json')!), garment = manifest.garments[0];
  expect(garment.exportSize).toBe('S'); expect(files.get(garment.files.svg)).toContain('data-piece="pocketBagInner"'); expect(files.get(garment.files.dxf)).toContain('Front pocket bag (outer)');
  expect(files.get(garment.files.html)).toContain('2 inner + 2 outer'); expect(await backup(page)).toEqual(before);
  await page.locator('#product-front-pockets').uncheck(); await expect(inner).toHaveCount(0); await expect(outer).toHaveCount(0);
  await page.locator('#undo').click(); await expect(inner).toBeVisible(); await expect(outer).toBeVisible();
  await expect(page.locator('#save-state')).toContainText('Locally saved'); await page.reload(); await expect(inner).toBeVisible(); expect((await backup(page)).product).toEqual(before.product);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
