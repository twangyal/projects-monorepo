import { test, expect } from '@playwright/test';

// A WebGazer stand-in whose face tracker reports where a head pointing at (x, y) would put the face's landmarks: the
// nose tip moves from between the eyes as the head turns. WebGazer's own gaze estimate stays empty (no eye training).
function installFakeHeadCamera() {
  let listener = null, positions = null;
  const record = window.__head = { eyeSamples: 0 };
  const face = (x, y) => {
    const list = Array.from({ length: 468 }, () => [320, 240, 0]);
    list[33] = [300, 240, 0]; list[263] = [340, 240, 0];
    list[1] = [320 + 40 * (x - innerWidth / 2) / 1600, 240 + 40 * (0.5 + (y - innerHeight / 2) / 1600), 0];
    return list;
  };
  const api = {
    params: {},
    setGazeListener(callback) { listener = callback; return api; },
    clearGazeListener() { listener = null; return api; },
    begin: async () => api, saveDataAcrossSessions() { return api; }, showPredictionPoints() { return api; }, removeMouseEventListeners() { return api; },
    end() { return api; }, stopVideo() { return api; },
    getRegression: () => [{ init() {}, getData: () => [], setData() {} }],
    recordScreenPosition() { record.eyeSamples++; },
    getTracker: () => ({ getPositions: () => positions }),
    // One camera frame with the head pointing at (x, y).
    point(x, y) { positions = face(x, y); listener?.(null, 0); },
  };
  Object.defineProperty(window, 'webgazer', { configurable: true, get: () => api, set: () => {} });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => (new URL(route.request().url()).origin === 'http://127.0.0.1:4173' ? route.continue() : route.abort()));
  await page.addInitScript(installFakeHeadCamera);
  await page.clock.install({ time: new Date('2026-11-03T00:00:00Z') });
});

const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');
const dot = page => page.locator('#gaze-web-navigator .calibration-dot');

// Points the head at each calibration and accuracy-check dot while it shows, about 30 frames a second.
async function followDots(page) {
  for (;;) {
    const [hidden, x, y] = await dot(page).evaluate(element => [element.classList.contains('hidden'), parseFloat(element.style.left), parseFloat(element.style.top)]);
    if (hidden) break;
    await page.evaluate(([x, y]) => window.webgazer.point(x, y), [x, y]);
    await page.clock.runFor(33);
  }
}

test('the head pointer calibrates by pointing the nose at each dot, then the circle follows the head', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/practice-site/catalog.html');
  await page.clock.pauseAt(new Date('2026-11-03T00:01:00Z'));
  await panel(page).locator('details.settings').evaluate(details => { details.open = true; });
  await panel(page).getByRole('button', { name: 'Head', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Head', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page).getByRole('button', { name: 'Camera', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(status(page)).toContainText('Point your nose at dot 1 of 9');
  await followDots(page);
  // Pointing exactly at every dot: the check finds the head pointer close, so the circle is small.
  await expect(status(page)).toHaveText(/^Calibrated with 9 of 9 dots\. The head pointer lands within about \d+ px of where you point, so the circle is small \(60 px\)\. The circle now follows your head\.$/);
  expect(await page.evaluate(() => window.__head.eyeSamples), 'the eye model is not trained').toBe(0);
  // Pointing the head at the sort control puts it in the circle, and speech acts on it.
  // (On small screens the panel covers the lower part of the page, so the control is brought near the top first.)
  const sort = page.getByLabel('Sort by');
  await sort.evaluate(element => window.scrollTo({ top: Math.max(0, element.getBoundingClientRect().top + window.scrollY - Math.min(140, window.innerHeight * 0.2)), behavior: 'instant' }));
  const box = await sort.boundingBox();
  for (let i = 0; i < 15; i++) { await page.evaluate(([x, y]) => window.webgazer.point(x, y), [box.x + box.width / 2, box.y + box.height / 2]); await page.clock.runFor(33); }
  await expect(panel(page).locator('.context li').first()).toHaveText(/Dropdown: Sort by/);
  await panel(page).getByLabel('Typed instruction').fill('choose title');
  await panel(page).getByRole('button', { name: 'Do it', exact: true }).click();
  await expect(sort).toHaveValue('Title');
  // Back to the eyes: their own calibration starts.
  await panel(page).getByLabel('Typed instruction').fill('use eye tracking');
  await panel(page).getByRole('button', { name: 'Do it', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Camera', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(status(page)).toContainText('Look at dot 1 of 9');
  expect(errors).toEqual([]);
});
