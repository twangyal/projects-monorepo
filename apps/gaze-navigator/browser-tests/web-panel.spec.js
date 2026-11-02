import { test, expect } from '@playwright/test';
const panel = page => page.locator('#gaze-web-navigator section');
async function say(page, text) { await panel(page).getByLabel('Typed instruction').fill(text); await panel(page).getByRole('button', { name: 'Do it', exact: true }).click(); }

test('the panel moves to a chosen corner and hides to its answers by voice, and both survive a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/practice-site/contact.html');
  await page.mouse.move(500, 300);
  await say(page, 'move the navigator to the top left');
  await expect(panel(page).locator('.status')).toHaveText('Navigator panel moved to the top left. It stays there until you say "place the navigator automatically".');
  await expect.poll(async () => { const box = await panel(page).boundingBox(); return [box.x, box.y]; }).toEqual([12, 12]);
  await say(page, 'hide the navigator');
  const status = panel(page).locator('.status');
  await expect(status).toBeVisible();
  await expect(status).toContainText('Navigator panel hidden.');
  await expect(panel(page).locator('form.typed')).toBeHidden();
  await expect(panel(page).getByRole('button', { name: 'Show', exact: true })).toHaveAttribute('aria-expanded', 'false');
  const hidden = await panel(page).boundingBox();
  expect(hidden.height).toBeLessThan(160);
  expect(hidden.width).toBeLessThanOrEqual(300);
  await page.reload();
  await expect(panel(page).locator('.status')).toBeVisible();
  await expect(panel(page).locator('form.typed')).toBeHidden();
  await expect.poll(async () => { const box = await panel(page).boundingBox(); return [box.x, box.y]; }).toEqual([12, 12]);
  // The Show button brings the whole panel back; letting it place itself forgets the chosen corner.
  await panel(page).getByRole('button', { name: 'Show', exact: true }).click();
  await expect(panel(page).locator('form.typed')).toBeVisible();
  await say(page, 'place the navigator automatically');
  await expect(panel(page).locator('.status')).toContainText('move itself out of the way');
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('gaze-web-navigator') ?? '{}').corner)).toBeUndefined();
});
