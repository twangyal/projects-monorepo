import { expect, test, type Page, type Route } from '@playwright/test';

async function fillCreation(page: Page, title: string) {
  const form = page.locator('#create-form');
  await form.locator('[name=name]').fill('Synthetic host');
  await form.locator('[name=title]').fill(title);
  await form.locator('[name=description]').fill('A synthetic challenge for request recovery.');
  await form.locator('[name=successCriteria]').fill('Complete the original task.');
  await form.locator('[name=evidenceRule]').fill('Describe the original work.');
  await form.locator('[name=deadline]').fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
}
async function create(page: Page) {
  await page.goto('/'); await fillCreation(page, 'Original agreement');
  await page.getByRole('button', { name: 'Propose challenge', exact: true }).click();
  await expect(page.locator('#challenge-status')).toHaveText('proposed');
  return new URL(page.url()).searchParams.get('challenge')!;
}
async function holdResponse(page: Page, path: string) {
  let calls = 0, release!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const handler = async (route: Route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    calls++;
    const response = await route.fetch(); // real server admits/commits the command
    started(); await gate;
    await route.fulfill({ response }).catch(() => {}); // deadline may close the real client
  };
  await page.route(`**${path}`, handler);
  return { ready, release, calls: () => calls };
}

test('timed-out terms keep newer raw drafts and require explicit successful refresh despite polling', async ({ page }) => {
  const id = await create(page);
  await page.clock.install();
  const held = await holdResponse(page, `/api/challenges/${id}/terms`);
  const title = page.locator('#terms-form [name=title]');
  const save = page.getByRole('button', { name: 'Save terms', exact: true });
  await title.fill('Sent agreement'); await save.click(); await held.ready;
  await title.fill('Newer unsent title');
  await page.clock.fastForward(15001);
  await expect(page.locator('#message')).toContainText('may have arrived');
  await expect(title).toHaveValue('Newer unsent title');
  await expect(save).toBeDisabled(); await expect(page.locator('#command-review')).toBeVisible();
  await expect(page.locator('#terms-display')).toContainText('Sent agreement'); // automatic authoritative read
  await page.clock.fastForward(2200);
  await expect(save).toBeDisabled(); expect(held.calls()).toBe(1);
  // A failed explicit read does not unlock another mutation.
  const getPath = `**/api/challenges/${id}`;
  await page.route(getPath, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic outage', code: 'busy' }) }));
  await page.getByRole('button', { name: 'Refresh challenge', exact: true }).click();
  await expect(page.locator('#connection-status')).toContainText('interrupted'); await expect(save).toBeDisabled();
  await page.unroute(getPath);
  await page.getByRole('button', { name: 'Refresh challenge', exact: true }).click();
  await expect(save).toBeEnabled(); await expect(page.locator('#command-review')).toBeHidden();
  await expect(title).toHaveValue('Newer unsent title');
  const notice = await page.locator('#message').textContent();
  held.release(); await page.clock.fastForward(2200);
  await expect(page.locator('#message')).toHaveText(notice!); await expect(title).toHaveValue('Newer unsent title'); expect(held.calls()).toBe(1);
  // Recovery releases normal navigation, while preserving its usual draft warning.
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Back to challenges', exact: true }).click();
  await expect(title).toHaveValue('Newer unsent title');
});

test('a stalled invitation releases busy state without replay or another mutation before review', async ({ page }) => {
  const id = await create(page); await page.clock.install();
  const held = await holdResponse(page, `/api/challenges/${id}/invite`);
  const invite = page.getByRole('button', { name: 'Invite opponent', exact: true });
  await invite.click(); await held.ready; await page.clock.fastForward(15001);
  await expect(page.locator('#command-review')).toBeVisible(); await expect(invite).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save terms', exact: true })).toBeDisabled();
  expect(held.calls()).toBe(1);
  await page.getByRole('button', { name: 'Back to challenges', exact: true }).click();
  await page.locator(`[data-challenge-id="${id}"]`).getByRole('button', { name: 'Open challenge', exact: true }).click();
  await expect(page.locator('#challenge-status')).toHaveText('proposed');
  await expect(invite).toBeDisabled(); await expect(page.locator('#command-review')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh challenge', exact: true }).click();
  await expect(invite).toBeEnabled(); expect(held.calls()).toBe(1);
  held.release(); await page.clock.fastForward(2200);
  await expect(page.locator('#message')).toContainText('No request was replayed');
  await page.getByRole('button', { name: 'Back to challenges', exact: true }).click();
  await expect(page.locator('#create-form')).toBeVisible();
});

test('stalled creation retains a newer draft, releases controls and never adopts late credentials', async ({ page }) => {
  await page.goto('/'); await fillCreation(page, 'Sent creation'); await page.clock.install();
  const held = await holdResponse(page, '/api/challenges');
  const propose = page.getByRole('button', { name: 'Propose challenge', exact: true });
  await propose.click(); await held.ready;
  const title = page.locator('#create-form [name=title]'); await title.fill('Newer creation draft');
  await page.clock.fastForward(15001);
  await expect(page.locator('#message')).toContainText('may have been saved');
  await expect(propose).toBeEnabled(); await expect(title).toHaveValue('Newer creation draft');
  held.release(); await page.clock.fastForward(2200);
  await expect(title).toHaveValue('Newer creation draft'); await expect(page.locator('.workspace')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('friendly-challenges.sessions.v1'))).toBeNull(); expect(held.calls()).toBe(1);
});
