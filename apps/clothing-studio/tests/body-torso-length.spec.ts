import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const torso = (page: Page) => page.getByLabel('Shoulder to waist (vertical cm, optional)', { exact: true });
const apply = (page: Page) => page.getByRole('button', { name: 'Apply body settings', exact: true }).click();
async function setup(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await page.getByRole('button', { name: 'Body & drape', exact: true }).click(); await page.locator('#top-body-shape summary').click();
}
async function backup(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export project backup', exact: true }).click();
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
}
for (const width of [1280, 390]) test(`torso drafts, profiles, backups and history keep an independent waist level at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await setup(page);
  const before = await backup(page);
  await page.getByLabel('Body height (cm, optional)', { exact: true }).fill('175');
  await torso(page).fill('42');
  expect((await backup(page)).topBody, 'typing is still a draft').toEqual(before.topBody);
  await page.getByRole('button', { name: 'Materials & prints', exact: true }).click();
  await page.getByRole('button', { name: 'Body & drape', exact: true }).click(); await expect(torso(page)).toHaveValue('42');
  await apply(page);
  const applied = await backup(page); expect(applied.topBody).toMatchObject({ height: 175, torsoLength: 42 }); expect(applied.product).toEqual(before.product);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(torso(page)).toHaveValue('');
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(torso(page)).toHaveValue('42');
  await page.getByLabel('Body height (cm, optional)', { exact: true }).fill('210'); await torso(page).fill('25'); await apply(page);
  await expect(page.locator('#message')).toContainText('below the armpit'); await expect(torso(page)).toHaveValue('25');
  expect((await backup(page)).topBody).toEqual(applied.topBody);
  await page.locator('#discard-product-drafts').click(); await expect(torso(page)).toHaveValue('42');
  await page.getByText('Saved body profiles', { exact: true }).click(); await page.getByLabel('Body profile name', { exact: true }).fill('Torso');
  await page.getByRole('button', { name: 'Save body as new profile', exact: true }).click();
  await expect(page.locator('#body-profile-preview')).toContainText('42 shoulder to waist');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download body profiles', exact: true }).click();
  expect(JSON.parse(await readFile((await (await download).path())!, 'utf8')).profiles[0].body.torsoLength).toBe(42);
  await torso(page).fill('48'); await apply(page); await page.getByRole('button', { name: 'Use selected body profile', exact: true }).click();
  await expect(torso(page)).toHaveValue('42');
  await expect(page.locator('#save-state')).toHaveText('Locally saved'); await page.reload();
  await page.getByRole('button', { name: 'Body & drape', exact: true }).click(); await expect(torso(page)).toHaveValue('42');
  await page.getByRole('combobox', { name: 'Wear with', exact: true }).selectOption({ label: 'Straight trousers' });
  await page.getByRole('button', { name: 'Edit worn garment', exact: true }).click(); await expect(torso(page)).toHaveValue('42');
  expect((await backup(page)).topBody.torsoLength).toBe(42);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the real graded drape worker receives torso length and matched fabric receipts keep it', async ({ page }) => {
  test.setTimeout(150000);
  await page.addInitScript(() => {
    const Native = Worker;
    window.Worker = class extends Native {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        if (String(args[0]).includes('garment-drape.worker')) this.addEventListener('message', event => {
          if (event.data.kind === 'result') Object.assign(window, { torsoWorkerBody: event.data.result.body });
        });
      }
    };
  });
  await setup(page); await page.getByLabel('Body height (cm, optional)', { exact: true }).fill('175'); await torso(page).fill('44'); await apply(page);
  await page.getByRole('combobox', { name: 'Size shown', exact: true }).selectOption('L');
  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  await expect(page.locator('#garment-drape-status')).toContainText('44 cm shoulder to waist', { timeout: 60000 });
  expect(await page.evaluate(() => (window as unknown as { torsoWorkerBody: { torsoLength: number } }).torsoWorkerBody.torsoLength)).toBe(44);
  await page.getByText('Compare fabrics on this garment', { exact: true }).click();
  await page.getByRole('button', { name: 'Compare garment fabrics', exact: true }).click();
  await expect(page.locator('#garment-comparison-status')).toContainText('44 cm shoulder to waist', { timeout: 60000 });
  const download = page.waitForEvent('download'); await page.locator('#garment-comparison-download').click();
  const receipt = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(receipt.body.torsoLength).toBe(44);
  expect(receipt.candidates.map((candidate: { result: { body: { torsoLength: number } } }) => candidate.result.body.torsoLength)).toEqual([44, 44]);
});


for (const measurement of ['underbust', 'depth']) test(`applying a torso on solo bottoms preserves the hidden ${measurement} through draping and returning to a top`, async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await setup(page);
  await page.getByLabel('Body chest girth (cm)', { exact: true }).fill('110');
  const input = page.locator(measurement === 'underbust' ? '#garment-drape-underbust' : '#garment-drape-depth');
  await input.fill(measurement === 'underbust' ? '78' : '25'); await apply(page);
  const initialBody = (await backup(page)).topBody;
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: /^Use the Straight trousers template/ }).click();
  await page.getByRole('button', { name: 'Body & drape', exact: true }).click();
  await expect(input).toBeHidden();
  if (!(await torso(page).isVisible())) await page.locator('#top-body-shape summary').click();
  // Starting a drape without drafts must also keep the cached, hidden measurements.
  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  await torso(page).fill(measurement === 'underbust' ? '24' : '30'); await apply(page);
  const expected = { ...initialBody, torsoLength: measurement === 'underbust' ? 24 : 30 };
  expect((await backup(page)).topBody).toEqual(expected);
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await page.getByRole('button', { name: 'Body & drape', exact: true }).click();
  await expect(input).toHaveValue(measurement === 'underbust' ? '78' : '25');
  expect((await backup(page)).topBody).toEqual(expected);
});
