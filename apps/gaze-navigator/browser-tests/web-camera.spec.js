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

// Calibration, then the accuracy check's four dots with no gaze to measure: the circle keeps its size.
async function finishCalibration(page, circle = 'medium (90 px)') {
  await page.clock.runFor(9 * 1900 + 100);
  await expect(status(page)).toHaveText('Calibrated with 9 of 9 dots. Checking accuracy: look at dot 1 of 4.');
  await expect(dot(page)).toHaveClass(/checking/);
  await page.clock.runFor(4 * 2000);
  await expect(status(page)).toHaveText(`Calibrated with 9 of 9 dots. The accuracy check saw too little gaze to measure, so the circle stays ${circle}. The circle now follows your gaze.`);
  await expect(dot(page)).toHaveClass(/hidden/);
}

// Steady gaze `offset` px to the right of each accuracy-check dot, at about 30 samples a second.
async function lookNearCheckDots(page, offset) {
  for (;;) {
    const [shown, x, y] = await dot(page).evaluate(element => [element.classList.contains('checking'), parseFloat(element.style.left), parseFloat(element.style.top)]);
    if (!shown) break;
    await page.evaluate(([x, y]) => window.webgazer.emit({ x, y }), [x + offset, y]);
    await page.clock.runFor(33);
  }
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

test('after calibration, an accuracy check sizes the circle to where the gaze lands', async ({ page }) => {
  await open(page, '/practice-site/catalog.html');
  await startCamera(page);
  await page.clock.runFor(9 * 1900 + 100);
  await expect(status(page)).toHaveText('Calibrated with 9 of 9 dots. Checking accuracy: look at dot 1 of 4.');
  await lookNearCheckDots(page, 50);
  await expect(status(page)).toHaveText('Calibrated with 9 of 9 dots. Your gaze lands within about 50 px of where you look, so the circle is small (60 px). The circle now follows your gaze.');
  await expect(panel(page).getByLabel('Circle size')).toHaveValue('small');
  // A poor calibration takes the largest circle and says how to improve it.
  await typeInstruction(page, 'recalibrate');
  await page.clock.runFor(9 * 1900 + 100);
  await lookNearCheckDots(page, 200);
  await expect(status(page)).toHaveText('Calibrated with 9 of 9 dots. Your gaze lands up to about 200 px from where you look, more than the large circle (130 px) covers. Check lighting and keep your head still, then say recalibrate, or use pointer.');
  await expect(panel(page).getByLabel('Circle size')).toHaveValue('large');
  // Cancel during the check keeps the calibration and the circle.
  await typeInstruction(page, 'recalibrate');
  await page.clock.runFor(9 * 1900 + 100);
  await typeInstruction(page, 'cancel');
  await expect(status(page)).toHaveText('Calibrated with 9 of 9 dots. Accuracy check stopped, so the circle stays large (130 px). The circle now follows your gaze.');
  await expect(dot(page)).toHaveClass(/hidden/);
});

test('a control named inside the circle and used becomes one more calibration sample', async ({ page }) => {
  await open(page, '/practice-site/catalog.html');
  await startCamera(page);
  await finishCalibration(page);
  const learned = () => page.evaluate(() => { const data = window.webgazer.getRegression()[0].getData(); return { count: data.length, last: data.at(-1) }; });
  expect((await learned()).count).toBe(36);
  const add = page.getByRole('button', { name: 'Add to cart' }).first();
  await gazeAt(page, add);
  await typeInstruction(page, 'click add to cart');
  await expect(status(page)).toContainText('Add to cart');
  const box = await add.boundingBox(), after = await learned();
  expect(after.count).toBe(37);
  expect(Math.abs(after.last[0] - (box.x + box.width / 2))).toBeLessThan(1);
  expect(Math.abs(after.last[1] - (box.y + box.height / 2))).toBeLessThan(1);
  // At most one sample every two seconds; a control as wide as the page says too little about where the eyes were.
  await typeInstruction(page, 'click add to cart');
  expect((await learned()).count).toBe(37);
  await page.clock.runFor(2100);
  await gazeAt(page, page.getByLabel('Sort by'));
  await typeInstruction(page, 'choose title');
  await expect(page.getByLabel('Sort by')).toHaveValue('Title');
  expect((await learned()).count).toBe(37);
  await page.clock.runFor(2100);
  await gazeAt(page, add);
  await typeInstruction(page, 'click add to cart');
  await expect.poll(async () => (await learned()).count).toBe(38);
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

test('a cancelled camera start cannot change the mode of an immediate retry', async ({ page }) => {
  await open(page, '/practice-site/catalog.html');
  const state = await page.evaluate(async () => {
    window.gazeNavigator.stop();
    const { startWebNavigator } = await import('/src/web/overlay.js');
    let loads = 0;
    window.gazeNavigator = startWebNavigator({ window, loadCamera: () => ++loads === 1 ? new Promise(() => {}) : Promise.resolve(window.webgazer) });
    window.gazeNavigator.run('use camera');
    window.gazeNavigator.run('use pointer');
    window.gazeNavigator.run('use camera');
    for (let index = 0; index < 20; index++) await Promise.resolve();
    return { source: window.gazeNavigator.shadow.querySelector('.use-camera').getAttribute('aria-pressed'), camera: window.gazeNavigator.camera.state, calibrating: window.gazeNavigator.calibrating };
  });
  expect(state).toEqual({ source: 'true', camera: 'ready', calibrating: true });
});

test('resizing during calibration keeps the stale circle hidden and preserves the calibration session', async ({ page }) => {
  await open(page, '/practice-site/index.html');
  const target = await page.getByRole('link', { name: 'Catalog', exact: true }).boundingBox();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2); await page.clock.runFor(33);
  await expect(page.locator('#gaze-web-navigator .outline').first()).toBeVisible();
  await expect(page.locator('#gaze-web-navigator .circle')).toHaveClass(/visible/);
  await startCamera(page);
  const circle = page.locator('#gaze-web-navigator .circle');
  await expect(circle).not.toHaveClass(/visible/);
  await typeInstruction(page, 'use a large circle'); await page.clock.runFor(33);
  await expect(panel(page).getByLabel('Circle size')).toHaveValue('large');
  await expect(circle).not.toHaveClass(/visible/);
  await expect(page.locator('#gaze-web-navigator .outline')).toHaveCount(0);
  await expect(dot(page)).toHaveClass(/settling/);
  expect(await page.evaluate(() => window.__camera.released)).toBe(0);
  await finishCalibration(page, 'large (130 px)');
  await gazeAt(page, page.getByRole('link', { name: 'Catalog', exact: true }));
  await expect(circle).toHaveClass(/visible/); await expect(circle).toHaveCSS('width', '260px');
});
