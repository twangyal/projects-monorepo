import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { estimateBody, measureFront, measureSide } from '../src/body-photo.ts';
import { figure, runsOf, type Figure } from './helpers/body-figure.ts';

// A stand-in for the pose model: each photo size gets a drawn outline (front, side, or arms against the body).
const front = figure('front'), side = figure('side', { width: 280 }), touching = figure('front', { width: 320, armsTouching: true });
const frontMeasure = measureFront(front, 180);
const expected = estimateBody(frontMeasure, measureSide(side, 180, frontMeasure.levels), 180);
const frontOnly = estimateBody(frontMeasure, null, 180);

async function setup(page: Page): Promise<string[]> {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.addInitScript((masks: { width: number; height: number; runs: number[] }[]) => {
    (globalThis as unknown as { clothingPoseDetector: unknown }).clothingPoseDetector = {
      outline(canvas: HTMLCanvasElement) {
        const mask = masks.find(m => m.width === canvas.width && m.height === canvas.height);
        if (!mask) throw new Error('No person was found in the photo.');
        const data = new Uint8Array(mask.width * mask.height);
        for (let i = 0; i < mask.runs.length; i += 3) for (let x = mask.runs[i + 1]!; x <= mask.runs[i + 2]!; x++) data[mask.runs[i]! * mask.width + x] = 1;
        return { width: mask.width, height: mask.height, data };
      },
    };
  }, [front, side, touching].map((mask: Figure) => ({ width: mask.width, height: mask.height, runs: runsOf(mask) })));
  await page.goto('/');
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await page.getByRole('button', { name: 'Body & drape', exact: true }).click();
  await page.locator('#body-photos summary').click();
  return requests;
}
/** A plain PNG photo of this size, made in the page. */
async function photo(page: Page, width: number, height: number): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const url = await page.evaluate(([w, h]) => { const c = document.createElement('canvas'); c.width = w!; c.height = h!; const g = c.getContext('2d')!; g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, w!, h!); return c.toDataURL('image/png'); }, [width, height]);
  return { name: `photo-${width}.png`, mimeType: 'image/png', buffer: Buffer.from(url.split(',')[1]!, 'base64') };
}
/** The estimates table's row for one measurement. */
const row = (page: Page, name: string) => page.locator('#body-photo-rows tr').filter({ has: page.getByRole('rowheader', { name, exact: true }) });
async function backup(page: Page) {
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export project backup', exact: true }).click();
  return JSON.parse(await readFile((await (await wait).path())!, 'utf8'));
}

for (const width of [1280, 390]) test(`a front and a side photo estimate the body, shown on the photos, and fill its measurements to apply at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const requests = await setup(page);
  await page.getByLabel('Your height (cm)', { exact: true }).fill('180');
  await page.getByLabel('Front photo', { exact: true }).setInputFiles(await photo(page, 300, 500));
  await page.getByLabel('Side photo (optional)', { exact: true }).setInputFiles(await photo(page, 280, 500));
  await page.getByRole('button', { name: 'Estimate measurements', exact: true }).click();
  await expect(page.locator('#body-photo-status')).toContainText('Estimated from the front and side photos');
  await expect(page.locator('#body-photo-front-view')).toBeVisible();
  await expect(page.locator('#body-photo-side-view')).toBeVisible();
  const rows = page.locator('#body-photo-rows');
  for (const [name, value] of [['Chest (or bust)', expected.chest], ['Waist', expected.waist], ['Hip', expected.hip], ['Upper arm', expected.upperArmGirth], ['Chest depth', expected.chestDepth], ['Waist to hip', expected.hipDepth], ['Height', 180]] as const) {
    await expect(row(page, name).locator('td').first()).toHaveText(String(value));
  }
  await expect(rows).toContainText('front width and side depth');
  await expect(page.locator('#body-photos')).toContainText('BodyM test A');
  // The estimates become drafts in the body fields, to correct and then apply.
  await page.getByRole('button', { name: 'Put these in the body measurements', exact: true }).click();
  await expect(page.locator('#top-body-shape')).toHaveAttribute('open', '');
  await expect(page.locator('#garment-drape-chest')).toHaveValue(String(expected.chest));
  await expect(page.locator('#garment-drape-waist')).toHaveValue(String(expected.waist));
  await expect(page.locator('#garment-drape-depth')).toHaveValue(String(expected.chestDepth));
  await expect(page.locator('#product-draft-state')).toContainText('Unapplied');
  await page.getByRole('button', { name: 'Apply body settings', exact: true }).click();
  expect((await backup(page)).topBody).toEqual({ chest: expected.chest, waist: expected.waist, hip: expected.hip, chestDepth: expected.chestDepth, height: 180, hipDepth: expected.hipDepth, upperArmGirth: expected.upperArmGirth });
  // Nothing was downloaded or sent: the stand-in detector answered.
  expect(requests.filter(url => !url.startsWith('http://127.0.0.1') && !url.startsWith('blob:') && !url.startsWith('data:'))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a photo that cannot be measured says why and still shows its outline; a front photo alone estimates from its widths', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Front photo', { exact: true }).setInputFiles(await photo(page, 320, 500));
  await page.getByRole('button', { name: 'Estimate measurements', exact: true }).click();
  await expect(page.locator('#body-photo-status')).toContainText('Enter your height');
  await page.getByLabel('Your height (cm)', { exact: true }).fill('180');
  await page.getByRole('button', { name: 'Estimate measurements', exact: true }).click();
  await expect(page.locator('#body-photo-status')).toContainText('arms a little away from your sides');
  await expect(page.locator('#body-photo-front-view')).toBeVisible();
  await expect(page.locator('#body-photo-result')).toBeHidden();
  // The front photo alone: girths from its widths, chest depth assumed.
  await page.getByLabel('Front photo', { exact: true }).setInputFiles(await photo(page, 300, 500));
  await page.getByRole('button', { name: 'Estimate measurements', exact: true }).click();
  await expect(page.locator('#body-photo-status')).toContainText('Estimated from the front photo.');
  await expect(page.locator('#body-photo-side-view')).toBeHidden();
  await expect(page.locator('#body-photo-rows')).toContainText('front width alone');
  await expect(row(page, 'Chest depth')).toContainText('Assumed');
  // With an underbust entered, the bust sets the chest depth, so that one is left blank.
  await page.locator('#top-body-shape summary').click();
  await page.getByLabel('Underbust girth (cm, optional)', { exact: true }).fill('80');
  await page.getByRole('button', { name: 'Put these in the body measurements', exact: true }).click();
  await expect(page.locator('#body-photo-status')).toContainText('Chest depth was left blank');
  await expect(page.locator('#garment-drape-chest')).toHaveValue(String(frontOnly.chest));
  await expect(page.locator('#garment-drape-depth')).toHaveValue('');
});
