import { test, expect } from '@playwright/test';
const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');
const task = page => panel(page).locator('.trial-task');
async function say(page, text) {
  await panel(page).getByLabel('Typed instruction').fill(text);
  await panel(page).getByRole('button', { name: 'Do it', exact: true }).click();
}
async function setup(page, holdRead = false) {
  await page.goto('/practice-site/catalog.html');
  await page.evaluate(async holdRead => {
    window.gazeNavigator.stop();
    const { startWebNavigator } = await import('/src/web/overlay.js');
    const { startTrial, finishTask } = await import('/src/web/trial-tasks.js');
    let current = startTrial(['One', 'Two'], Date.now());
    window.initialTrial = structuredClone(current);
    window.trialStore = {
      load: () => ({}), save() {},
      loadTrial: () => holdRead ? new Promise(resolve => { window.releaseTrialRead = () => resolve(window.initialTrial); }) : Promise.resolve(current),
      onTrialChange(callback) { window.changeTrial = value => { current = value; callback(value); }; return () => {}; },
      finishTrial(expected, outcome) {
        return new Promise((resolve, reject) => {
          window.failTrialSave = reject;
          let result;
          window.commitTrialSave = (notify = true) => {
            result = finishTask(expected, outcome, Date.now());
            window.committedTrial = result.trial;
            if (notify) window.changeTrial(result.trial);
          };
          window.replyTrialSave = () => resolve({ ok: true, ...result });
          window.completeTrialSave = () => { window.commitTrialSave(); window.replyTrialSave(); };
        });
      },
    };
    window.gazeNavigator = startWebNavigator({ store: window.trialStore });
  }, holdRead);
}

test('the panel keeps the task while saving and after failure, and follows only committed results', async ({ page }) => {
  await setup(page);
  await expect(task(page)).toHaveText('Task 1 of 2: One');
  await say(page, 'task done');
  await expect(status(page)).toHaveText('Saving the task result…');
  await expect(task(page)).toHaveText('Task 1 of 2: One');
  await page.evaluate(() => window.failTrialSave(new Error('Test storage failure')));
  await expect(status(page)).toContainText('Could not save the task result');
  await expect(task(page)).toHaveText('Task 1 of 2: One');
  await say(page, 'task done');
  await page.evaluate(() => window.completeTrialSave());
  await expect(status(page)).toContainText('Task 1 done after');
  await expect(task(page)).toHaveText('Task 2 of 2: Two');
});

test('a delayed initial trial read cannot restore a trial cleared by a newer storage event', async ({ page }) => {
  await setup(page, true);
  await page.evaluate(() => { window.changeTrial(null); window.releaseTrialRead(); });
  await expect(task(page)).toBeHidden();
  expect(await task(page).textContent()).toBe('');
});


for (const change of ['clear', 'end', 'advance', 'replace']) test(`a late task reply cannot announce an obsolete next task after ${change}`, async ({ page }) => {
  await setup(page);
  await expect(task(page)).toHaveText('Task 1 of 2: One');
  await say(page, 'task done');
  await page.evaluate(async change => {
    const { endTrial, finishTask, startTrial } = await import('/src/web/trial-tasks.js');
    window.commitTrialSave();
    const newer = change === 'clear' ? null : change === 'end' ? endTrial(window.committedTrial, Date.now())
      : change === 'advance' ? finishTask(window.committedTrial, 'done', Date.now()).trial : { ...startTrial(['Replacement'], Date.now()), id: 'replacement' };
    window.changeTrial(newer);
    window.replyTrialSave();
  }, change);
  await expect(status(page)).toContainText('trial has since changed');
  await expect(status(page)).not.toContainText('Task 2 of 2: Two');
});

test('a durable task reply may arrive before its storage event', async ({ page }) => {
  await setup(page);
  await expect(task(page)).toHaveText('Task 1 of 2: One');
  await say(page, 'task done');
  await page.evaluate(() => { window.commitTrialSave(false); window.replyTrialSave(); });
  await expect(status(page)).toContainText('Task 1 done after');
  await page.evaluate(() => window.changeTrial(window.committedTrial));
  await expect(task(page)).toHaveText('Task 2 of 2: Two');
});
