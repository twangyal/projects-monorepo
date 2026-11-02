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
