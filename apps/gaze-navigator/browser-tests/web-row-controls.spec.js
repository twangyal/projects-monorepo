import { test, expect } from '@playwright/test';

// A basket whose rows repeat Quantity, Remove and Save for later, in a list, a table and plain cards.
const markup = `
  <ul id="basket" style="list-style:none;margin:0;padding:20px;width:520px">
    <li id="socks" style="height:36px">Wool socks, grey, £8.00 <select aria-label="Quantity"><option>1</option><option>2</option><option>3</option></select>
      <button>Remove</button> <a href="#later-socks">Save for later</a></li>
    <li id="hat" style="height:36px">Bobble hat, navy, £15.00 <select aria-label="Quantity"><option>1</option><option selected>2</option><option>3</option></select>
      <button>Remove</button> <a href="#later-hat">Save for later</a></li>
    <li id="mug" style="height:36px">Stoneware mug, £12.50 <select aria-label="Quantity"><option>1</option><option>2</option><option>3</option></select>
      <button>Remove</button> <a href="#later-mug">Save for later</a></li>
  </ul>
  <div style="padding:20px;width:520px">
    <div class="card" id="work"><span>Work, 4 Station Road, York</span> <a href="#edit-work">Edit</a></div>
    <div class="card" id="home"><span>Home, 12 Mill Lane, Leeds</span> <a href="#edit-home">Edit</a></div>
  </div>`;

async function setup(page) {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(async markup => {
    document.body.innerHTML = markup;
    for (const button of document.querySelectorAll('#basket button')) button.addEventListener('click', () => button.closest('li').remove());
    const { captureContext } = await import('/src/web/page-context.js');
    const { createController } = await import('/src/web/controller.js');
    window.controller = createController({ window });
    // The gaze circle covers the whole basket and the cards, as webcam error often does.
    window.capture = () => captureContext(document, { x: 280, y: 110, radius: 180 });
    window.say = async text => {
      const result = window.controller.handle(text, window.capture());
      return await (result.followUp ?? result);
    };
  }, markup);
}

test('captured controls carry the text of their row: a list item, or a small card', async ({ page }) => {
  await setup(page);
  const rows = await page.evaluate(() => window.capture().elements.map(element => [element.name, element.row ?? null]));
  expect(rows).toContainEqual(['Remove', expect.stringContaining('Bobble hat, navy, £15.00')]);
  expect(rows).toContainEqual(['Quantity', expect.stringContaining('Stoneware mug')]);
  expect(rows).toContainEqual(['Edit', 'Work, 4 Station Road, York Edit']);
});

test('repeated controls are reached by what their row is about, and a row the page does not have does nothing', async ({ page }) => {
  await setup(page);
  // Remove asks first, since it is hard to undo; the right row's button goes.
  const asked = await page.evaluate(() => window.say('remove the socks'));
  expect(asked.message).toMatch(/confirm|sure|yes/i);
  await page.evaluate(() => window.say('yes'));
  await expect(page.locator('#socks')).toHaveCount(0);
  await expect(page.locator('#hat')).toHaveCount(1);
  // A quantity on the mug's row, and the hat saved for later.
  await page.evaluate(() => window.say('make the mug two'));
  await expect(page.locator('#mug select')).toHaveValue('2');
  await expect(page.locator('#hat select')).toHaveValue('2');
  await page.evaluate(() => window.say('save the hat for later'));
  await expect(page).toHaveURL(/#later-hat$/);
  // Cards without list markup: "edit my work address".
  await page.evaluate(() => window.say('edit my work address'));
  await expect(page).toHaveURL(/#edit-work$/);
  // Nothing here is a scarf: nothing is removed or changed.
  const refused = await page.evaluate(() => window.say('remove the scarf'));
  expect(refused.message).toContain('No row here mentions the scarf');
  await expect(page.locator('#basket li')).toHaveCount(2);
});
