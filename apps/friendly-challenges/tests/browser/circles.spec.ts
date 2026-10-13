import { expect, test, type Browser, type Page } from '@playwright/test';

async function person(browser: Browser, width = 1280): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage(); page.on('dialog', (dialog) => { void dialog.accept(); });
  return page;
}
async function sharedLink(page: Page, selector: string): Promise<string> {
  await expect(page.locator(selector)).toHaveValue(/#/); return page.locator(selector).inputValue();
}
async function openChallenge(page: Page, title: string) {
  await page.getByRole('button', { name: 'Back to challenges', exact: true }).first().click();
  await page.locator('#challenge-list .record-card', { hasText: title }).getByRole('button', { name: 'Open challenge' }).click();
  await expect(page.locator('#challenge-header, .challenge-header h1').first()).toContainText(title);
}

test('friends follow a challenge only after both participants share it, then cheer and comment', async ({ browser }) => {
  const joe = await person(browser), terry = await person(browser), sam = await person(browser, 390);

  // Joe proposes; Terry claims and accepts.
  await joe.goto('/');
  const create = joe.locator('#create-form');
  await create.locator('[name=name]').fill('Joe'); await create.locator('[name=title]').fill('Finish the 10K');
  await create.locator('[name=description]').fill('Run the city route.'); await create.locator('[name=successCriteria]').fill('Cross the line under an hour.');
  await create.locator('[name=evidenceRule]').fill('A finish time.'); await create.locator('[name=stake]').selectOption('do-the-dishes'); await create.locator('[name=deadline]').fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await joe.getByRole('button', { name: 'Propose challenge', exact: true }).click();
  await joe.getByRole('button', { name: 'Invite opponent', exact: true }).click();
  await terry.goto(await sharedLink(joe, '#shared-link'));
  await terry.locator('#claim-form [name=name]').fill('Terry'); await terry.getByRole('button', { name: 'Claim opponent seat' }).click();
  await terry.getByRole('button', { name: 'Accept these terms', exact: true }).click();
  await expect(terry.locator('#challenge-status')).toHaveText('active');

  // Joe starts a circle; Terry and Sam join with the invitation.
  await joe.getByRole('button', { name: 'Back to challenges', exact: true }).first().click();
  await joe.locator('#circle-create-form [name=circleName]').fill('Running club'); await joe.locator('#circle-create-form [name=name]').fill('Joe');
  await joe.getByRole('button', { name: 'Create circle', exact: true }).click();
  await expect(joe.locator('#circle-name')).toHaveText('Running club');
  const invite = await sharedLink(joe, '#circle-link'); expect(invite).toMatch(/\/\?circle=[0-9a-f]{32}#join=[0-9a-f]{64}$/);
  for (const [page, name] of [[terry, 'Terry'], [sam, 'Sam']] as const) {
    await page.goto(invite); await page.locator('#circle-join-form [name=name]').fill(name);
    await page.getByRole('button', { name: 'Join circle', exact: true }).click();
    await expect(page.locator('#circle-name')).toHaveText('Running club');
    expect(new URL(page.url()).hash).toBe('');
  }
  await expect(sam.locator('#circle-members')).toContainText('Sam (you)');
  await expect(sam.locator('#circle-feed')).toContainText('Nothing here yet');

  // One participant's consent is not enough: the circle learns nothing.
  await openChallenge(joe, 'Finish the 10K');
  await joe.locator('#circle-share').getByRole('button', { name: 'Share with Running club' }).click();
  await expect(joe.locator('#message')).toContainText('once Terry shares it too');
  await expect(joe.locator('#circle-share')).toContainText('only after Terry also shares');
  await sam.getByRole('button', { name: 'Refresh circle' }).click();
  await expect(sam.locator('#message')).toHaveText('Circle refreshed.');
  await expect(sam.locator('#circle-challenges')).not.toContainText('Finish the 10K');

  await openChallenge(terry, 'Finish the 10K');
  await expect(terry.locator('#circle-share')).toContainText('Joe wants to share it with this circle');
  await terry.locator('#circle-share').getByRole('button', { name: 'Share with Running club' }).click();
  await expect(terry.locator('#circle-share')).toContainText('Shared. All 3 members');

  // Sam sees the agreement appear on its own, cheers and comments.
  const agreed = sam.locator('#circle-feed li[data-kind=agreed]');
  await expect(agreed).toContainText('Joe and Terry agreed to “Finish the 10K”. Stake: doing the dishes', { timeout: 10000 });
  await agreed.getByRole('button', { name: 'Cheer: Finish the 10K' }).click();
  await expect(agreed.getByRole('button', { name: 'Remove your cheer for: Finish the 10K' })).toHaveAttribute('aria-pressed', 'true');
  await sam.getByLabel('Comment on “Finish the 10K”').fill('You’ve got this, Terry!');
  await sam.getByRole('button', { name: 'Post comment' }).click();
  await expect(sam.locator('#circle-challenges')).toContainText('You’ve got this, Terry!');
  expect(await sam.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // Progress recorded in the challenge reaches the circle.
  await terry.locator('#evidence-form [name=text]').fill('Crossed at 58:12! Legs are jelly.');
  await terry.getByRole('button', { name: 'Add evidence', exact: true }).click();
  await expect(sam.locator('#circle-feed li[data-kind=progress]')).toContainText('Terry shared progress on “Finish the 10K”: Crossed at 58:12!', { timeout: 10000 });
  await expect(sam.locator('#circle-feed li').first()).toHaveAttribute('data-kind', 'progress');

  // Joe's view shows Sam's cheer and comment; Joe cannot delete it.
  await joe.getByRole('button', { name: 'Back to challenges', exact: true }).first().click();
  await joe.locator('#circle-list .record-card', { hasText: 'Running club' }).getByRole('button', { name: 'Open circle' }).click();
  await expect(joe.locator('#circle-feed li[data-kind=agreed]')).toContainText('Cheered by Sam');
  await expect(joe.locator('#circle-challenges')).toContainText('You’ve got this, Terry!');
  await expect(joe.locator('#circle-challenges').getByRole('button', { name: 'Delete comment' })).toHaveCount(0);

  // The circle response never carries capabilities.
  const reply = await sam.evaluate(async () => {
    const id = new URLSearchParams(location.search).get('circle')!;
    const token = (JSON.parse(localStorage.getItem('friendly-challenges.circles.v1')!) as Record<string, string>)[id]!;
    return (await fetch(`/api/circles/${id}`, { headers: { Authorization: `Bearer ${token}` } })).text();
  });
  expect(reply).not.toMatch(/[0-9a-f]{64}/);

  // Either participant can withdraw; the conversation goes with it.
  await terry.locator('#circle-share').getByRole('button', { name: 'Withdraw from Running club' }).click();
  await expect(terry.locator('#message')).toHaveText('Withdrawn from Running club.');
  await expect(sam.locator('#circle-feed')).toContainText('Nothing here yet', { timeout: 10000 });
  await expect(sam.locator('#circle-challenges')).not.toContainText('You’ve got this');

  // Leaving forgets the circle in that browser.
  await sam.getByRole('button', { name: 'Leave circle' }).click();
  await expect(sam.locator('#message')).toHaveText('You left the circle.');
  await expect(sam.locator('#circle-list')).toContainText('No circles yet');
  await expect(joe.locator('#circle-members')).toContainText('2 of 12 members: Joe (you), Terry', { timeout: 10000 });
});

test('an invalid circle link is removed and explained', async ({ page }) => {
  await page.goto(`/?circle=${'a'.repeat(32)}#join=nope`);
  await expect(page.locator('#message')).toContainText('This circle link is invalid');
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.locator('#circle-join')).toBeHidden();
});
