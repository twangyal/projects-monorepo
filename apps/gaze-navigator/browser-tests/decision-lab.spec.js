import { test, expect } from '@playwright/test';
import { CASES } from '../src/decision-fixtures.js';
import { eligibleTargets } from '../src/decision-contract.js';

const evidence = new WeakMap();
const BASE = 'http://127.0.0.1:4173';
const LOCAL = 'http://127.0.0.1:11434';
test.beforeEach(async ({ page }) => {
  const state = { external: [], errors: [], local: [], mode: null, blocked: null };
  evidence.set(page, state);
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === BASE) return route.continue();
    if (url.origin !== LOCAL || !state.mode) {
      state.external.push(url.href);
      return route.abort();
    }
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': BASE, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type' } });
    const body = request.method() === 'POST' ? request.postDataJSON() : null;
    state.local.push({ path: url.pathname, body });
    const reply = value => route.fulfill({ json: value, headers: { 'access-control-allow-origin': BASE } });
    if (url.pathname === '/api/status') return reply({ cloud: { disabled: state.mode !== 'cloud' } });
    if (url.pathname === '/api/tags') return reply({ models: [{ name: 'tev1:0.8b-q8_0', digest: 'a'.repeat(64), size: 812000000, details: { format: 'gguf' } }] });
    if (url.pathname === '/api/show') return reply({ details: { format: 'gguf' }, capabilities: ['decision'] });
    if (url.pathname !== '/v1/systemone') return route.abort();
    if (state.mode === 'wait') { state.blocked = route; return; }
    const fixture = CASES.find(c => c.task.goal === body.state.goal &&
      JSON.stringify(c.task.gaze) === JSON.stringify(body.state.gaze) &&
      JSON.stringify(eligibleTargets(c.task)) === JSON.stringify(body.state.targets));
    if (!fixture) throw new Error('Mock received an unknown synthetic task');
    const names = Object.keys(body.questions.selection.criteria);
    const choice = state.mode === 'invalid' ? 'invented' : fixture.expected ?? 'none';
    const probabilities = Object.fromEntries(names.map(name => [name, name === choice ? .9 : .1 / (names.length - 1)]));
    return reply({ answers: { selection: { type: 'choice', choice, confidence: .8, probabilities } } });
  });
  const response = await page.goto('/decision-lab.html');
  expect(response.status(), 'decision lab must be a usable page').toBe(200);
});
test.afterEach(async ({ page }) => {
  expect(evidence.get(page).external, 'lab must not make unapproved external requests').toEqual([]);
  expect(evidence.get(page).errors, 'lab must not throw').toEqual([]);
});
async function baseline(page) {
  await page.locator('#runBaseline').click();
  await expect(page.locator('#runStatus')).toContainText('Complete');
  await expect(page.locator('#summary')).toContainText('9/14 correct');
}

test('offline baseline reports honest context gaps without network and controls fit the viewport', async ({ page }) => {
  await baseline(page);
  await expect(page.locator('#caseResults tr')).toHaveCount(14);
  await expect(page.locator('#summary')).toContainText('1 unexpected selection');
  expect(evidence.get(page).local).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const id of ['runBaseline', 'runLocal', 'exportReport']) {
    const control = page.locator(`#${id}`);
    await control.scrollIntoViewIfNeeded();
    expect(await control.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === element;
    }), `${id} must remain reachable`).toBe(true);
  }
});

test('fixture selection exposes goal, geometry, expected target and missing gaze honestly', async ({ page }) => {
  await page.locator('#caseSelect').selectOption('search-context');
  await expect(page.locator('#caseGoal')).toContainText('Find the message about calibration');
  await expect(page.locator('#expectedTarget')).toContainText('Search');
  await expect(page.locator('#scenarioBoard .scenario-target')).toHaveCount(4);
  await expect(page.locator('#scenarioBoard .scenario-gaze')).toHaveCount(1);
  await page.locator('#caseSelect').selectOption('missing-gaze');
  await expect(page.locator('#expectedTarget')).toContainText('Abstain');
  await expect(page.locator('#scenarioBoard .scenario-gaze')).toHaveCount(0);
  await expect(page.locator('#gazeDescription')).toContainText('No gaze sample');
});

test('explicit local run uses typed local requests and records comparable provenance with mocked inference', async ({ page }) => {
  evidence.get(page).mode = 'good';
  await baseline(page);
  await page.locator('#runLocal').click();
  await expect(page.locator('#runStatus')).toContainText('Complete');
  await expect(page.locator('#summary')).toContainText('14/14 correct');
  await expect(page.locator('#reportProvenance')).toContainText('a'.repeat(64));
  await expect(page.locator('#caseResults tr')).toHaveCount(14);
  const calls = evidence.get(page).local;
  expect(calls.filter(c => c.path === '/v1/systemone')).toHaveLength(11);
  expect(calls.slice(0, 3).map(c => c.path)).toEqual(['/api/status', '/api/tags', '/api/show']);
  for (const call of calls.filter(c => c.body)) {
    expect(call.body.model).toBe('tev1:0.8b-q8_0:local');
    expect(call.body.state?.expected).toBeUndefined();
    expect(call.body.state?.caseId).toBeUndefined();
  }
  await expect(page.locator('#caseResults').getByText('Compose (t1)', { exact: true }).first()).toBeVisible();
});

test('cloud status and invalid output remain errors, then a fresh local run can recover', async ({ page }) => {
  const state = evidence.get(page);
  state.mode = 'cloud';
  await page.locator('#runLocal').click();
  await expect(page.locator('#runStatus')).toContainText('Complete');
  await expect(page.locator('#summary')).toContainText('11 errors');
  expect(state.local.some(c => c.path === '/v1/systemone')).toBe(false);
  state.mode = 'invalid';
  await page.locator('#runLocal').click();
  await expect(page.locator('#runStatus')).toContainText('Complete');
  await expect(page.locator('#summary')).toContainText('11 errors');
  await expect(page.locator('#caseResults').getByText(/Invalid typed choice/).first()).toBeVisible();
  state.mode = 'good';
  await page.locator('#runLocal').click();
  await expect(page.locator('#summary')).toContainText('14/14 correct');
});

test('cancel releases the UI and late mocked inference cannot replace a newer baseline', async ({ page }) => {
  const state = evidence.get(page);
  state.mode = 'wait';
  await page.locator('#runLocal').click();
  await expect.poll(() => state.blocked !== null).toBe(true);
  await page.locator('#cancelRun').click();
  await expect(page.locator('#runStatus')).toContainText('Cancelled');
  await expect(page.locator('#runBaseline')).toBeEnabled();
  await baseline(page);
  await state.blocked.fulfill({ json: { answers: { selection: { type: 'choice', choice: 'none', confidence: 1, probabilities: { none: 1 } } } } }).catch(() => {});
  await expect(page.locator('#summary')).toContainText('9/14 correct');
  await expect(page.locator('#reportProvenance')).toContainText('Geometric baseline');
});

test('reports export and reload safely, while invalid files preserve the last comparison', async ({ page }) => {
  await baseline(page);
  const downloadReady = page.waitForEvent('download');
  await page.locator('#exportReport').click();
  const download = await downloadReady;
  let content = '';
  for await (const chunk of await download.createReadStream()) content += chunk.toString('utf8');
  const report = JSON.parse(content);
  expect(report.results).toHaveLength(14);
  expect(report.suite).toBe('gaze-targets-v1');
  report.model = { id: '<img src=x onerror=alert(1)>', kind: 'external', digest: null };
  await page.locator('#importReport').setInputFiles({ name: 'comparison.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(report)) });
  await expect(page.locator('#runStatus')).toContainText('Imported');
  await expect(page.locator('#reportProvenance')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('img')).toHaveCount(0);
  await expect(page.locator('#summary')).toContainText('9/14 correct');
  await page.locator('#importReport').setInputFiles({ name: 'wrong.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...report, suite: 'wrong-suite' })) });
  await expect(page.locator('#runStatus')).toContainText('Report rejected');
  await expect(page.locator('#summary')).toContainText('9/14 correct');
});
