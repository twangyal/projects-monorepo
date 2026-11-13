import { test, expect } from '@playwright/test';
const panel = page => page.locator('#gaze-web-navigator section');
async function say(page, text) { await panel(page).getByLabel('Typed instruction').fill(text); await panel(page).getByRole('button', { name: 'Do it', exact: true }).click(); }

test('a spoken date fills Day, Month and Year boxes, as on GOV.UK forms', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(() => {
    const host = document.getElementById('gaze-web-navigator');
    for (const element of [...document.body.children]) if (element !== host) element.remove();
    const form = document.createElement('div');
    // The GOV.UK Design System's date input.
    form.innerHTML = `<fieldset role="group" style="margin:40px"><legend>When was your passport issued?</legend>
      <div><label for="passport-issued-day">Day</label><input id="passport-issued-day" name="passport-issued-day" type="text" inputmode="numeric"></div>
      <div><label for="passport-issued-month">Month</label><input id="passport-issued-month" name="passport-issued-month" type="text" inputmode="numeric"></div>
      <div><label for="passport-issued-year">Year</label><input id="passport-issued-year" name="passport-issued-year" type="text" inputmode="numeric"></div></fieldset>
      <label for="notes" style="display:block;margin:150px 40px 0">Notes</label><input id="notes" type="text" style="margin:0 40px">`;
    document.body.prepend(form);
    window.events = 0;
    for (const input of document.querySelectorAll('fieldset input')) input.addEventListener('input', () => window.events++);
  });
  const day = page.locator('#passport-issued-day'), month = page.locator('#passport-issued-month'), year = page.locator('#passport-issued-year');
  const box = await day.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await say(page, 'type the twelfth of March twenty nineteen');
  await expect(panel(page).locator('.status')).toHaveText('When was your passport issued?: 12 March 2019 (day 12, month 3, year 2019).');
  await expect(day).toHaveValue('12'); await expect(month).toHaveValue('3'); await expect(year).toHaveValue('2019');
  expect(await page.evaluate(() => window.events)).toBe(3);
  // Elsewhere, the same words are typed as said. (On small screens the navigator panel covers the second field.)
  if (test.info().project.name !== 'desktop') return;
  await page.locator("#notes").scrollIntoViewIfNeeded(); await page.waitForTimeout(100);
  const notes = await page.locator("#notes").boundingBox();
  await page.mouse.move(notes.x + notes.width / 2, notes.y + notes.height / 2);
  await say(page, 'type 12 March 2019');
  await expect(page.locator('#notes')).toHaveValue('12 March 2019');
});

test('a radio and its separate label are one choice, as on GOV.UK', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(() => {
    const host = document.getElementById('gaze-web-navigator');
    for (const element of [...document.body.children]) if (element !== host) element.remove();
    const form = document.createElement('fieldset');
    form.style.margin = '40px';
    form.innerHTML = '<legend>Where do you live?</legend>' + ['England', 'Scotland', 'Wales'].map((name, i) =>
      `<div style="position:relative;padding-left:50px;height:44px"><input type="radio" name="where" id="where-${i}" value="${name}" style="position:absolute;left:0;width:44px;height:44px;margin:0;opacity:0;cursor:pointer">
       <label for="where-${i}" style="cursor:pointer;display:inline-block;padding:8px">${name}</label></div>`).join('');
    document.body.prepend(form);
  });
  const label = await page.locator('label[for="where-2"]').boundingBox();
  await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
  await say(page, 'choose Wales');
  await expect(page.locator('#where-2')).toBeChecked();
  await expect(panel(page).locator('.prompt button')).toHaveCount(0);
});

async function dateForm(page) {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(async () => {
    document.body.innerHTML = '<fieldset><legend>Passport issued</legend>' + ['Day', 'Month', 'Year'].map((name, index) =>
      `<label>${name}<input id="${name.toLowerCase()}" value="${[1, 2, 2000][index]}"></label>`).join('') + '</fieldset><input id="other" value="safe">';
    const { createController } = await import('/src/web/controller.js');
    const { captureContext } = await import('/src/web/page-context.js');
    window.dateController = createController({ window });
    window.dateCapture = () => {
      const rect = document.querySelector('#day').getBoundingClientRect();
      return captureContext(document, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, radius: 20 });
    };
    window.dateEvents = [];
    for (const field of document.querySelectorAll('fieldset input')) for (const type of ['input', 'change'])
      field.addEventListener(type, () => dateEvents.push([field.id, type, field.value]));
  });
}

for (const effect of ['cancel', 'pause', 'new instruction', 'lock', 'detach', 'override', 'queued override', 'new group', 'legend', 'protected']) {
  test(`date entry stops after the first input causes ${effect}`, async ({ page }) => {
    await dateForm(page);
    const result = await page.evaluate(async effect => {
      const day = document.querySelector('#day'), month = document.querySelector('#month'), year = document.querySelector('#year');
      day.addEventListener('input', () => {
        if (effect === 'cancel' || effect === 'pause') dateController.handle(effect, { elements: [] });
        if (effect === 'new instruction') dateController.handle('help', { elements: [] });
        if (effect === 'lock') year.readOnly = true;
        if (effect === 'detach') month.remove();
        if (effect === 'override') month.value = '8';
        if (effect === 'queued override') queueMicrotask(() => queueMicrotask(() => { day.value = '9'; }));
        if (effect === 'new group') document.body.appendChild(document.createElement('fieldset')).appendChild(year);
        if (effect === 'legend') document.querySelector('legend').textContent = 'Date of birth';
        if (effect === 'protected') month.type = 'password';
      }, { once: true });
      const initial = dateController.handle('type 12 March 2019', dateCapture());
      const settled = await initial.followUp;
      return { initial, settled, events: dateEvents, values: [day.value, month.value, year.value] };
    }, effect);
    expect(result.initial.performed).toBeNull();
    expect(result.events.filter(([, type]) => type === 'input').map(([id]) => id)).toEqual(['day']);
    expect(result.values[2]).toBe('2000');
    if (['cancel', 'pause', 'new instruction'].includes(effect)) expect(result.settled).toBeNull();
    else { expect(result.settled.tone).toBe('error'); expect(result.settled.message).toContain('partial date'); }
  });
}

for (const effect of ['lock', 'redirect', 'value', 'label']) test(`date entry rechecks a ${effect} change from focus before writing`, async ({ page }) => {
  await dateForm(page);
  const result = await page.evaluate(async effect => {
    const day = document.querySelector('#day'), year = document.querySelector('#year');
    day.addEventListener('focus', () => {
      if (effect === 'lock') year.readOnly = true;
      if (effect === 'redirect') document.querySelector('#other').focus();
      if (effect === 'value') year.value = '2030';
      if (effect === 'label') day.setAttribute('aria-label', 'Account number');
    }, { once: true });
    const initial = dateController.handle('type 12 March 2019', dateCapture());
    const settled = await initial.followUp;
    return { settled, events: dateEvents, day: day.value };
  }, effect);
  expect(result.events).toEqual([]);
  expect(result.day).toBe('1');
  expect(result.settled.tone).toBe('error');
  expect(result.settled.message).toContain('No date was entered');
});

test('redirected focus stops the date even when that box already holds the requested value', async ({ page }) => {
  await dateForm(page);
  const result = await page.evaluate(async () => {
    const day = document.querySelector('#day'); day.value = '12';
    day.addEventListener('focus', () => document.querySelector('#other').focus(), { once: true });
    const settled = await dateController.handle('type 12 March 2019', dateCapture()).followUp;
    return { settled, events: dateEvents, month: document.querySelector('#month').value };
  });
  expect(result.settled.tone).toBe('error'); expect(result.events).toEqual([]); expect(result.month).toBe('2');
});

test('a captured date refuses later value changes and a retained date gets a verified final reply', async ({ page }) => {
  await dateForm(page);
  const result = await page.evaluate(async () => {
    const context = dateCapture(); document.querySelector('#year').value = '2020';
    const refused = dateController.handle('type 12 March 2019', context);
    const before = [...dateEvents];
    const initial = dateController.handle('type 12 March 2019', dateCapture());
    const settled = await initial.followUp;
    return { refused, before, initial, settled, events: dateEvents };
  });
  expect(result.refused.tone).toBe('error'); expect(result.before).toEqual([]);
  expect(result.initial.tone).toBe('info'); expect(result.settled.performed).toBe('date-parts');
  expect(result.events).toEqual([['day', 'input', '12'], ['day', 'change', '12'], ['month', 'input', '3'], ['month', 'change', '3'], ['year', 'input', '2019'], ['year', 'change', '2019']]);
});

test('date entry verifies the final field and keeps Undo only for fields actually written', async ({ page }) => {
  await dateForm(page);
  const result = await page.evaluate(async () => {
    const day = document.querySelector('#day'), month = document.querySelector('#month'), year = document.querySelector('#year');
    day.addEventListener('input', () => { year.readOnly = true; }, { once: true });
    const partial = await dateController.handle('type 12 March 2019', dateCapture()).followUp;
    year.readOnly = false;
    const undone = dateController.handle('undo typing', dateCapture());
    const rect = month.getBoundingClientRect();
    const { captureContext } = await import('/src/web/page-context.js');
    const untouched = dateController.handle('undo typing', captureContext(document, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, radius: 20 }));
    year.addEventListener('change', () => queueMicrotask(() => queueMicrotask(() => { year.value = '2030'; })), { once: true });
    const rejected = await dateController.handle('type 12 March 2019', dateCapture()).followUp;
    return { partial, undone, untouched, rejected, day: day.value, year: year.value };
  });
  expect(result.partial.tone).toBe('error'); expect(result.undone.message).toBe('Day: 1');
  expect(result.untouched.message).toBe('Nothing to undo in Month.');
  expect(result.rejected.tone).toBe('error'); expect(result.rejected.message).toContain('partial date');
  expect(result.day).toBe('12'); expect(result.year).toBe('2030');
});
