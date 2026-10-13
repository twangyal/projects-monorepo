// Scripted tasks on live public websites through the Chrome extension: the pointer stands in for gaze
// (it rests on the control a person would look at) and typed text stands in for speech. Each step records
// whether the intended effect happened, how many utterances it took, questions asked and unintended effects.
// This is an automated proxy for real use, not a study with intended users or real gaze/speech input.
//   node scripts/evaluate-real-sites.mjs --extension DIR [--assist] [--json OUT]
// DIR must be an extension build with host access granted (automation cannot click the permission prompt).
import { chromium } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argument = name => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : null; };
const extension = argument('--extension'), assist = process.argv.includes('--assist'), output = argument('--json');
if (!extension) throw new Error('Give an extension build with --extension DIR.');

const link = name => page => page.getByRole('link', { name, exact: true }).first();
const button = name => page => page.getByRole('button', { name, exact: true }).first();
const field = name => page => page.getByRole('searchbox', { name, exact: true }).or(page.getByRole('textbox', { name, exact: true })).or(page.getByRole('combobox', { name, exact: true })).first();
const url = pattern => async page => pattern.test(decodeURIComponent(page.url()));

// Each task: a goal a person might have, as steps of (where they look, what they say, what should happen).
export const TASKS = [
  { site: 'Wikipedia', goal: 'Find the article on Ada Lovelace, open her father\'s article, and come back', start: 'https://en.wikipedia.org/wiki/Main_Page', steps: [
    { look: field('Search Wikipedia'), say: 'search for Ada Lovelace', done: url(/\/wiki\/Ada_Lovelace/) },
    { look: link('Lord Byron'), say: 'open Lord Byron', target: 'Lord Byron', done: url(/\/wiki\/Lord_Byron/) },
    { look: null, say: 'go back', done: url(/\/wiki\/Ada_Lovelace$/) },
  ] },
  { site: 'Wikipedia', goal: 'Reach the log-in page', start: 'https://en.wikipedia.org/wiki/Main_Page', steps: [
    { look: link('Log in'), say: 'sign in', target: 'Log in', done: url(/Special:UserLogin/) },
  ] },
  { site: 'Wikipedia', goal: 'Open the page history of the Main Page', start: 'https://en.wikipedia.org/wiki/Main_Page', steps: [
    { look: link('View history'), say: 'show me the past versions of this page', target: 'View history', done: url(/action=history/) },
  ] },
  { site: 'GOV.UK', goal: 'Refuse optional cookies, then find passport information', start: 'https://www.gov.uk/', steps: [
    { look: button('Reject additional cookies'), say: 'reject additional cookies', target: 'Reject additional cookies', done: async page => !(await page.getByRole('button', { name: 'Reject additional cookies' }).isVisible()) },
    { look: link('Passports, travel and living abroad'), say: 'open passports', target: 'Passports, travel and living abroad', done: url(/\/browse\/abroad/) },
  ] },
  { site: 'GOV.UK', goal: 'Find the driving section with an everyday description', start: 'https://www.gov.uk/', steps: [
    { look: link('Driving and transport'), say: 'take me to the stuff about cars', target: 'Driving and transport', done: url(/\/browse\/driving/) },
  ] },
  { site: 'GOV.UK', goal: 'Search for how to renew a passport', start: 'https://www.gov.uk/', steps: [
    { look: field('Search'), say: 'search for renew passport', done: url(/search\/all.*renew.*passport/) },
  ] },
  { site: 'MDN', goal: 'Open the HTML reference', start: 'https://developer.mozilla.org/en-US/', steps: [
    { look: link('HTML'), say: 'open HTML', target: 'HTML', done: url(/\/docs\/Web\/HTML/) },
  ] },
];

async function run() {
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'gaze-real-')), {
    executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const control = await context.newPage();
  await control.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await control.evaluate(() => chrome.storage.local.set({ preferences: { autoStart: true, persist: false } }));
  const results = [];
  for (const task of TASKS) {
    const page = await context.newPage();
    const panel = page.locator('#gaze-web-navigator section'), status = panel.locator('.status');
    const record = { site: task.site, goal: task.goal, steps: [], completed: false };
    try {
      await page.goto(task.start, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await status.waitFor({ timeout: 20000 });
      if (assist) {
        await panel.locator('details.settings').evaluate(details => { details.open = true; });
        const box = panel.getByLabel('Smarter target matching');
        if (!(await box.isChecked())) await box.check();
        await page.waitForFunction(() => /is on|could not/.test(document.querySelector('#gaze-web-navigator')?.shadowRoot.querySelector('.assist-state').textContent ?? ''), null, { timeout: 300000 });
      }
      for (const step of task.steps) {
        const entry = { say: step.say, utterances: 0, questions: 0, outcome: 'failed', replies: [] };
        record.steps.push(entry);
        if (step.look) {
          const target = step.look(page);
          await target.scrollIntoViewIfNeeded({ timeout: 10000 });
          const box = await target.boundingBox();
          if (!box) { entry.outcome = 'target-missing'; break; }
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(250);
        }
        const before = page.url();
        const say = async text => {
          entry.utterances++;
          await panel.getByLabel('Typed instruction').fill(text);
          await panel.getByRole('button', { name: 'Do it' }).click();
          await page.waitForTimeout(300);
          await page.waitForFunction(() => !/Working out/.test(document.querySelector('#gaze-web-navigator')?.shadowRoot.querySelector('.status')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => {});
          await page.waitForLoadState('domcontentloaded').catch(() => {});
          await page.waitForTimeout(700);
          entry.replies.push((await status.textContent().catch(() => '')) ?? '');
        };
        await say(step.say);
        // A question is answered the way a person would: by the number shown for the intended control.
        for (let round = 0; round < 2; round++) {
          const buttons = panel.locator('.prompt button');
          if (!(await buttons.count())) break;
          entry.questions++;
          const labels = await buttons.allTextContents();
          if (labels[0] === 'Confirm') { await say('confirm'); continue; }
          const chosen = labels.find(label => step.target && label.replace(/^\d+:\s*/, '') === step.target);
          if (!chosen) break;
          await say(chosen.split(':')[0]);
        }
        if (await step.done(page).catch(() => false)) entry.outcome = 'done';
        else if (page.url() !== before) entry.outcome = 'unintended';
        else entry.outcome = entry.questions ? 'unanswered-question' : 'failed';
        if (entry.outcome !== 'done') break;
      }
      record.completed = record.steps.length === task.steps.length && record.steps.every(step => step.outcome === 'done');
    } catch (error) {
      record.error = error.message.split('\n')[0];
    }
    results.push(record);
    console.log(JSON.stringify({ site: record.site, goal: record.goal, completed: record.completed, steps: record.steps.map(s => [s.say, s.outcome, s.utterances, s.questions]), error: record.error }));
    await page.close();
  }
  await context.close();
  const steps = results.flatMap(result => result.steps);
  const summary = { assist, date: new Date().toISOString().slice(0, 10), tasks: results.length, completed: results.filter(result => result.completed).length,
    steps: steps.length, stepsDone: steps.filter(step => step.outcome === 'done').length, unintended: steps.filter(step => step.outcome === 'unintended').length,
    utterances: steps.reduce((sum, step) => sum + step.utterances, 0), questions: steps.reduce((sum, step) => sum + step.questions, 0) };
  console.log(JSON.stringify(summary));
  if (output) writeFileSync(output, `${JSON.stringify({ summary, results }, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await run();
