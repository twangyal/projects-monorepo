import { test, expect, type Page } from './helpers/expanded-workspace.ts';

const editor = (page: Page) => page.locator('#product-editor');

test('a fabric drape test reports its coefficient and shadow, follows the part fabric and keeps results', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Ringer tee template/ }).click();
  const result = editor(page).locator('#drape-test-result'), shadow = editor(page).locator('#drape-test-shadow');
  const run = editor(page).getByRole('button', { name: 'Test this fabric’s drape', exact: true });
  await expect(shadow).toBeHidden();
  await run.click();
  await expect(result).toContainText('drape coefficient', { timeout: 60000 });
  await expect(result).toContainText('Drape testers typically measure');
  await expect(shadow).toBeVisible();
  const coefficient = async () => Number(/coefficient (\d\.\d\d)/.exec(await result.textContent() ?? '')![1]);
  const soft = await coefficient();
  // Another fabric shows nothing until tested; denim drapes stiffer than the knit.
  const fabric = editor(page).locator('#part-material');
  const knit = await fabric.inputValue();
  await fabric.selectOption('denim-340');
  await expect(result).toHaveText('');
  await expect(shadow).toBeHidden();
  await run.click();
  await expect(result).toContainText('Denim twill', { timeout: 60000 });
  expect(await coefficient()).toBeGreaterThan(soft);
  // Results are kept for the session: the first fabric's test shows again at once.
  await fabric.selectOption(knit);
  await run.click();
  await expect(result).toContainText(`coefficient ${soft.toFixed(2)}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
