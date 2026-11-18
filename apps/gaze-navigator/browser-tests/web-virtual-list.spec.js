import { test, expect } from '@playwright/test';

// A long dropdown built the way virtualized lists are (react-window, MUI and others): only the rows in view, and a few
// either side, are on the page; the rest are added as the list scrolls.
const COUNTRIES = ['Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Bahamas', 'Bangladesh',
  'Belgium', 'Bhutan', 'Bolivia', 'Brazil', 'Bulgaria', 'Cambodia', 'Canada', 'Chile', 'China', 'Colombia', 'Croatia', 'Cuba', 'Denmark', 'Ecuador',
  'Egypt', 'Equatorial Guinea', 'Estonia', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Germany', 'Ghana', 'Greece', 'Guinea', 'Guinea-Bissau', 'Haiti',
  'Iceland', 'India', 'Ireland', 'Jamaica', 'Japan', 'Kenya', 'Laos', 'Mexico', 'Nepal', 'North Korea', 'Norway', 'Papua New Guinea', 'Peru', 'Portugal',
  'South Korea', 'Spain', 'Sweden', 'Uganda', 'Uruguay', 'Vietnam', 'Zambia', 'Zimbabwe'];

async function setup(page) {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(async countries => {
    document.body.innerHTML = `
      <button id="birth" role="combobox" aria-label="Country of birth" aria-expanded="false" aria-controls="birth-list">Choose a country</button>
      <div id="birth-list" role="listbox" hidden style="height: 150px; width: 240px; overflow-y: auto; position: relative">
        <div id="birth-rows" style="position: relative"></div></div>`;
    const button = document.querySelector('#birth'), list = document.querySelector('#birth-list'), rows = document.querySelector('#birth-rows'), ROW = 30;
    rows.style.height = `${countries.length * ROW}px`;
    window.rendered = 0;
    // Rows from just above the view to just below it, re-rendered on every scroll, a moment later as React would.
    const render = () => {
      const first = Math.max(0, Math.floor(list.scrollTop / ROW) - 2), last = Math.min(countries.length, Math.ceil((list.scrollTop + 150) / ROW) + 2);
      rows.innerHTML = countries.slice(first, last).map((name, i) => `<div role="option" style="position: absolute; top: ${(first + i) * ROW}px; height: ${ROW}px">${name}</div>`).join('');
      window.rendered = Math.max(window.rendered, last - first);
    };
    list.addEventListener('scroll', () => window.setTimeout(render, 10));
    button.addEventListener('click', () => {
      list.hidden = !list.hidden; button.setAttribute('aria-expanded', String(!list.hidden));
      if (!list.hidden) render();
    });
    list.addEventListener('click', event => {
      const option = event.target.closest('[role=option]');
      if (!option) return;
      button.textContent = option.textContent; list.hidden = true; button.setAttribute('aria-expanded', 'false');
    });
    const { captureContext } = await import('/src/web/page-context.js');
    const { createController } = await import('/src/web/controller.js');
    window.controller = createController({ window });
    window.capture = () => captureContext(document, { x: 20, y: 20, radius: 2000 });
    window.say = async text => {
      const result = window.controller.handle(text, window.capture());
      return await (result.followUp ?? result);
    };
  }, COUNTRIES);
}

test('a choice in a list that shows only the rows in view is found by scrolling to it, and chosen', async ({ page }) => {
  await setup(page);
  let result = await page.evaluate(() => window.say('choose Zimbabwe in country of birth'));
  expect(result).toMatchObject({ tone: 'success', message: 'Zimbabwe chosen in Country of birth.' });
  await expect(page.locator('#birth')).toHaveText('Zimbabwe');
  expect(await page.evaluate(() => window.rendered)).toBeLessThan(12);
  // The exact name wins over one that contains it and is reached first.
  result = await page.evaluate(() => window.say('choose Guinea in country of birth'));
  expect(result).toMatchObject({ tone: 'success', message: 'Guinea chosen in Country of birth.' });
  await expect(page.locator('#birth')).toHaveText('Guinea');
  // A part of one name only, anywhere in the list, is scrolled back to and chosen.
  result = await page.evaluate(() => window.say('choose Bissau in country of birth'));
  expect(result).toMatchObject({ tone: 'success', message: 'Guinea-Bissau chosen in Country of birth.' });
  await expect(page.locator('#birth')).toHaveText('Guinea-Bissau');
});

test('a name in no row of the long list, or in several, is reported after looking through all of it', async ({ page }) => {
  await setup(page);
  let result = await page.evaluate(() => window.say('choose atlantis in country of birth'));
  expect(result).toMatchObject({ tone: 'error', message: `No choice called “atlantis” in Country of birth, after looking through all 60 of them.` });
  result = await page.evaluate(() => window.say('choose korea in country of birth'));
  expect(result).toMatchObject({ tone: 'error', message: 'Several choices match “korea”: North Korea, South Korea. Say “click” and the one you mean.' });
  await expect(page.locator('#birth')).toHaveText('Choose a country');
});
