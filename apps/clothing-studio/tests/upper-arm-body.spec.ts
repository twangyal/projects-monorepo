import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const field = (page: Page) => page.getByLabel('Upper-arm girth (cm, optional)', { exact: true });
async function setup(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await page.getByRole('button', { name: 'Body & drape', exact: true }).click(); await page.locator('#top-body-shape summary').click();
}
async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
for (const width of [1280, 390]) test(`entered upper-arm girth survives refusal, history, profiles and outfit switching at ${width}px`, async ({ page }) => {
  test.setTimeout(90000); await page.setViewportSize({ width, height: 900 }); await setup(page); await expect(field(page)).toBeVisible();
  const before = await backup(page); await field(page).fill('14.5'); await page.getByRole('button', { name: 'Apply body settings', exact: true }).click();
  await expect(page.locator('#message')).toContainText('15 to 65'); await expect(field(page)).toHaveValue('14.5'); expect(await backup(page)).toEqual(before);
  await field(page).fill('40'); await page.getByRole('button', { name: 'Apply body settings', exact: true }).click(); expect((await backup(page)).topBody.upperArmGirth).toBe(40);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(field(page)).toHaveValue(''); expect(await backup(page)).toEqual(before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(field(page)).toHaveValue('40');
  await page.getByText('Saved body profiles', { exact: true }).click(); await page.getByLabel('Body profile name', { exact: true }).fill('Measured arms');
  await page.getByRole('button', { name: 'Save body as new profile', exact: true }).click(); await expect(page.locator('#body-profile-status')).toContainText('saved');
  const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download body profiles', exact: true }).click();
  const profiles = JSON.parse(await readFile((await (await wait).path())!, 'utf8')); expect(profiles.profiles[0].body.upperArmGirth).toBe(40);
  await field(page).fill('44'); await page.getByRole('button', { name: 'Apply body settings', exact: true }).click();
  await page.getByRole('button', { name: 'Use selected body profile', exact: true }).click(); await expect(field(page)).toHaveValue('40'); await expect(page.locator('#body-profile-preview')).toContainText('40 upper-arm girth');
  await expect(page.locator('#save-state')).toHaveText('Locally saved'); await page.reload(); await page.getByRole('button', { name: 'Body & drape', exact: true }).click();
  await expect(field(page)).toHaveValue('40'); expect((await backup(page)).topBody.upperArmGirth).toBe(40);
  await page.getByRole('combobox', { name: 'Wear with', exact: true }).selectOption({ label: 'Straight trousers' });
  await page.getByRole('button', { name: 'Edit worn garment', exact: true }).click(); await expect(field(page)).toHaveValue('40'); expect((await backup(page)).topBody.upperArmGirth).toBe(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the real worker uses measured arm circumference for a top and an outfit', async ({ page }) => {
  test.setTimeout(150000); await page.addInitScript(() => {
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options); this.addEventListener('message', event => {
          if (event.data.kind === 'result' && event.data.result?.body?.upperArmGirth) (window as unknown as { armBodies: unknown[] }).armBodies.push(event.data.result.body);
        });
      }
    }; (window as unknown as { armBodies: unknown[] }).armBodies = [];
  });
  await setup(page); await field(page).fill('40'); await page.getByRole('button', { name: 'Apply body settings', exact: true }).click();
  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  await expect(page.locator('#garment-drape-status')).toContainText('40 cm upper-arm girth', { timeout: 120000 });
  const radii = () => page.evaluate(() => (window as unknown as { armBodies: { capsules: { limb?: boolean; a: number[]; radius: number }[] }[] }).armBodies.map(body => body.capsules.find(c => c.limb && c.a[0] !== 0)!.radius));
  expect((await radii())[0] * 2 * Math.PI).toBeCloseTo(40, 10);
  await page.getByRole('combobox', { name: 'Wear with', exact: true }).selectOption({ label: 'Straight trousers' });
  await expect(page.locator('#garment-drape-status')).toContainText('Worn over the Straight trousers', { timeout: 120000 });
  await expect.poll(async () => (await radii()).length, { timeout: 120000 }).toBeGreaterThanOrEqual(2);
  for (const radius of await radii()) expect(radius * 2 * Math.PI).toBeCloseTo(40, 10);
});
