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
      // Optional FaceMesh landmarks with irises, a fresh list each frame as the face model gives.
      getTracker: () => (record.face ? { getPositions: () => record.face.map(point => [...point]) } : undefined),
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


// FaceMesh-like landmarks with irises, the eyes centred at `cx` in a 640 by 480 picture.
function face(cx) {
  const cy = 240, positions = Array.from({ length: 478 }, () => [cx, cy + 30, 0]);
  const eye = (outer, inner, upper, lower, iris, from, to) => {
    positions[outer] = [cx + from, cy, 0]; positions[inner] = [cx + to, cy, 0];
    const mx = cx + (from + to) / 2;
    positions[upper] = [mx, cy - 4, 0]; positions[lower] = [mx, cy + 4, 0]; positions[iris] = [mx, cy, 0];
  };
  eye(33, 133, 159, 145, 473, -40, -15); eye(263, 362, 386, 374, 468, 40, 15);
  positions[1] = [cx, cy + 20, 0];
  return positions;
}

// Frames at about 10 a second for `ms`, each gaze estimate at the window's middle.
async function frames(page, ms) {
  for (let t = 0; t < ms; t += 100) {
    await page.evaluate(() => window.webgazer.emit({ x: innerWidth / 2, y: innerHeight / 2 }));
    await page.clock.runFor(100);
  }
}

test('after calibration, leaning well away from where you sat is noticed and you are told the circle may be off', async ({ page }) => {
  test.setTimeout(120000);
  await open(page, '/practice-site/catalog.html');
  await page.evaluate(points => { window.__camera.face = points; }, face(320));
  await startCamera(page);
  // The face is seen at every dot, so the irises learn the calibration as WebGazer does; then the accuracy check.
  await frames(page, 9 * 1900 + 100);
  await expect(status(page)).toHaveText('Calibrated with 9 of 9 dots. Checking accuracy: look at dot 1 of 4.');
  await frames(page, 4 * 2000);
  await expect(dot(page)).toHaveClass(/hidden/);
  // Sitting still: nothing is said. Leaning 100 px across the picture for two seconds: the notice.
  await frames(page, 2000);
  await expect(status(page)).not.toContainText('moved since calibrating');
  await page.evaluate(points => { window.__camera.face = points; }, face(420));
  await frames(page, 2000);
  await expect(status(page)).toHaveText('You have moved since calibrating, so the circle may be off. Move back to where you sat, or say recalibrate.');
});
