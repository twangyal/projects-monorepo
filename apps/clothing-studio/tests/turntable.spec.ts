import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function download(page: Page, name: string) {
  const pending = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name, exact: true }).click();
  const file = await pending;
  return { name: file.suggestedFilename(), bytes: await readFile((await file.path())!) };
}

test('a design exports as a turntable video that circles the garment once', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: /^Use the Ringer tee template/ }).click();
  await page.getByRole('button', { name: 'Exports', exact: true }).click();
  const started = Date.now();
  const video = await download(page, 'Export turntable video (WebM) ↓');
  // Recorded in real time: one six-second turn.
  expect(Date.now() - started).toBeGreaterThan(5500);
  expect(video.name).toMatch(/-turntable\.webm$/);
  expect(video.bytes.subarray(0, 4).toString('hex')).toBe('1a45dfa3');
  expect(video.bytes.length).toBeGreaterThan(20000);
  // The view returns to where it was, and the button is ready again.
  await expect(page.getByRole('button', { name: 'Export turntable video (WebM) ↓', exact: true })).toBeEnabled();
});
