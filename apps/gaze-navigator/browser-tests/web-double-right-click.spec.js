import { test, expect } from '@playwright/test';

const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');
async function say(page, text) { await panel(page).getByLabel('Typed instruction').fill(text); await panel(page).getByRole('button', { name: 'Do it', exact: true }).click(); }

// A file list like a web app's: a file opens on double-click, a folder has the page's own right-click menu.
function addFiles() {
  const host = document.getElementById('gaze-web-navigator');
  for (const element of [...document.body.children]) if (element !== host) element.remove();
  document.body.insertAdjacentHTML('afterbegin', `<main style="padding:40px"><ul style="list-style:none">
    <li><span id="report" role="link" tabindex="0">Trip notes</span></li><li><span id="photos" role="link" tabindex="0">Photos</span></li></ul>
    <div id="menu" role="menu" hidden><button role="menuitem" id="rename">Rename</button><button role="menuitem">Share</button></div><p id="done"></p></main>`);
  const done = text => { document.getElementById('done').textContent = text; };
  document.getElementById('report').addEventListener('dblclick', () => done('Opened Trip notes'));
  document.getElementById('photos').addEventListener('contextmenu', event => { event.preventDefault(); document.getElementById('menu').hidden = false; });
  document.getElementById('rename').addEventListener('click', () => done('Renaming Photos'));
}

test('a file opens on a spoken double-click, and a folder\'s own right-click menu is opened and used', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(addFiles);
  const box = await page.locator('#report').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 4);
  await say(page, 'double click trip notes');
  await expect(page.locator('#done')).toHaveText('Opened Trip notes');
  await say(page, 'right click photos');
  await expect(status(page)).toContainText("Opened the page's menu for Photos");
  await say(page, 'click rename');
  await expect(page.locator('#done')).toHaveText('Renaming Photos');
  // Without a menu of its own, the reply says the browser's menu cannot be opened.
  await say(page, 'right click trip notes');
  await expect(status(page)).toContainText('has no menu of its own on this page');
});

test('confirmed double-click stops before sending events to a renamed or repurposed control', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.id = 'buy-tickets'; link.href = '#original'; link.textContent = 'Buy tickets';
    document.body.prepend(link);
    window.purchaseEvents = [];
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick']) {
      link.addEventListener(type, () => { window.purchaseEvents.push(type); });
    }
  });
  const link = page.locator('#buy-tickets');
  const box = await link.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await say(page, 'double click buy tickets');
  await expect(status(page)).toContainText('Say confirm');
  await link.evaluate(node => { node.href = '#changed'; });
  await say(page, 'confirm');
  await expect(status(page)).toContainText('Nothing was clicked');
  expect(await page.evaluate(() => window.purchaseEvents)).toEqual([]);

  await link.evaluate(node => node.addEventListener('click', () => { node.href = '#unapproved'; }));
  await say(page, 'double click buy tickets');
  await expect(status(page)).toContainText('Say confirm');
  await say(page, 'confirm');
  await expect(status(page)).toContainText('cannot safely open a link');
  expect(await page.evaluate(() => [location.hash, window.purchaseEvents])).toEqual(['', []]);

  await link.evaluate(node => {
    const button = document.createElement('button');
    button.type = 'button'; button.id = node.id; button.textContent = node.textContent;
    node.replaceWith(button);
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick']) {
      button.addEventListener(type, () => window.purchaseEvents.push(type));
    }
    button.addEventListener('click', () => { button.textContent = 'Buy another ticket'; }, { once: true });
  });
  const nextBox = await link.boundingBox();
  await page.mouse.move(nextBox.x + nextBox.width / 2, nextBox.y + nextBox.height / 2);
  await say(page, 'double click buy tickets');
  await expect(status(page)).toContainText('Say confirm');
  await say(page, 'confirm');
  await expect(status(page)).toContainText('Only the first click was sent');
  expect(await page.evaluate(() => window.purchaseEvents)).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);

  await link.evaluate(node => { node.textContent = 'Buy tickets'; window.purchaseEvents = []; });
  await say(page, 'double click buy tickets');
  await expect(status(page)).toContainText('Say confirm');
  await say(page, 'confirm');
  await expect(status(page)).toContainText('Double-clicked Buy tickets');
  const one = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
  expect(await page.evaluate(() => window.purchaseEvents)).toEqual([...one, ...one, 'dblclick']);

  await link.evaluate(node => {
    window.purchaseEvents = [];
    node.addEventListener('pointerdown', () => {
      const parent = document.createElement('a'); parent.href = '#unapproved';
      node.before(parent); parent.append(node);
    }, { once: true });
  });
  await say(page, 'double click buy tickets');
  await expect(status(page)).toContainText('Say confirm');
  await say(page, 'confirm');
  await expect(status(page)).toContainText('Nothing was clicked');
  expect(await page.evaluate(() => [location.hash, window.purchaseEvents])).toEqual(['', ['pointerdown']]);
});
