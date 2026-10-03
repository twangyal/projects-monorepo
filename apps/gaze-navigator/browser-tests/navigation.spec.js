import { test, expect } from '@playwright/test';

const evidence = new WeakMap();
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
  await page.clock.install({ time: new Date('2026-10-03T00:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-10-03T00:01:00Z'));
});
test.afterEach(async ({ page }) => {
  expect(evidence.get(page).external, 'simulation must not contact a camera/model CDN').toEqual([]);
  expect(evidence.get(page).errors, 'page must not throw').toEqual([]);
});

async function calibrate(page) {
  for (let i = 0; i < 27; i++) await page.locator('#calibrationStage button').click();
  await expect(page.locator('#playground')).toBeVisible();
}

async function simulate(page) {
  await page.getByRole('button', { name: 'Pointer simulation', exact: true }).click();
  await calibrate(page);
}

async function hit(locator) {
  return locator.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const at = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return at === element || element.contains(at);
  });
}

async function hold(page, locator, { scroll = true } = {}) {
  if (scroll) await locator.evaluate(element => new Promise(resolve => {
    const ancestors = [];
    for (let node = element.parentElement; node; node = node.parentElement) ancestors.push(node);
    const positions = () => [window.scrollX, window.scrollY, ...ancestors.flatMap(node => [node.scrollLeft, node.scrollTop])];
    const before = positions();
    const done = () => { document.removeEventListener('scrollend', done, true); resolve(); };
    document.addEventListener('scrollend', done, true);
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    if (positions().every((value, index) => value === before[index])) done();
  }));
  await page.mouse.move(1, 1);
  await page.clock.runFor(32);
  const geometry = await locator.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const at = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return { target: element.id || element.textContent, bounds: bounds.toJSON(), hit: at?.id || at?.className };
  });
  expect(await hit(locator), `control center must be visible and unobstructed: ${JSON.stringify(geometry)}`).toBe(true);
  const bounds = await locator.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.clock.runFor(1100);
}

async function reachKey(page, key, direction) {
  for (let i = 0; i < 20 && !await hit(key); i++) {
    await hold(page, page.locator(direction > 0 ? '#keyboardDown' : '#keyboardUp'), { scroll: false });
  }
  expect(await hit(key), 'all keys must be reachable through gaze scrolling').toBe(true);
}

test('real pointer dwell confirms once until looking away', async ({ page }) => {
  await simulate(page);
  const compose = page.locator('#composeButton');
  await compose.evaluate(button => {
    button.dataset.confirmations = '0';
    button.addEventListener('click', () => { button.dataset.confirmations = String(Number(button.dataset.confirmations) + 1); });
  });
  await hold(page, compose);
  await expect(page.locator('#composer')).toBeVisible();
  await page.clock.runFor(3000);
  await expect(compose).toHaveAttribute('data-confirmations', '1');
  await hold(page, compose);
  await expect(compose).toHaveAttribute('data-confirmations', '2');
});

test('gaze safety controls stay reachable through pause, scrolling, and stop', async ({ page }) => {
  await simulate(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await hold(page, page.locator('#pageDown'), { scroll: false });
  const lower = await page.evaluate(() => window.scrollY);
  expect(lower).toBeGreaterThan(0);
  await hold(page, page.locator('#pageUp'), { scroll: false });
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(lower);
  await hold(page, page.locator('#pauseTracking'), { scroll: false });
  await expect(page.locator('#pauseTracking')).toHaveText('Resume tracking');
  await page.clock.runFor(2000);
  await expect(page.locator('#pauseTracking')).toHaveText('Resume tracking');
  await expect(page.locator('#pageDown')).toBeDisabled();
  await hold(page, page.locator('#pauseTracking'), { scroll: false });
  await expect(page.locator('#pauseTracking')).toHaveText('Pause tracking');
  await hold(page, page.locator('#stopTracking'), { scroll: false });
  await expect(page.locator('#simulate')).toBeEnabled();
  await expect(page.locator('#status')).toContainText('Tracking stopped');
});

test('gaze keyboard reaches lower keys and saves a complete session draft', async ({ page }) => {
  await simulate(page);
  await hold(page, page.locator('#composeButton'));
  await hold(page, page.locator('#editSubject'));
  const a = page.locator('#keyboardKeys').getByRole('button', { name: 'a', exact: true });
  const backspace = page.locator('#keyboardKeys').getByRole('button', { name: 'Backspace', exact: true });
  await hold(page, a, { scroll: false });
  await expect(page.locator('#draftSubject')).toHaveValue('a');
  await reachKey(page, backspace, 1);
  await hold(page, backspace, { scroll: false });
  await expect(page.locator('#draftSubject')).toHaveValue('');
  await reachKey(page, a, -1);
  await hold(page, a, { scroll: false });
  await hold(page, page.locator('#closeKeyboard'), { scroll: false });
  await expect(page.locator('#textKeyboard')).toBeHidden();
  await hold(page, page.locator('#editBody'));
  await hold(page, page.locator('#keyboardKeys').getByRole('button', { name: 'b', exact: true }), { scroll: false });
  await hold(page, page.locator('#closeKeyboard'), { scroll: false });
  await hold(page, page.locator('#saveDraft'));
  await expect(page.locator('#draftList')).toHaveText('a: b');
  await expect(page.locator('#composer')).toBeHidden();
  await expect(page.locator('#result')).toContainText('Nothing was sent');
});

test('held-out report can be closed through gaze without manually scrolling its overlay', async ({ page }) => {
  await simulate(page);
  await hold(page, page.locator('#checkAccuracy'), { scroll: false });
  await expect(page.locator('#accuracyPanel')).toBeVisible();
  for (let i = 0; i < 5; i++) {
    const visible = await page.locator('#accuracyDot').evaluate(dot => {
      const bounds = dot.getBoundingClientRect();
      const at = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return at?.closest('#accuracyStage') !== null && at?.closest('#accuracyStage') !== undefined;
    });
    expect(visible, `measurement target ${i + 1} must be visible above the fixed footer`).toBe(true);
    await page.clock.runFor(2100);
  }
  await expect(page.locator('#accuracyResult')).toContainText('SIMULATION');
  await hold(page, page.locator('#cancelAccuracy'), { scroll: false });
  await expect(page.locator('#accuracyPanel')).toBeHidden();
});

test('resize restarts partial calibration and disables navigation', async ({ page }) => {
  await page.locator('#simulate').click();
  for (let i = 0; i < 5; i++) await page.locator('#calibrationStage button').click();
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport.width + 12, height: viewport.height + 12 });
  await expect(page.locator('#status')).toHaveText('Calibration point 1 of 9.');
  await expect(page.locator('#calibrationStage button')).toHaveText('1');
  await expect(page.locator('#playground')).toBeHidden();
  await expect(page.locator('#checkAccuracy')).toBeDisabled();
  await expect(page.locator('#pageDown')).toBeDisabled();
  await calibrate(page);
  await expect(page.locator('#checkAccuracy')).toBeEnabled();
});
