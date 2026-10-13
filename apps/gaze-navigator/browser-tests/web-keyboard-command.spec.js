import { test, expect } from '@playwright/test';
const panel = page => page.locator('#gaze-web-navigator section');
async function suggestions(page) {
  await page.goto('/practice-site/suggestions.html');
  const field = page.getByLabel('Search people');
  await field.fill('Ada Lov');
  const option = page.getByRole('button', { name: 'Ada Lovelace', exact: true });
  const box = await option.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel(page).locator('.context li')).toContainText(['Button: Ada Lovelace']);
  return field;
}

test('keyboard command selects a blur-dismissed suggestion without changing page text', async ({ page }) => {
  const field = await suggestions(page);
  // The original ordinary typed path really closes this site's menu.
  await panel(page).getByLabel('Typed instruction').fill('open Ada Lovelace');
  await expect(page.locator('#suggestions')).toBeEmpty();
  await field.focus();
  await page.keyboard.press('Alt+Shift+G');
  await page.keyboard.type('open Ada Lovelace');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('Ada Lov');
  await expect(page.getByRole('button', { name: 'Ada Lovelace', exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.notice')).toHaveText('Selected Ada Lovelace');
  await expect(field).toHaveValue('Ada Lov');
  expect(await field.evaluate(element => element.readOnly)).toBe(false);
});

test('keyboard command Escape cancels without dismissing suggestions or editing the page', async ({ page }) => {
  const field = await suggestions(page);
  await page.keyboard.press('Alt+Shift+G');
  await page.keyboard.type('open Ada Lovelace');
  await page.keyboard.press('Escape');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('Ada Lov');
  await expect(page.getByRole('button', { name: 'Ada Lovelace', exact: true })).toBeVisible();
  await expect(page.locator('.notice')).toBeEmpty();
  expect(await field.evaluate(element => element.readOnly)).toBe(false);
  await page.keyboard.type('e');
  await expect(field).toHaveValue('Ada Love');
});

test('keyboard command pagehide and stop release protection and stop capturing', async ({ page }) => {
  for (const action of ['pagehide', 'stop']) {
    const field = await suggestions(page);
    await page.keyboard.press('Alt+Shift+G');
    expect(await field.evaluate(element => element.readOnly)).toBe(true);
    await page.keyboard.type('open Ada Lovelace');
    await page.evaluate(action => {
      if (action === 'stop') window.gazeNavigator.stop();
      else window.dispatchEvent(new PageTransitionEvent('pagehide'));
    }, action);
    expect(await field.evaluate(element => element.readOnly)).toBe(false);
    await page.keyboard.press('Enter');
    await expect(page.locator('.notice')).toBeEmpty();
  }
});

test('keyboard command paste submits while retaining the original ordinary typed draft', async ({ page }) => {
  const field = await suggestions(page);
  await panel(page).getByLabel('Typed instruction').fill('my unfinished draft');
  await field.focus();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('open Ada Lovelace'));
  await page.keyboard.press('Alt+Shift+G');
  await page.keyboard.press('Control+V');
  await expect(panel(page).getByLabel('Typed instruction')).toHaveValue('open Ada Lovelace');
  await expect(field).toHaveValue('Ada Lov');
  await page.keyboard.press('Enter');
  await expect(page.locator('.notice')).toHaveText('Selected Ada Lovelace');
  await expect(panel(page).getByLabel('Typed instruction')).toHaveValue('my unfinished draft');
});

async function suggestionFrame(page) {
  await page.goto('/practice-site/suggestions.html');
  await page.evaluate(() => {
    const frame = document.createElement('iframe'); frame.id = 'suggestion-frame';
    frame.style.cssText = 'position:absolute;left:0;top:0;width:340px;height:175px;background:white';
    frame.srcdoc = `<label>Frame search <input id="search"></label><div id="menu"></div><p id="notice"></p><script>
      const field = document.getElementById('search'), menu = document.getElementById('menu');
      field.oninput = () => { menu.innerHTML = '<button>Ada Lovelace</button>'; };
      field.onblur = () => { menu.innerHTML = ''; };
      menu.onclick = event => { if (event.target.matches('button')) document.getElementById('notice').textContent = 'Selected Ada Lovelace'; };
    <\/script>`;
    document.body.append(frame);
  });
  return page.frameLocator('#suggestion-frame');
}

test('keyboard command works with a focused input in a same-origin frame', async ({ page }) => {
  const frame = await suggestionFrame(page);
  const field = frame.getByLabel('Frame search');
  await field.fill('Ada');
  const box = await frame.getByRole('button', { name: 'Ada Lovelace' }).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel(page).locator('.context li')).toContainText(['Button: Ada Lovelace']);
  await page.keyboard.press('Alt+Shift+G');
  await page.keyboard.type('open Ada Lovelace');
  await expect(field).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(frame.locator('#notice')).toHaveText('Selected Ada Lovelace');
  await expect(field).toHaveValue('Ada');
  expect(await field.evaluate(element => element.readOnly)).toBe(false);
});

test('keyboard command yields to website-owned readonly changes and announces editing', async ({ page }) => {
  const field = await suggestions(page);
  await page.keyboard.press('Alt+Shift+G');
  await page.keyboard.type('cancel');
  await expect(panel(page).locator('.transcript')).toHaveAttribute('aria-live', 'polite');
  await page.keyboard.press('Control+A');
  await expect(panel(page).locator('.transcript')).toContainText('Selected: cancel');
  // Even an explicit reassertion of readonly is a website-owned change. Keep it.
  await field.evaluate(element => element.setAttribute('readonly', ''));
  await expect(panel(page).locator('.status')).toContainText('Keyboard command cancelled');
  expect(await field.evaluate(element => element.readOnly)).toBe(true);
  await expect(panel(page).locator('.transcript')).toHaveAttribute('aria-live', 'off');
  await expect(page.locator('.notice')).toBeEmpty();
});

test('child-frame navigation releases the old field and ends keyboard capture', async ({ page }) => {
  const frame = await suggestionFrame(page), field = frame.getByLabel('Frame search');
  await field.fill('Ada');
  await page.keyboard.press('Alt+Shift+G');
  expect(await field.evaluate(element => element.readOnly)).toBe(true);
  await page.evaluate(() => {
    const iframe = document.getElementById('suggestion-frame');
    window.__oldFrameInput = iframe.contentDocument.getElementById('search');
    iframe.srcdoc = '<label>New frame field <input></label>';
  });
  const replacement = frame.getByLabel('New frame field');
  await expect(replacement).toBeVisible();
  expect(await page.evaluate(() => window.__oldFrameInput.readOnly)).toBe(false);
  await replacement.focus();
  await page.keyboard.type('ordinary typing');
  await expect(replacement).toHaveValue('ordinary typing');
  await expect(panel(page).locator('.status')).toContainText('Keyboard command cancelled');
});
