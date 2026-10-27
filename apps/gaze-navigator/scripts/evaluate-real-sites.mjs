// Scripted tasks on live public websites through the Chrome extension: the pointer stands in for gaze
// (it rests on the control a person would look at) and typed text stands in for speech. Each step records
// whether the intended effect happened, how many utterances it took, questions asked and unintended effects.
// This is an automated proxy for real use, not a study with intended users or real gaze/speech input.
//   node scripts/evaluate-real-sites.mjs --extension DIR [--assist] [--json OUT] [--only 'text in a task goal']
//     [--gaze-error PX] [--trials N] [--seed S]
// --gaze-error offsets each look by random Gaussian error with that standard deviation per axis, like
// webcam gaze (often 100-200 px), instead of resting exactly on the control. --trials repeats each task
// with fresh offsets; --seed makes the offsets reproducible.
// DIR must be an extension build with host access granted (automation cannot click the permission prompt).
import { chromium } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argument = name => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : null; };
const extension = argument('--extension'), assist = process.argv.includes('--assist'), output = argument('--json'), only = argument('--only');
const gazeError = Number(argument('--gaze-error') ?? 0), trials = Math.max(1, Number(argument('--trials') ?? 1)), seed = Number(argument('--seed') ?? 1);
if (!extension) throw new Error('Give an extension build with --extension DIR.');
if (!(gazeError >= 0)) throw new Error('--gaze-error must be a number of pixels.');

// Seeded generator (mulberry32) and normal samples (Box-Muller), so a run's offsets can be repeated.
function random(state) {
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const uniform = random(seed);
const normal = () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());

const link = name => page => page.getByRole('link', { name, exact: typeof name === 'string' }).first();
const button = name => page => page.getByRole('button', { name, exact: true }).first();
const field = name => page => page.getByRole('searchbox', { name, exact: true }).or(page.getByRole('textbox', { name, exact: true })).or(page.getByRole('combobox', { name, exact: true })).first();
const url = pattern => async page => pattern.test(decodeURIComponent(page.url()));
const select = name => page => page.getByRole('combobox', { name, exact: true }).first();
const scrolled = selector => page => page.evaluate(css => css ? document.querySelector(css).scrollTop : scrollY, selector);
// `measure` is read before the step; `done` then receives it.
// Wikipedia swaps in a new search input on focus, so text is read from the focused field.
const typed = text => async page => (await page.evaluate(() => document.activeElement?.value)) === text;
const menu = page => page.locator('#super-navigation-menu-toggle');
const expanded = (locate, value) => async page => (await locate(page).getAttribute('aria-expanded')) === value;
const grew = selector => ({ measure: scrolled(selector), done: async (page, before) => (await scrolled(selector)(page)) > before + 100 });

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
  // Added in #238: dictation and correction, dropdowns, scrolling a region and the page, pagination.
  { site: 'Wikipedia', goal: 'Dictate a search, correct a misheard word, and send it', start: 'https://en.wikipedia.org/wiki/Main_Page', steps: [
    { look: field('Search Wikipedia'), say: 'type Alan Turnig', done: typed('Alan Turnig') },
    { look: field('Search Wikipedia'), say: 'change Turnig to Turing', done: typed('Alan Turing') },
    { look: field('Search Wikipedia'), say: 'press enter', done: url(/\/wiki\/Alan_Turing|search=Alan\+?\s?Turing/) },
  ] },
  { site: 'Wikipedia', goal: 'Read further down an article and return to the top', start: 'https://en.wikipedia.org/wiki/Ada_Lovelace', steps: [
    { look: null, say: 'scroll down', ...grew(null) },
    { look: null, say: 'go to the top', done: async page => (await scrolled(null)(page)) < 5 },
  ] },
  { site: 'Python docs', goal: 'Switch the documentation to Python 3.12', start: 'https://docs.python.org/3/library/json.html', steps: [
    { look: select('Python version'), say: 'choose 3.12', done: url(/docs\.python\.org\/3\.12\//) },
  ] },
  { site: 'Python docs', goal: 'Switch to the dark theme with an unlabelled dropdown', start: 'https://docs.python.org/3/library/json.html', steps: [
    { look: page => page.locator('select:visible').filter({ has: page.locator('option', { hasText: 'Dark' }) }).first(), say: 'choose dark',
      done: async page => page.evaluate(() => document.documentElement.dataset.theme === 'dark' || document.body.dataset.theme === 'dark' || localStorage.getItem('currentTheme') === 'dark') },
  ] },
  { site: 'GOV.UK', goal: 'Go to the second page of search results', start: 'https://www.gov.uk/search/all?keywords=passport', steps: [
    { look: link(/^Next page/), say: 'next page', target: 'Next page', done: url(/page=2/) },
  ] },
  // Added in #240: menus, disclosure widgets and checkboxes.
  { site: 'GOV.UK', goal: 'Open the navigation menu, then close it', start: 'https://www.gov.uk/', steps: [
    // The button is renamed "Hide navigation menu" once open, so it is found by id.
    { look: menu, say: 'show the navigation menu', done: async page => (await menu(page).getAttribute('aria-expanded')) === 'true' },
    { look: menu, say: 'close the menu', done: async page => (await menu(page).getAttribute('aria-expanded')) === 'false' },
  ] },
  { site: 'Wikipedia', goal: 'Open the page tools menu', start: 'https://en.wikipedia.org/wiki/Ada_Lovelace', steps: [
    { look: page => page.locator('#vector-page-tools-dropdown-label'), say: 'open tools', done: async page => page.locator('#vector-page-tools-dropdown-checkbox').isChecked() },
  ] },
  { site: 'GOV.UK', goal: 'Show the search filters', start: 'https://www.gov.uk/search/all?keywords=passport', steps: [
    { look: button('Filter and sort'), say: 'open filter and sort', target: 'Filter and sort', done: expanded(button('Filter and sort'), 'true') },
  ] },
  { site: 'Wikipedia', goal: 'Tick and untick "Keep me logged in" without logging in', start: 'https://en.wikipedia.org/wiki/Special:UserLogin', steps: [
    { look: page => page.getByRole('checkbox', { name: /Keep me logged in/ }).first(), say: 'tick keep me logged in', done: async page => page.getByRole('checkbox', { name: /Keep me logged in/ }).first().isChecked() },
    { look: page => page.getByRole('checkbox', { name: /Keep me logged in/ }).first(), say: 'untick it', done: async page => !(await page.getByRole('checkbox', { name: /Keep me logged in/ }).first().isChecked()) },
  ] },
  { site: 'MDN', goal: 'Scroll the reference sidebar, not the page', start: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a', steps: [
    { look: page => page.locator('#main-sidebar a').nth(8), say: 'scroll the list down', ...grew('#main-sidebar') },
  ] },
  // Custom widgets from component libraries and the WAI-ARIA Authoring Practices examples.
  { site: 'WAI-ARIA APG', goal: 'Choose a fruit in a custom select-only combobox', start: 'https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/', steps: [
    { look: select('Favorite Fruit'), say: 'set favorite fruit to banana', done: async page => (await select('Favorite Fruit')(page).textContent()).trim() === 'Banana' },
  ] },
  { site: 'WAI-ARIA APG', goal: 'Set a custom colour slider to an exact value', start: 'https://www.w3.org/WAI/ARIA/apg/patterns/slider/examples/slider-color-viewer/', steps: [
    { look: page => page.getByRole('slider', { name: 'Red' }).first(), say: 'set red slider to 200', done: async page => (await page.getByRole('slider', { name: 'Red' }).first().getAttribute('aria-valuenow')) === '200' },
  ] },
  { site: 'MUI', goal: 'Refuse analytics cookies, then pick a film in an autocomplete by saying its name', start: 'https://mui.com/material-ui/react-autocomplete/', steps: [
    { look: button('Essential only'), say: 'click essential only', target: 'Essential only', done: async page => !(await button('Essential only')(page).isVisible()) },
    { look: select('Movie'), say: 'set movie to the godfather', done: async page => (await select('Movie')(page).inputValue()) === 'The Godfather' },
  ] },
];

async function run() {
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'gaze-real-')), {
    // Extensions need full Chromium; the headless shell cannot load them.
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }), headless: true, viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const control = await context.newPage();
  await control.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await control.evaluate(() => chrome.storage.local.set({ preferences: { autoStart: true, persist: false } }));
  const results = [];
  const runs = TASKS.filter(item => !only || item.goal.includes(only)).flatMap(task => Array.from({ length: trials }, (_, trial) => ({ task, trial })));
  for (const { task, trial } of runs) {
    const page = await context.newPage();
    const panel = page.locator('#gaze-web-navigator section'), status = panel.locator('.status');
    const record = { site: task.site, goal: task.goal, trial, steps: [], completed: false };
    try {
      await page.goto(task.start, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await status.waitFor({ timeout: 20000 });
      if (assist) {
        await panel.locator('details.settings').evaluate(details => { details.open = true; });
        const box = panel.getByLabel('Smarter target matching');
        if (!(await box.isChecked())) await box.check();
        await page.waitForFunction(() => /is on|could not/.test(document.querySelector('#gaze-web-navigator')?.shadowRoot.querySelector('.assist-state').textContent ?? ''), null, { timeout: 300000 });
        record.assistState = await panel.locator('.assist-state').textContent();
      }
      for (const step of task.steps) {
        const entry = { say: step.say, utterances: 0, questions: 0, outcome: 'failed', replies: [] };
        record.steps.push(entry);
        if (step.look) {
          const target = step.look(page);
          await target.scrollIntoViewIfNeeded({ timeout: 10000 });
          const box = await target.boundingBox();
          if (!box) { entry.outcome = 'target-missing'; break; }
          const viewport = page.viewportSize();
          const dx = gazeError * normal(), dy = gazeError * normal();
          entry.offset = [Math.round(dx), Math.round(dy)];
          const x = Math.min(viewport.width - 1, Math.max(0, box.x + box.width / 2 + dx));
          const y = Math.min(viewport.height - 1, Math.max(0, box.y + box.height / 2 + dy));
          await page.mouse.move(x, y);
          await page.waitForTimeout(250);
        }
        const before = page.url(), measured = step.measure ? await step.measure(page) : undefined;
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
        if (await step.done(page, measured).catch(() => false)) entry.outcome = 'done';
        else if (page.url() !== before) entry.outcome = 'unintended';
        else entry.outcome = entry.questions ? 'unanswered-question' : 'failed';
        if (entry.outcome !== 'done') break;
      }
      record.completed = record.steps.length === task.steps.length && record.steps.every(step => step.outcome === 'done');
    } catch (error) {
      record.error = error.message.split('\n')[0];
    }
    results.push(record);
    console.log(JSON.stringify({ site: record.site, goal: record.goal, trial, completed: record.completed, steps: record.steps.map(s => [s.say, s.outcome, s.utterances, s.questions, s.offset]), error: record.error }));
    await page.close();
  }
  await context.close();
  const steps = results.flatMap(result => result.steps);
  const summary = { assist, gazeError, trials, seed, date: new Date().toISOString().slice(0, 10), tasks: results.length, completed: results.filter(result => result.completed).length,
    steps: steps.length, stepsDone: steps.filter(step => step.outcome === 'done').length, unintended: steps.filter(step => step.outcome === 'unintended').length,
    utterances: steps.reduce((sum, step) => sum + step.utterances, 0), questions: steps.reduce((sum, step) => sum + step.questions, 0) };
  console.log(JSON.stringify(summary));
  if (output) writeFileSync(output, `${JSON.stringify({ summary, results }, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await run();
