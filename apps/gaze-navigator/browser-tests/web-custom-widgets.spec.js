import { test, expect } from '@playwright/test';

// Custom ARIA widgets built the way component libraries build them: state lives in aria-* attributes and changes
// only through the widget's own keyboard and pointer handlers, sometimes after the event has finished.
const markup = `
  <style>[role=slider], [role=spinbutton] { display: block; width: 200px; height: 16px; margin: 4px; }</style>
  <div id="volume" role="slider" tabindex="0" aria-label="Volume" aria-valuemin="0" aria-valuemax="100" aria-valuenow="20"></div>
  <div id="stepped" role="slider" tabindex="0" aria-label="Brightness" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></div>
  <div id="guests" role="spinbutton" tabindex="0" aria-label="Guests" aria-valuemin="1" aria-valuemax="12" aria-valuenow="2"></div>
  <div id="frozen" role="slider" tabindex="0" aria-label="Balance" aria-valuemin="0" aria-valuemax="10" aria-valuenow="5"></div>
  <button id="size" role="combobox" aria-label="Size" aria-expanded="false" aria-controls="size-list">Medium</button>
  <ul id="size-list" role="listbox" hidden>
    <li role="option" id="small">Small</li><li role="option" id="medium" aria-selected="true">Medium</li>
    <li role="option" id="large">Large</li><li role="option" id="xl">Extra large</li><li role="option" aria-disabled="true">Delete my size</li>
  </ul>
  <label for="country">Country</label>
  <input id="country" role="combobox" aria-expanded="false" aria-controls="country-list" aria-autocomplete="list">
  <ul id="country-list" role="listbox" hidden></ul>`;

async function setup(page) {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(async markup => {
    document.body.innerHTML = markup;
    window.keys = [];
    // A slider whose framework updates the DOM after a microtask, stepping by 1.
    const slider = (element, step, later) => element.addEventListener('keydown', event => {
      window.keys.push(`${element.id}:${event.key}`);
      const min = Number(element.getAttribute('aria-valuemin')), max = Number(element.getAttribute('aria-valuemax'));
      const now = Number(element.getAttribute('aria-valuenow'));
      const next = { ArrowRight: now + step, ArrowUp: now + step, ArrowLeft: now - step, ArrowDown: now - step, Home: min, End: max }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      const apply = () => element.setAttribute('aria-valuenow', String(Math.min(max, Math.max(min, next))));
      if (later) queueMicrotask(apply); else apply();
    });
    slider(document.querySelector('#volume'), 1, true);
    slider(document.querySelector('#stepped'), 25, false);
    slider(document.querySelector('#guests'), 1, false);
    // A select-only combobox: clicking opens the list; clicking an option chooses it and closes the list.
    const size = document.querySelector('#size'), sizes = document.querySelector('#size-list');
    size.addEventListener('click', () => { sizes.hidden = !sizes.hidden; size.setAttribute('aria-expanded', String(!sizes.hidden)); });
    sizes.addEventListener('click', event => {
      const option = event.target.closest('[role=option]');
      if (!option || option.getAttribute('aria-disabled') === 'true') return;
      for (const item of sizes.children) item.setAttribute('aria-selected', String(item === option));
      size.textContent = option.textContent; sizes.hidden = true; size.setAttribute('aria-expanded', 'false');
    });
    // An autocomplete that searches after a delay and chooses on mousedown (as react-select does).
    const countries = ['France', 'Finland', 'Fiji', 'Germany', 'Ghana'];
    const country = document.querySelector('#country'), list = document.querySelector('#country-list');
    const show = query => window.setTimeout(() => {
      const matches = countries.filter(name => name.toLowerCase().startsWith(query.toLowerCase()));
      list.innerHTML = matches.map(name => `<li role="option">${name}</li>`).join('');
      list.hidden = !matches.length; country.setAttribute('aria-expanded', String(!list.hidden));
    }, 120);
    country.addEventListener('input', () => show(country.value));
    list.addEventListener('mousedown', event => {
      const option = event.target.closest('[role=option]');
      if (!option) return;
      event.preventDefault();
      country.value = option.textContent; list.hidden = true; country.setAttribute('aria-expanded', 'false');
    });
    const { captureContext } = await import('/src/web/page-context.js');
    const { createController } = await import('/src/web/controller.js');
    const { describeElement } = await import('/src/web/overlay.js');
    window.controller = createController({ window });
    window.capture = () => captureContext(document, { x: 20, y: 20, radius: 2000 });
    window.describeAll = () => window.capture().elements.map(describeElement);
    window.say = async text => {
      const result = window.controller.handle(text, window.capture());
      return await (result.followUp ?? result);
    };
  }, markup);
}

test('custom sliders and spinbuttons are described and set exactly through their keyboard contract', async ({ page }) => {
  await setup(page);
  const described = await page.evaluate(() => window.describeAll());
  expect(described).toContain('Slider: Volume, 20');
  let result = await page.evaluate(() => window.say('set Volume slider to 35'));
  expect(result).toMatchObject({ tone: 'success', message: 'Volume set to 35.' });
  await expect(page.locator('#volume')).toHaveAttribute('aria-valuenow', '35');
  // Nearer the top than the current value: End first, then back down.
  result = await page.evaluate(() => window.say('set volume to ninety'));
  expect(result.tone).toBe('success');
  await expect(page.locator('#volume')).toHaveAttribute('aria-valuenow', '90');
  expect(await page.evaluate(() => window.keys.slice(15))).toEqual(['volume:End', ...Array(10).fill('volume:ArrowLeft')]);
  result = await page.evaluate(() => window.say('undo the volume slider'));
  expect(result.tone).toBe('success');
  await expect(page.locator('#volume')).toHaveAttribute('aria-valuenow', '35');
  result = await page.evaluate(() => window.say('set guests to four'));
  expect(result).toMatchObject({ tone: 'success', message: 'Guests set to 4.' });
  await expect(page.locator('#guests')).toHaveAttribute('aria-valuenow', '4');
});

test('custom sliders refuse values they cannot reach and report when they do not respond', async ({ page }) => {
  await setup(page);
  let result = await page.evaluate(() => window.say('set Brightness slider to 30'));
  expect(result.tone).toBe('error');
  expect(result.message).toContain('moves in steps and cannot be exactly 30; it is now 50');
  result = await page.evaluate(() => window.say('set Volume slider to 150'));
  expect(result).toMatchObject({ tone: 'error', message: '150 is outside Volume’s range of 0 to 100.' });
  await expect(page.locator('#volume')).toHaveAttribute('aria-valuenow', '20');
  result = await page.evaluate(() => window.say('set Balance slider to 7'));
  expect(result).toMatchObject({ tone: 'error', message: 'Balance did not respond to the keyboard; it is 5.' });
});

test('a select-only custom combobox opens, chooses the named option and shows it', async ({ page }) => {
  await setup(page);
  expect(await page.evaluate(() => window.describeAll())).toContain('Dropdown: Size, Medium');
  let result = await page.evaluate(() => window.say('set size to large'));
  expect(result).toMatchObject({ tone: 'success', message: 'Large chosen in Size.' });
  await expect(page.locator('#size')).toHaveText('Large');
  await expect(page.locator('#size-list')).toBeHidden();
  result = await page.evaluate(() => window.say('choose extra from size'));
  expect(result).toMatchObject({ tone: 'success', message: 'Extra large chosen in Size.' });
  // An unknown choice names what is offered and leaves the list open to pick from.
  result = await page.evaluate(() => window.say('set size to tiny'));
  expect(result.tone).toBe('error');
  expect(result.message).toBe('No choice called “tiny” in Size. Shown: Small, Medium, Large, Extra large, Delete my size.');
  await expect(page.locator('#size-list')).toBeVisible();
  // A consequential option name asks first; the disabled option is then refused.
  result = await page.evaluate(() => window.controller.handle('set size to delete my size', window.capture()));
  expect(result.tone).toBe('question');
  result = await page.evaluate(async () => { const r = window.controller.handle('confirm', window.capture()); return await (r.followUp ?? r); });
  expect(result).toMatchObject({ tone: 'error', message: 'Delete my size is unavailable in Size.' });
  await expect(page.locator('#size')).toHaveText('Extra large');
});

test('an autocomplete combobox is typed into, waits for its suggestions and chooses the named one', async ({ page }) => {
  await setup(page);
  let result = await page.evaluate(() => window.say('set country to Finland'));
  expect(result).toMatchObject({ tone: 'success', message: 'Finland chosen in Country.' });
  await expect(page.locator('#country')).toHaveValue('Finland');
  await expect(page.locator('#country-list')).toBeHidden();
  // Several suggestions match: they are named and stay open.
  await page.locator('#country').fill('');
  result = await page.evaluate(() => window.say('set country to F'));
  expect(result).toMatchObject({ tone: 'error', message: 'Several choices match “F”: France, Finland, Fiji. Say “click” and the one you mean.' });
  await expect(page.locator('#country-list')).toBeVisible();
});
