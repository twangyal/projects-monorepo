import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
async function download(page: Page, name: string) {
  const wait = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click();
  return (await readFile((await (await wait).path())!)).toString();
}
const points = (text: string) => text.trim().split(/\s+/).map(pair => { const [x, y] = pair.split(',').map(Number); return { x, y }; });

test('measured geometry: edited neckline changes downloaded rib and tech pack; flared chest arrow meets sewing seams', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  const editor = page.locator('#product-editor');
  await editor.getByRole('button', { name: /^Use the Ringer tee template/ }).click();
  await editor.locator('#fit-panel summary').click();
  let lastRib = 0;
  for (const width of [12, 28]) {
    await editor.getByLabel('Neck width (cm)', { exact: true }).fill(String(width));
    await editor.getByRole('button', { name: 'Apply fit', exact: true }).click();
    await expect(page.locator('#message')).toContainText('Fit applied');
    const neck = await editor.locator('[data-piece="neckband"] polygon').getAttribute('points');
    const span = (ps: { x: number }[]) => Math.max(...ps.map(p => p.x)) - Math.min(...ps.map(p => p.x));
    const rib = span(points(neck!)); expect(rib).toBeGreaterThan(lastRib); lastRib = rib;
    await expect(editor.locator('#techpack-preview')).toContainText(`${rib.toFixed(1)} cm long (15% shorter`);
    const svg = await download(page, 'Download printable pattern (SVG, 1:1) ↓');
    const group = /<g data-piece="neckband">([\s\S]*?)<\/g>/.exec(svg)![1];
    const sewing = [...group.matchAll(/<polygon points="([^"]+)"/g)][1][1];
    expect(span(points(sewing))).toBeCloseTo(rib, 1);
  }
  await editor.getByLabel('Chest (cm)', { exact: true }).fill('150');
  await editor.getByLabel('Body length (cm)', { exact: true }).fill('55');
  await editor.getByRole('button', { name: 'Apply measurements', exact: true }).click();
  await editor.getByLabel('Hem width (½) (cm)', { exact: true }).fill('95');
  await editor.getByRole('button', { name: 'Apply fit', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Fit applied');
  const row = editor.locator('#techpack-preview tr').filter({ has: page.locator('td:first-child:text-is("A")') });
  await expect(row.locator('td').nth(6)).toHaveText('80');
  const svg = editor.locator('#techpack-preview svg'), arrow = svg.locator('line').first();
  const y = Number(await arrow.getAttribute('y1'));
  const outline = points((await svg.locator('polygon').first().getAttribute('points'))!);
  const xs = outline.flatMap((a, i) => { const b = outline[(i + 1) % outline.length]; return (a.y <= y && b.y > y) || (b.y <= y && a.y > y) ? [a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y)] : []; });
  const shift = Number(/translate\(([^ ]+) 0\)/.exec((await arrow.locator('..').getAttribute('transform'))!)![1]);
  expect(Number(await arrow.getAttribute('x1')) + shift).toBeCloseTo(Math.min(...xs), 2);
  expect(Number(await arrow.getAttribute('x2')) + shift).toBeCloseTo(Math.max(...xs), 2);
  await expect(page.locator('#save-state')).toHaveText('Locally saved');
  await page.reload();
  await expect(page.locator('#product-editor #techpack-preview tr').filter({ has: page.locator('td:first-child:text-is("A")') }).locator('td').nth(6)).toHaveText('80');
});
