import { test, expect } from '@playwright/test';

for (const width of [1440, 390]) test(`saved-version comparison explains body and worn-piece edits at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/tests/storage-harness.html');
  await expect.poll(() => page.evaluate(() => !!window.clothingStorage)).toBe(true);
  const current = await page.evaluate(async () => {
    const saved = { ...window.clothingStorage.createProject(), product: window.clothingStorage.template('hoodie'), wornWith: window.clothingStorage.template('blank'), wornAlso: window.clothingStorage.template('trousers'), topBody: { chest: 100, waist: null, hip: null, chestDepth: null, torsoLength: 42 } };
    await window.clothingDesignLibrary.saveDesign('Before fitting', saved);
    const current = structuredClone(saved); current.topBody.torsoLength = 45; current.wornAlso.parts.front.color = '#1f2a4f';
    await window.clothingStorage.saveProject(current);
    return current;
  });
  await page.goto('/'); await expect(page.locator('#save-state')).toHaveText('Locally saved');
  await page.getByRole('button', { name: 'Saved designs', exact: true }).click();
  await page.locator('#design-library-select').selectOption({ label: await page.locator('#design-library-select option').nth(1).textContent() ?? '' });
  await page.getByRole('button', { name: 'Compare with current', exact: true }).click();
  await expect(page.locator('#design-library-status')).toContainText('2 changes');
  const changes = page.getByRole('list', { name: 'Changes from the saved design to the current one' });
  await expect(changes.getByRole('listitem')).toHaveText(['Body shoulder to waist: 42 cm → 45 cm', /^And with · Front legs: .+ → .+, navy$/]);
  expect(await page.getByRole('dialog', { name: 'Saved designs', exact: true }).evaluate(d => d.scrollWidth <= d.clientWidth)).toBe(true);
  await page.goto('/tests/storage-harness.html'); await expect.poll(() => page.evaluate(() => !!window.clothingStorage)).toBe(true);
  expect(await page.evaluate(() => window.clothingStorage.loadProject())).toEqual(current);
  const saved = await page.evaluate(async () => window.clothingDesignLibrary.readDesign((await window.clothingDesignLibrary.listDesigns())[0]));
  expect(saved.topBody?.torsoLength).toBe(42); expect(saved.wornAlso?.parts.front.color).not.toBe('#1f2a4f');
});
