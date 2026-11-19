import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

async function setup(page, ended = false) {
  const html = readFileSync('extension/popup.html', 'utf8').replace('<script type="module" src="popup.js"></script>', '').replace('src="popup-log.js"', 'src="/trial-popup-log.js"').replace('href="popup.css"', 'href="/extension/popup.css"');
  const script = readFileSync('extension/popup-log.js', 'utf8').replaceAll("'./src/web/", "'/src/web/");
  await page.route('**/trial-popup.html', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.route('**/trial-popup-log.js', route => route.fulfill({ contentType: 'text/javascript', body: script }));
  await page.addInitScript(ended => {
    const trial = { tasks: ['Original'], current: ended ? 1 : 0, startedAt: 1000, taskStartedAt: 1000, id: 'A', results: ended ? [{ number: 1, text: 'Original', outcome: 'done', seconds: 1 }] : [], ...(ended ? { endedAt: 2000 } : {}) };
    window.trialData = { 'gaze-navigator-trial': trial };
    const storage = {
      get: async key => structuredClone(key == null ? window.trialData : typeof key === 'string' ? { [key]: window.trialData[key] } : Object.fromEntries(key.map(k => [k, window.trialData[k]]))),
      set: async items => Object.assign(window.trialData, structuredClone(items)),
      remove: async keys => { for (const key of keys) delete window.trialData[key]; },
    };
    let queue;
    window.chrome = { storage: { local: storage }, runtime: { sendMessage: async message => {
      queue ??= import('/src/web/trial-store.js').then(({ createTrialStore }) => createTrialStore({ storage }));
      return (await queue)(message.request);
    } } };
    window.replaceTrial = () => {
      const previous = window.trialData['gaze-navigator-trial'];
      window.trialData['gaze-navigator-trial'] = { ...previous, id: 'B', startedAt: 3000, tasks: ['Replacement'] };
    };
  }, ended);
  await page.goto('/trial-popup.html');
  await expect(page.locator('#trial')).toBeEnabled();
}

for (const operation of ['clear', 'end', 'replace']) test(`popup ${operation} cannot affect a trial replaced since it was displayed or confirmed`, async ({ page }) => {
  await setup(page, operation === 'replace');
  if (operation === 'clear') {
    await page.getByRole('button', { name: 'Clear log', exact: true }).click();
    await expect(page.locator('#logState')).toContainText('Press Clear log again');
  } else if (operation === 'replace') {
    await page.getByRole('button', { name: 'Start trial', exact: true }).click();
    await expect(page.locator('#trialState')).toContainText('Press Start trial again');
  }
  await page.evaluate(() => window.replaceTrial());
  await page.getByRole('button', { name: operation === 'clear' ? 'Clear log' : operation === 'end' ? 'End trial' : 'Start trial', exact: true }).click();
  await expect(page.locator(operation === 'clear' ? '#logState' : '#trialState')).toContainText('Could not');
  const kept = await page.evaluate(() => window.trialData['gaze-navigator-trial']);
  expect(kept.id).toBe('B');
  if (operation === 'end') expect(kept.endedAt).toBeUndefined();
});


test('popup start, logging choices, end and confirmed clear use durable storage', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'End trial', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start trial', exact: true })).toBeEnabled();
  await page.getByLabel('Tasks to try, one per line').fill('New task');
  await page.getByRole('button', { name: 'Start trial', exact: true }).click();
  await expect(page.locator('#trialState')).toContainText('Started:');
  await expect(page.getByLabel('Keep a log of instructions on this computer')).toBeChecked();
  await page.getByLabel('Include what was said and the replies').check();
  await expect.poll(() => page.evaluate(() => window.trialData['gaze-navigator-log-settings']?.words)).toBe(true);
  await page.getByLabel('Include what was said and the replies').uncheck();
  await expect.poll(() => page.evaluate(() => window.trialData['gaze-navigator-log-settings']?.words)).toBe(false);
  await page.getByRole('button', { name: 'Clear log', exact: true }).click();
  await expect(page.locator('#logState')).toContainText('Press Clear log again');
  await page.getByRole('button', { name: 'Clear log', exact: true }).click();
  await expect(page.locator('#logState')).toHaveText('The log is cleared.');
  expect(await page.evaluate(() => 'gaze-navigator-trial' in window.trialData)).toBe(false);
});
