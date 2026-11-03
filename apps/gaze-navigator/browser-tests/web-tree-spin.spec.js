import { test, expect } from '@playwright/test';
const panel = page => page.locator('#gaze-web-navigator section');
async function say(page, text) { await panel(page).getByLabel('Typed instruction').fill(text); await panel(page).getByRole('button', { name: 'Do it', exact: true }).click(); }
async function look(page, locator) { const box = await locator.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); }

// Older widgets (including WAI-ARIA example code) read the legacy keyCode, not key.
async function setup(page) {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(() => {
    const host = document.getElementById('gaze-web-navigator');
    for (const element of [...document.body.children]) if (element !== host) element.remove();
    const area = document.createElement('div');
    area.style.cssText = 'margin:40px';
    area.innerHTML = `<ul role="tree" aria-label="Files"><li role="treeitem" aria-expanded="false" tabindex="0"><span>Projects</span>
        <ul role="group" hidden><li role="treeitem" tabindex="-1">project-1.docx</li></ul></li></ul>
      <div style="margin-top:120px"><span id="day-label">Day</span> <div role="spinbutton" tabindex="0" aria-labelledby="day-label" aria-valuenow="3" aria-valuemin="1" aria-valuemax="31">3</div></div>`;
    document.body.prepend(area);
    const item = area.querySelector('[role=treeitem]'), group = item.querySelector('[role=group]');
    item.addEventListener('keydown', event => {
      if (event.target !== item || ![37, 39].includes(event.keyCode)) return;
      const open = event.keyCode === 39;
      item.setAttribute('aria-expanded', String(open)); group.hidden = !open; event.preventDefault();
    });
    const spin = area.querySelector('[role=spinbutton]');
    spin.addEventListener('keydown', event => {
      const step = { 38: 1, 40: -1 }[event.keyCode];
      if (!step) return;
      const value = Math.min(31, Math.max(1, Number(spin.getAttribute('aria-valuenow')) + step));
      spin.setAttribute('aria-valuenow', String(value)); spin.textContent = String(value); event.preventDefault();
    });
  });
}

test('a tree item opens and closes with its arrow keys, as trees promise', async ({ page }) => {
  await setup(page);
  const item = page.locator('[role=treeitem]').first();
  await look(page, page.locator('[role=treeitem] > span').first());
  await say(page, 'expand projects');
  await expect(item).toHaveAttribute('aria-expanded', 'true');
  await expect(panel(page).locator('.status')).toHaveText('Tree item expanded.');
  await say(page, 'collapse projects');
  await expect(item).toHaveAttribute('aria-expanded', 'false');
});

test('a spin button that reads keyCode is set to a spoken value', async ({ page }) => {
  await setup(page);
  const spin = page.getByRole('spinbutton', { name: 'Day' });
  await look(page, spin);
  await say(page, 'set day to 15');
  await expect(spin).toHaveAttribute('aria-valuenow', '15');
  await expect(panel(page).locator('.status')).toHaveText('Day set to 15.');
});
