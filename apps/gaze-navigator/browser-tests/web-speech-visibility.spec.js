import { test, expect } from '@playwright/test';

test('hiding the tab aborts captured speech and listening must be restarted', async ({ page }) => {
  await page.addInitScript(() => {
    window.recognizers = [];
    window.SpeechRecognition = class {
      constructor() { window.recognizers.push(this); }
      start() { this.onstart?.(); }
      abort() { this.aborted = true; this.onend?.(); }
    };
    window.setTabHidden = hidden => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    window.finishCatalogCommand = finish => finish?.({
      resultIndex: 0, results: [Object.assign([{ transcript: 'open catalog' }], { isFinal: true })],
    });
  });
  await page.goto('/practice-site/index.html');
  const panel = page.locator('#gaze-web-navigator section');
  const start = panel.getByRole('button', { name: 'Start listening', exact: true });
  await start.click();
  const catalog = page.getByRole('link', { name: 'Catalog', exact: true });
  await catalog.evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const box = await catalog.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel.locator('.context')).toContainText('Link: Catalog');

  await page.evaluate(() => {
    const recognition = window.recognizers.at(-1);
    recognition.onspeechstart?.();
    const late = recognition.onresult;
    window.setTabHidden(true);
    window.finishCatalogCommand(late);
  });
  await expect(start).toBeVisible();
  expect(await page.evaluate(() => window.recognizers.at(-1).aborted)).toBe(true);
  await expect(page).toHaveURL(/index\.html$/);

  await page.evaluate(() => window.setTabHidden(false));
  await expect(start).toBeVisible();
  await start.click();
  await page.evaluate(() => {
    const recognition = window.recognizers.at(-1);
    recognition.onspeechstart?.();
    window.finishCatalogCommand(recognition.onresult);
  });
  await page.waitForURL('**/practice-site/catalog.html');
});
