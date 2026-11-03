import { test, expect } from '@playwright/test';
const panel = page => page.locator('#gaze-web-navigator section');
async function say(page, text) { await panel(page).getByLabel('Typed instruction').fill(text); await panel(page).getByRole('button', { name: 'Do it', exact: true }).click(); }

test('each field says what it asks for, from its type, autocomplete hint, label or name', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  const kinds = await page.evaluate(async () => {
    document.body.innerHTML = `<form style="margin:20px;display:grid;grid-template-columns:repeat(3,110px);gap:8px">
      <div><label for="street">Street:</label><input id="street" size="8"></div>
      <input type="email" aria-label="Your contact" size="8">
      <input autocomplete="tel" aria-label="Daytime number" size="8">
      <label>Zip code <input name="zipcode" size="8"></label>
      <input aria-label="Address line 1" size="8"><input aria-label="Address line 2" autocomplete="address-line2" size="8">
      <input type="search" aria-label="Search by postcode" size="8"><textarea aria-label="Special instructions" rows="2" cols="8"></textarea>
      <div contenteditable="true" aria-label="Message">Hi</div></form>`;
    const { captureContext } = await import('/src/web/page-context.js');
    const context = captureContext(document, { x: 180, y: 90, radius: 300 });
    return Object.fromEntries(context.elements.filter(element => element.editable).map(element => [element.name, element.holds ?? null]));
  });
  expect(kinds).toEqual({ 'Street:': 'street', 'Your contact': 'email', 'Daytime number': 'tel', 'Zip code': 'postal-code', 'Address line 1': 'street',
    'Address line 2': null, 'Search by postcode': null, 'Special instructions': 'text', Message: 'text' });
});

test('an address and an email address said near the wrong field go to the fields asking for them', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(() => {
    const host = document.getElementById('gaze-web-navigator');
    for (const element of [...document.body.children]) if (element !== host) element.remove();
    const form = document.createElement('div');
    form.style.margin = '40px';
    // Fields stacked closely, as in a dialog, so the gaze circle covers two at once.
    form.innerHTML = ['City:#city', 'Street:#street', 'Name:#name'].map(item => {
      const [label, id] = item.split('#');
      return `<div style="height:36px"><label for="${id}" style="display:inline-block;width:70px">${label}</label><input id="${id}" type="text" style="width:160px"></div>`;
    }).join('') + '<div style="height:36px"><label for="email" style="display:inline-block;width:70px">Email:</label><input id="email" type="email" style="width:160px"></div>';
    document.body.prepend(form);
  });
  const lookAt = async selector => {
    const box = await page.locator(selector).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  };
  await lookAt('#city');
  await say(page, 'type Leeds');
  await expect(page.locator('#city')).toHaveValue('Leeds');
  // The street said while still looking at the city just filled goes to the street field.
  await say(page, 'type 12 High Street');
  await expect(page.locator('#street')).toHaveValue('12 High Street');
  await expect(page.locator('#city')).toHaveValue('Leeds');
  await lookAt('#name');
  await say(page, 'type jo at example dot com');
  await expect(page.locator('#email')).toHaveValue('jo@example.com');
  await expect(page.locator('#name')).toHaveValue('');
});
