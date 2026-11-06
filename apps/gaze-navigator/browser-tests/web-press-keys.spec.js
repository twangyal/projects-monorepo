import { test, expect } from '@playwright/test';

const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');
async function say(page, text) { await panel(page).getByLabel('Typed instruction').fill(text); await panel(page).getByRole('button', { name: 'Do it', exact: true }).click(); }

test('keys said aloud reach the page: Escape closes a dialog, Tab moves focus, Page Down scrolls, Control+Enter after a yes', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(() => {
    const host = document.getElementById('gaze-web-navigator');
    for (const element of [...document.body.children]) if (element !== host) element.remove();
    const main = document.createElement('main');
    main.innerHTML = `<div id="dialog" role="dialog" aria-label="Cookies">Cookie settings <button>Accept</button></div>
      <label>First <input id="first"></label> <label>Second <input id="second"></label> <label>Third <input id="third"></label>
      <div style="height:3000px">Long page</div>`;
    document.body.prepend(main);
    window.sent = [];
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') document.getElementById('dialog')?.remove();
      if (event.key === 'Enter' && event.ctrlKey) window.sent.push(event.target.id);
    });
  });
  await page.mouse.move(5, 5);
  await say(page, 'press escape');
  await expect(status(page)).toContainText('Pressed Escape.');
  await expect(page.locator('#dialog')).toHaveCount(0);
  // Focus the first field the way a user would, then move with Tab and Shift+Tab.
  await page.locator('#first').focus();
  await say(page, 'press tab');
  await expect(status(page)).toContainText('Pressed Tab: Second has the focus.');
  await expect(page.locator('#second')).toBeFocused();
  await say(page, 'press shift tab');
  await expect(page.locator('#first')).toBeFocused();
  // Control+Enter is asked first, then reaches the focused field.
  await say(page, 'press control enter');
  await expect(status(page)).toContainText('Control+Enter often sends');
  expect(await page.evaluate(() => window.sent)).toEqual([]);
  await say(page, 'confirm');
  await expect.poll(() => page.evaluate(() => window.sent)).toEqual(['first']);
  // Page Down scrolls the page when nothing focused takes it.
  await page.evaluate(() => document.activeElement?.blur());
  const before = await page.evaluate(() => scrollY);
  await say(page, 'press page down');
  await expect(status(page)).toContainText('Pressed Page Down: the page scrolled.');
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(before + 100);
});

test('confirming a modified Enter never retargets a different or detached focused field', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(() => {
    const fields = document.createElement('section');
    fields.innerHTML = '<input id="original-composer"><input id="other-composer">';
    document.body.prepend(fields);
    window.sent = [];
    document.addEventListener('keydown', event => {
      if (event.ctrlKey && event.key === 'Enter') window.sent.push(event.target.id);
    });
  });
  const first = page.locator('#original-composer'), other = page.locator('#other-composer');
  await first.focus(); await say(page, 'press control enter');
  await expect(status(page)).toContainText('Say confirm');
  await other.focus(); await say(page, 'confirm');
  await expect(status(page)).toContainText('focused page target changed');
  expect(await page.evaluate(() => window.sent)).toEqual([]);

  await first.focus(); await say(page, 'press control enter');
  await first.evaluate(node => node.replaceWith(node.cloneNode()));
  await say(page, 'confirm');
  await expect(status(page)).toContainText('focused page target changed');
  expect(await page.evaluate(() => window.sent)).toEqual([]);

  await other.focus(); await say(page, 'press control enter'); await say(page, 'confirm');
  expect(await page.evaluate(() => window.sent)).toEqual(['other-composer']);
});
