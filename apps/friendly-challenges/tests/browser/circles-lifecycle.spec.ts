import { expect, test, type Page } from '@playwright/test';

async function seededCircle(page: Page) {
  await page.goto('/');
  const data = await page.evaluate(async () => {
    const post = async (path: string, body: unknown, token?: string) => (await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })).json();
    const c = await post('/api/challenges', { name: 'A', terms: { title: 'Draft race', description: 'Run', successCriteria: 'Finish', evidenceRule: 'Tell us', stake: 'bragging-rights', deadline: Date.now() + 86400000 } });
    const b = await post(`/api/challenges/${c.challengeId}/join`, { name: 'B', inviteToken: c.inviteToken });
    await post(`/api/challenges/${c.challengeId}/accept`, { revision: 2, termsVersion: 1 }, b.token);
    const circle = await post('/api/circles', { circleName: 'Draft club', name: 'A' });
    await post(`/api/circles/${circle.circleId}/share`, { challengeId: c.challengeId, seatToken: c.token }, circle.token);
    await post(`/api/circles/${circle.circleId}/share`, { challengeId: c.challengeId, seatToken: b.token }, circle.token);
    localStorage.setItem('friendly-challenges.circles.v1', JSON.stringify({ [circle.circleId]: circle.token }));
    localStorage.setItem('friendly-challenges.sessions.v1', JSON.stringify({ [c.challengeId]: c.token }));
    return { circleId: circle.circleId, token: circle.token, challengeId: c.challengeId, seat: c.token };
  });
  await page.goto(`/?circle=${data.circleId}`);
  await expect(page.getByLabel('Comment on “Draft race”')).toBeVisible();
  return data;
}

test('a delayed comment preserves text edited after submission', async ({ page }) => {
  await seededCircle(page);
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  let received!: () => void; const started = new Promise<void>((resolve) => { received = resolve; });
  await page.route('**/api/circles/*/comment', async (route) => { const reply = await route.fetch(); received(); await delayed; await route.fulfill({ response: reply }); });
  const draft = page.getByLabel('Comment on “Draft race”');
  await draft.fill('Submitted text'); await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await started; await draft.fill('New unsent text'); release();
  await expect(page.locator('.circle-comments')).toContainText('Submitted text');
  await expect(draft).toHaveValue('New unsent text');
});

test('a changed circle refresh preserves comment focus and caret', async ({ page }) => {
  const data = await seededCircle(page); const draft = page.getByLabel('Comment on “Draft race”');
  await draft.fill('Keep editing'); await draft.evaluate((node: HTMLTextAreaElement) => { node.focus(); node.setSelectionRange(2, 6); });
  await page.evaluate(async ({ circleId, token, challengeId }) => { await fetch(`/api/circles/${circleId}/comment`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ challengeId, text: 'Other comment' }) }); }, data);
  await expect(page.locator('.circle-comments')).toContainText('Other comment', { timeout: 10000 });
  await expect(draft).toBeFocused();
  expect(await draft.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 6]);
});

test('an incoming remembered circle link asks before discarding challenge drafts', async ({ page }) => {
  const data = await seededCircle(page);
  await page.goto(`/?challenge=${data.challengeId}#access=${data.seat}`);
  const use = page.getByRole('button', { name: 'Use this private access link', exact: true });
  if (await use.isVisible()) await use.click();
  const draft = page.locator('#evidence-form [name=text]');
  await expect(draft).toBeVisible(); await draft.fill('Unsent challenge draft');
  let warned = false; page.on('dialog', async (dialog) => { warned = true; await dialog.dismiss(); });
  await page.evaluate(({ circleId, token }) => { history.replaceState(null, '', `/?circle=${circleId}`); location.hash = `member=${token}`; }, data);
  await expect(draft).toHaveValue('Unsent challenge draft');
  await expect(draft).toBeVisible(); expect(warned).toBe(true);
});
