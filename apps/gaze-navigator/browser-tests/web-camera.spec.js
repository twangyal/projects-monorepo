import { test, expect } from '@playwright/test';

const evidence = new WeakMap();

// A controllable WebGazer stand-in. Assigning undefined (a fresh load) creates a new instance.
function installFakeCamera() {
  const record = window.__camera = { instances: [], faceVisible: true, released: 0 };
  function create() {
    let listener = null;
    let samples = [];
    const api = {
      params: {}, started: false,
      setGazeListener(callback) { listener = callback; return api; },
      clearGazeListener() { listener = null; return api; },
      begin: async () => { api.started = true; return api; },
      saveDataAcrossSessions(value) { api.saved = value; return api; },
      showPredictionPoints() { return api; },
      removeMouseEventListeners() { api.mouseTraining = false; return api; },
      end() { record.released++; api.started = false; return api; },
      stopVideo() { return api; },
      getRegression: () => [{ init() { samples = []; }, getData: () => samples }],
      recordScreenPosition(x, y) { if (record.faceVisible) samples.push([x, y]); },
      emit(point) { listener?.(point, 0); },
      get samples() { return samples.length; },
    };
    record.instances.push(api);
    return api;
  }
  let current = create();
  Object.defineProperty(window, 'webgazer', {
    configurable: true,
    get: () => current,
    set: value => { current = value === undefined ? create() : value; },
  });
}

test.beforeEach(async ({ page }) => {
  const state = { external: [], errors: [] };
  evidence.set(page, state);
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:4173') {
      state.external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.addInitScript(installFakeCamera);
  await page.clock.install({ time: new Date('2026-10-12T00:00:00Z') });
});
test.afterEach(async ({ page }) => {
  expect(evidence.get(page).external, 'the fake camera means no CDN or model downloads').toEqual([]);
  expect(evidence.get(page).errors, 'page must not throw').toEqual([]);
});

const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');
const dot = page => page.locator('#gaze-web-navigator .calibration-dot');

let minute = 1;
async function open(page, path) {
  await page.goto(path);
  await page.clock.pauseAt(new Date(Date.UTC(2026, 9, 12, 0, minute++)));
}

const openSettings = page => panel(page).locator('details.settings').evaluate(details => { details.open = true; });

async function startCamera(page) {
  await openSettings(page);
  await panel(page).getByRole('button', { name: 'Camera' }).click();
  await expect(panel(page).getByRole('button', { name: 'Camera' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dot(page)).toHaveClass(/settling/);
  await expect(status(page)).toContainText('Look at dot 1 of 9');
}

async function finishCalibration(page) {
  await page.clock.runFor(9 * 1900 + 100);
  await expect(status(page)).toHaveText('Calibrated with 9 of 9 dots. The circle now follows your gaze.');
  await expect(dot(page)).toHaveClass(/hidden/);
}

// Emits steady gaze at an element's center long enough for smoothing to settle there.
async function gazeAt(page, locator) {
  await locator.evaluate(element => {
    const top = element.getBoundingClientRect().top + window.scrollY - Math.min(140, window.innerHeight * 0.2);
    window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  });
  const box = await locator.boundingBox();
  for (let i = 0; i < 12; i++) {
    await page.evaluate(([x, y]) => window.webgazer.emit({ x, y }), [box.x + box.width / 2, box.y + box.height / 2]);
    await page.clock.runFor(33);
  }
  await page.clock.runFor(150);
}

async function typeInstruction(page, text) {
  await panel(page).getByLabel('Typed instruction').fill(text);
  await panel(page).getByRole('button', { name: 'Do it' }).click();
}

test('hands-free calibration needs no clicks, then camera gaze selects the context', async ({ page }) => {
  await open(page, '/practice-site/catalog.html');
  await startCamera(page);
  const api = await page.evaluate(() => ({ saved: window.webgazer.saved, mouse: window.webgazer.mouseTraining }));
  expect(api).toEqual({ saved: false, mouse: false });
  await page.clock.runFor(800);
  expect(await page.evaluate(() => window.webgazer.samples), 'no samples during the settle period').toBe(0);
  await finishCalibration(page);
  expect(await page.evaluate(() => window.webgazer.samples)).toBe(36);
  // The real pointer no longer moves the circle in camera mode.
  await page.mouse.move(5, 5);
  await gazeAt(page, page.getByLabel('Sort by'));
  await expect(panel(page).locator('.context li').first()).toHaveText(/Dropdown: Sort by/);
  await typeInstruction(page, 'choose title');
  await expect(page.getByLabel('Sort by')).toHaveValue('Title');
});

test('camera mode continues after navigation with a fresh calibration, and stop camera releases it', async ({ page }) => {
  await open(page, '/practice-site/index.html');
  await startCamera(page);
  await finishCalibration(page);
  await gazeAt(page, page.getByRole('link', { name: 'Contact', exact: true }));
  await typeInstruction(page, 'open contact');
  await page.waitForURL('**/contact.html');
  await page.clock.pauseAt(new Date(Date.UTC(2026, 9, 12, 0, minute++)));
  // The new page recalibrates automatically; its clock may have run briefly before pausing.
  await expect(dot(page)).toHaveClass(/settling|sampling/);
  await expect(status(page)).toContainText(/Look at dot \d of 9/);
  await finishCalibration(page);
  await typeInstruction(page, 'stop camera');
  await expect(status(page)).toHaveText('Camera off. The circle follows the pointer.');
  expect(await page.evaluate(() => window.__camera.released)).toBe(1);
  await openSettings(page);
  await expect(panel(page).getByRole('button', { name: 'Pointer' })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page).getByRole('button', { name: 'Recalibrate' })).toBeDisabled();
});

test('calibration retries hidden-face dots, reports failure, and spoken cancel stops a rerun', async ({ page }) => {
  await open(page, '/practice-site/account.html');
  await page.evaluate(() => { window.__camera.faceVisible = false; });
  await startCamera(page);
  await page.clock.runFor(1950);
  await expect(status(page)).toContainText('Dot 1 of 9 needs another look');
  await page.clock.runFor(9 * 2 * 1900);
  await expect(status(page)).toContainText('Only 0 of 9 dots could be learned');
  await page.evaluate(() => { window.__camera.faceVisible = true; });
  await openSettings(page);
  await panel(page).getByRole('button', { name: 'Recalibrate' }).click();
  await expect(status(page)).toContainText('Look at dot 1 of 9');
  await typeInstruction(page, 'cancel');
  await expect(status(page)).toHaveText('Calibration stopped. Say recalibrate to try again, or use pointer.');
  await expect(dot(page)).toHaveClass(/hidden/);
});
