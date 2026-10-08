import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Snapshot } from '../../src/types';

const sessionsKey = 'friendly-challenges.sessions.v1';

async function credentials(page: Page) {
  await expect.poll(() => new URL(page.url()).searchParams.get('challenge')).toMatch(/^[a-f0-9]{32}$/);
  const challengeId = new URL(page.url()).searchParams.get('challenge')!;
  const read = () => page.evaluate(({ key, id }) => {
    const sessions = JSON.parse(localStorage.getItem(key) || '{}') as Record<string, string>;
    return sessions[id];
  }, { key: sessionsKey, id: challengeId });
  await expect.poll(read).toMatch(/^[a-f0-9]{64}$/);
  const token = await read();
  expect(challengeId).toMatch(/^[a-f0-9]{32}$/);
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  return { challengeId, token };
}

async function snapshot(page: Page): Promise<Snapshot> {
  const { challengeId, token } = await credentials(page);
  const response = await page.request.get(`/api/challenges/${challengeId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(200);
  return response.json() as Promise<Snapshot>;
}

async function command(page: Page, action: string, body: Record<string, unknown>) {
  const { challengeId, token } = await credentials(page);
  return page.request.post(`/api/challenges/${challengeId}/${action}`, {
    data: body, headers: { Authorization: `Bearer ${token}` },
  });
}

async function waitForDisplayedRevision(page: Page) {
  const current = await snapshot(page);
  await expect(page.locator('#challenge-revision')).toContainText(`Revision ${current.revision} ·`);
}

async function downloadRecord(page: Page) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export record', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^friendly-challenge-[a-f0-9]{32}\.json$/);
  const raw = await readFile((await download.path())!, 'utf8');
  return { raw, record: JSON.parse(raw) as { schemaVersion: number; challenge: Snapshot } };
}

async function consumeLink(page: Page, link: string) {
  await page.goto(link);
  await expect.poll(() => new URL(page.url()).hash).toBe('');
}

function observe(page: Page, baseURL: string) {
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).origin !== new URL(baseURL).origin) external.push(request.url());
  });
  return { errors, external };
}

async function propose(page: Page, title: string) {
  await page.goto('/');
  const form = page.locator('#create-form');
  await form.locator('[name=name]').fill('Alex');
  await form.locator('[name=title]').fill(title);
  await form.locator('[name=description]').fill('We will each finish an original small drawing.');
  await form.locator('[name=successCriteria]').fill('Finish and share the drawing before the agreed deadline.');
  await form.locator('[name=evidenceRule]').fill('Describe the work and supply an optional public reference.');
  await form.locator('[name=stake]').selectOption('pick-a-movie');
  await form.locator('[name=deadline]').fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await form.getByRole('button', { name: 'Propose challenge', exact: true }).click();
  await expect(page.locator('#shared-link')).toHaveValue(/#invite=[a-f0-9]{64}$/);
  return page.locator('#shared-link').inputValue();
}

async function create(page: Page, title: string) {
  const invite = await propose(page, title);
  expect((await snapshot(page)).status).toBe('proposed');
  return invite;
}

async function claim(page: Page, invite: string, arbiter = false) {
  await consumeLink(page, invite);
  await page.locator('#claim-form [name=name]').fill(arbiter ? 'Taylor' : 'Sam');
  await page.getByRole('button', { name: arbiter ? 'Claim arbiter seat' : 'Claim opponent seat', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).myRole).toBe(arbiter ? 'arbiter' : 'opponent');
}

async function accept(page: Page) {
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Accept these terms', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).status).toBe('active');
}

async function evidence(page: Page, text: string, url = '') {
  await waitForDisplayedRevision(page);
  const form = page.locator('#evidence-form');
  await form.locator('[name=text]').fill(text);
  await form.locator('[name=url]').fill(url);
  await form.getByRole('button', { name: 'Add evidence', exact: true }).click();
  await expect(page.locator('#evidence-list')).toContainText(text);
}

async function proposeResult(page: Page, outcome: 'proposer' | 'opponent', reason: string) {
  await waitForDisplayedRevision(page);
  const form = page.locator('#result-form');
  await form.locator('[name=outcome]').selectOption(outcome);
  await form.locator('[name=reason]').fill(reason);
  await form.getByRole('button', { name: 'Propose result', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).resultProposal?.reason).toBe(reason);
}

test('two independent parties record evidence, mutually settle, reopen and export an immutable record', async ({ page, browser, baseURL }) => {
  const observed = observe(page, baseURL!);
  const invitation = await create(page, 'A drawing each');
  const context = await browser.newContext({ baseURL }), opponent = await context.newPage();
  const guestObserved = observe(opponent, baseURL!);
  try {
    await claim(opponent, invitation);
    expect((await snapshot(opponent)).status).toBe('proposed');
    await expect(page.getByRole('button', { name: 'Accept these terms', exact: true })).toHaveCount(0);
    await accept(opponent);
    await evidence(page, '<script>Original pencil sketch</script>\nFirst version: a token of effort.', 'https://example.com/drawing#first');
    await evidence(opponent, 'My first draft.');
    await evidence(opponent, 'Correction: the final drawing is now complete.');
    await expect(page.locator('#evidence-list')).toContainText('Correction:');
    expect(await page.locator('#evidence-list script').count()).toBe(0);
    const link = page.locator('#evidence-list a');
    await expect(link).toHaveAttribute('href', 'https://example.com/drawing#first');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(page.locator('#evidence-list')).toContainText('not fetched or verified');
    await proposeResult(page, 'opponent', 'Sam completed the agreed drawing first.');
    await expect(page.getByRole('button', { name: 'Agree with result', exact: true })).toHaveCount(0);
    await expect(opponent.getByRole('button', { name: 'Agree with result', exact: true })).toBeVisible();
    opponent.once('dialog', dialog => dialog.accept());
    await opponent.getByRole('button', { name: 'Agree with result', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).status).toBe('resolved');
    const final = await snapshot(page);
    expect(final.resolution).toMatchObject({ outcome: 'opponent', method: 'mutual', by: 'opponent', reason: 'Sam completed the agreed drawing first.' });
    expect(final.evidence.map(entry => entry.author)).toEqual(['proposer', 'opponent', 'opponent']);
    expect(final.events.map(event => event.kind)).toContain('result_responded');
    const refused = await command(page, 'evidence', { revision: final.revision, text: 'Too late to change the record', url: null });
    expect(refused.status()).toBe(409);
    const { record, raw } = await downloadRecord(page);
    expect(record.schemaVersion).toBe(1);
    expect(record.challenge.evidence).toEqual(final.evidence);
    expect(record.challenge.events).toEqual(final.events);
    expect(record.challenge.resolution).toEqual(final.resolution);
    const privateValues = [
      (await credentials(page)).token, (await credentials(opponent)).token,
      new URL(invitation).hash.slice('#invite='.length),
    ];
    for (const value of privateValues) {
      expect(raw).not.toContain(value);
      expect(raw).not.toContain(createHash('sha256').update(value).digest('hex'));
    }
    expect(Object.keys(record).sort()).toEqual(['challenge', 'exportedAt', 'schemaVersion']);
    expect(Object.keys(record.challenge).sort()).toEqual(Object.keys(final).filter(key => key !== 'myRole' && key !== 'serverTime').sort());
    expect(raw).toContain('a token of effort');
    await page.reload();
    await expect(page.locator('#evidence-list')).toContainText('Original pencil sketch');
    expect((await snapshot(page)).events).toEqual(final.events);
    await expect(page.getByRole('button', { name: 'Add evidence', exact: true })).toHaveCount(0);
    expect(observed.errors).toEqual([]); expect(guestObserved.errors).toEqual([]);
    expect(observed.external).toEqual([]); expect(guestObserved.external).toEqual([]);
    await page.screenshot({ path: '/tmp/friendly-desktop.png', fullPage: true });
  } finally { await context.close(); }
});

test('storage failure leaves a usable in-memory seat with explicit private-link recovery', async ({ page, browser, baseURL }) => {
  await page.addInitScript(key => {
    const original = Storage.prototype.setItem;
    Object.defineProperty(window, 'restoreChallengeStorage', { value: () => { Storage.prototype.setItem = original; } });
    Storage.prototype.setItem = function (name: string, value: string) {
      if (name === key) throw new DOMException('Storage is unavailable', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, sessionsKey);
  await propose(page, 'Keep the private key');
  await expect(page.locator('#message')).toContainText(/storage|save|private.*link/i);
  expect(await page.evaluate(key => localStorage.getItem(key), sessionsKey)).toBeNull();
  await page.getByRole('button', { name: 'My private access link', exact: true }).click();
  const recovery = await page.locator('#shared-link').inputValue();
  const creation = { challengeId: new URL(recovery).searchParams.get('challenge')!, token: new URL(recovery).hash.slice('#access='.length) };
  expect(creation.challengeId).toMatch(/^[a-f0-9]{32}$/); expect(creation.token).toMatch(/^[a-f0-9]{64}$/);
  const exported = await downloadRecord(page);
  expect(exported.record.challenge.terms.title).toBe('Keep the private key');
  expect(exported.raw).not.toContain(creation.token);
  await expect(page.locator('#access-recovery')).toBeVisible();
  await page.locator('#terms-form [name=title]').fill('Keep access after a normal action');
  await page.getByRole('button', { name: 'Save terms', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Terms updated');
  await expect(page.locator('#access-recovery')).toBeVisible();
  await page.getByRole('button', { name: 'Retry saving access', exact: true }).click();
  await expect(page.locator('#access-recovery')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), sessionsKey)).toBeNull();
  await page.evaluate(() => (window as unknown as { restoreChallengeStorage: () => void }).restoreChallengeStorage());
  await page.getByRole('button', { name: 'Retry saving access', exact: true }).click();
  await expect(page.locator('#access-recovery')).toBeHidden();
  expect((await credentials(page)).token).toBe(creation.token);
  await page.reload();
  await expect(page.locator('#terms-form [name=title]')).toHaveValue('Keep access after a normal action');
  expect((await credentials(page)).token).toBe(creation.token);
  const context = await browser.newContext({ baseURL }), restored = await context.newPage();
  try {
    await consumeLink(restored, recovery);
    await restored.getByRole('button', { name: 'Use this private access link', exact: true }).click();
    await expect.poll(async () => (await snapshot(restored)).myRole).toBe('proposer');
    expect((await credentials(restored)).token).toBe(creation.token);
    await restored.reload();
    await expect(restored.locator('#challenge-status')).toContainText(/proposed/i);
    expect((await snapshot(restored)).terms.title).toBe('Keep access after a normal action');
  } finally { await context.close(); }
});

test('mobile decline and withdrawal remain explicit terminal records with no invented winner', async ({ page, browser, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const observed = observe(page, baseURL!);
  const invitation = await create(page, 'A proposal we can decline');
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } }), opponent = await context.newPage();
  try {
    await claim(opponent, invitation);
    await opponent.locator('#decline-form [name=reason]').fill('This deadline will not work for me.');
    opponent.once('dialog', dialog => dialog.accept());
    await opponent.getByRole('button', { name: 'Decline challenge', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).status).toBe('declined');
    expect((await snapshot(opponent)).resolution).toBeNull();
    await opponent.reload();
    await expect(opponent.locator('#activity-list')).toContainText('This deadline will not work for me.');
    for (const member of [page, opponent]) {
      expect(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.screenshot({ path: '/tmp/friendly-mobile.png', fullPage: true });
    const existing = await credentials(page);
    let release!: () => void, received!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const issued = new Promise<void>(resolve => { received = resolve; });
    await page.route('**/api/challenges', async route => {
      const response = await route.fetch(); received(); await gate;
      await route.fulfill({ response });
    });
    const creating = create(page, 'A proposal I withdraw');
    try {
      await issued;
      await page.locator(`[data-challenge-id="${existing.challengeId}"]`).getByRole('button', { name: 'Open challenge', exact: true }).click();
      await expect(page.locator('#message')).toContainText(/finish|wait/i);
      expect(new URL(page.url()).search).toBe('');
      release(); await creating;
    } finally { release(); await page.unroute('**/api/challenges'); }
    await page.locator('#withdraw-form [name=reason]').fill('I cannot complete this as proposed.');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Withdraw challenge', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).status).toBe('withdrawn');
    expect((await snapshot(page)).resolution).toBeNull();
    expect(observed.errors).toEqual([]); expect(observed.external).toEqual([]);
  } finally { await context.close(); }
});

test('reissuing an invitation invalidates the old link without replacing a claimed seat', async ({ page, browser, baseURL }) => {
  const oldInvitation = await create(page, 'A replacement invitation');
  await page.getByRole('button', { name: 'Invite opponent', exact: true }).click();
  await expect.poll(() => page.locator('#shared-link').inputValue()).not.toBe(oldInvitation);
  const invitation = await page.locator('#shared-link').inputValue();
  const context = await browser.newContext({ baseURL }), opponent = await context.newPage();
  try {
    await consumeLink(opponent, oldInvitation);
    await opponent.locator('#claim-form [name=name]').fill('Sam');
    await opponent.getByRole('button', { name: 'Claim opponent seat', exact: true }).click();
    await expect(opponent.locator('#message')).toContainText(/invite|invitation|available/i);
    expect((await snapshot(page)).profiles.opponent).toBeNull();
    await claim(opponent, invitation);
    const after = await snapshot(page);
    expect(after.profiles.opponent?.name).toBe('Sam');
    expect(after.events.filter(event => event.kind === 'opponent_joined')).toHaveLength(1);
    await expect(page.getByRole('button', { name: 'Invite opponent', exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});

test('real deadline passage changes only the display and later evidence is recorded as late', async ({ page, browser, baseURL }) => {
  test.setTimeout(30000);
  // This focused deadline fixture uses the production API and real wall clock;
  // no browser state or service clock is substituted.
  const created = await page.request.post('/api/challenges', { data: {
    name: 'Alex', terms: {
      title: 'The passing deadline', description: 'Record both sides of a deadline.',
      successCriteria: 'Supply the agreed statement.', evidenceRule: 'Text supplied by each party.',
      stake: 'bragging-rights', deadline: Date.now() + 10000,
    },
  } });
  expect(created.status()).toBe(201);
  const creation = await created.json() as { challengeId: string; token: string; inviteToken: string };
  await consumeLink(page, `${baseURL}/?challenge=${creation.challengeId}#access=${creation.token}`);
  await page.getByRole('button', { name: 'Use this private access link', exact: true }).click();
  const context = await browser.newContext({ baseURL }), opponent = await context.newPage();
  try {
    await claim(opponent, `${baseURL}/?challenge=${creation.challengeId}#invite=${creation.inviteToken}`);
    await accept(opponent); await evidence(page, 'Submitted before the deadline.');
    const before = await snapshot(page);
    expect(before.deadlinePassed).toBe(false); expect(before.evidence[0].late).toBe(false);
    await expect.poll(async () => (await snapshot(page)).deadlinePassed, { timeout: 15000 }).toBe(true);
    const after = await snapshot(page);
    expect(after.revision).toBe(before.revision); expect(after.status).toBe('active');
    expect(after.resolution).toBeNull(); expect(after.events).toEqual(before.events);
    await evidence(opponent, 'A later correction supplied after the deadline.');
    await expect(page.locator('#evidence-list')).toContainText(/late/i);
    const final = await snapshot(opponent);
    expect(final.evidence.map(entry => entry.late)).toEqual([false, true]);
    expect(final.status).toBe('active');
    const proposed = await page.request.post('/api/challenges', { data: {
      name: 'Alex', terms: { ...final.terms, title: 'A proposal revised after its deadline', deadline: Date.now() + 1500 },
    } });
    expect(proposed.status()).toBe(201);
    const expired = await proposed.json() as { challengeId: string; token: string };
    await consumeLink(page, `${baseURL}/?challenge=${expired.challengeId}#access=${expired.token}`);
    await page.getByRole('button', { name: 'Use this private access link', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).deadlinePassed).toBe(true);
    await waitForDisplayedRevision(page);
    await page.locator('#terms-form [name=deadline]').fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
    await page.getByRole('button', { name: 'Save terms', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).termsVersion).toBe(2);
    const revised = await snapshot(page);
    expect(revised.status).toBe('proposed'); expect(revised.deadlinePassed).toBe(false);
    expect(revised.resolution).toBeNull(); expect(revised.events.map(event => event.kind)).toEqual(['created', 'terms_edited']);
  } finally { await context.close(); }
});

test('a disputed result needs mutual arbiter consent and a separate third capability to decide', async ({ page, browser, baseURL }) => {
  const invitation = await create(page, 'The disputed sketch');
  const context = await browser.newContext({ baseURL }), opponent = await context.newPage();
  const arbiterContext = await browser.newContext({ baseURL }), arbiter = await arbiterContext.newPage();
  try {
    await claim(opponent, invitation); await accept(opponent);
    await evidence(page, 'I finished before lunch.'); await evidence(opponent, 'My drawing was finished first.');
    await proposeResult(page, 'proposer', 'Alex finished first.');
    await opponent.locator('#result-response-form [name=reason]').fill('We disagree about the order.');
    await opponent.getByRole('button', { name: 'Dispute result', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).status).toBe('disputed');
    await page.locator('#arbiter-form [name=name]').fill('Taylor');
    await page.locator('#arbiter-form [name=reason]').fill('Taylor can review our two statements.');
    await page.getByRole('button', { name: 'Nominate arbiter', exact: true }).click();
    await expect.poll(async () => (await snapshot(opponent)).arbiterNomination?.status).toBe('pending');
    let current = await snapshot(page);
    expect((await command(page, 'invite', { revision: current.revision, seat: 'arbiter' })).status()).toBe(409);
    opponent.once('dialog', dialog => dialog.accept());
    await opponent.getByRole('button', { name: 'Approve arbiter', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).arbiterNomination?.status).toBe('approved');
    await page.getByRole('button', { name: 'Invite arbiter', exact: true }).click();
    await expect(page.locator('#shared-link')).toHaveValue(/#arbiter=[a-f0-9]{64}$/);
    const arbiterInvitation = await page.locator('#shared-link').inputValue();
    await claim(arbiter, arbiterInvitation, true);
    current = await snapshot(page);
    const forbidden = await command(page, 'arbiter/decide', { revision: current.revision, outcome: 'proposer', reason: 'Creator cannot act as Taylor.' });
    expect(forbidden.status()).toBe(403);
    await expect(arbiter.getByRole('button', { name: 'Add evidence', exact: true })).toHaveCount(0);
    await arbiter.locator('#decision-form [name=outcome]').selectOption('opponent');
    await arbiter.locator('#decision-form [name=reason]').fill('The supplied record supports Sam finishing first.');
    arbiter.once('dialog', dialog => dialog.accept());
    await arbiter.getByRole('button', { name: 'Record decision', exact: true }).click();
    await expect.poll(async () => (await snapshot(opponent)).status).toBe('resolved');
    const final = await snapshot(arbiter);
    expect(final.resolution).toMatchObject({ method: 'arbiter', by: 'arbiter', outcome: 'opponent', proposalId: null });
    expect(final.profiles.arbiter?.name).toBe('Taylor');
    expect(final.events.filter(event => event.kind === 'arbiter_decided')).toHaveLength(1);
    await arbiter.reload();
    await expect(arbiter.locator('#challenge-status')).toContainText(/resolved/i);
    expect((await snapshot(arbiter)).resolution).toEqual(final.resolution);
  } finally { await context.close(); await arbiterContext.close(); }
});

test('edited terms reject stale acceptance and require explicit review without erasing a draft', async ({ page, browser, baseURL }) => {
  const invitation = await create(page, 'Terms to review');
  const context = await browser.newContext({ baseURL }), opponent = await context.newPage();
  try {
    await claim(opponent, invitation);
    await waitForDisplayedRevision(page);
    const { challengeId } = await credentials(page), polling = `**/api/challenges/${challengeId}`;
    await opponent.route(polling, route => route.request().method() === 'GET' ? route.abort('failed') : route.continue());
    await opponent.locator('#decline-form [name=reason]').fill('A private note I have not submitted.');
    await page.locator('#terms-form [name=successCriteria]').fill('Finish two original drawings and share both.');
    await page.getByRole('button', { name: 'Save terms', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).termsVersion).toBe(2);
    const stale = opponent.waitForResponse(response => response.url().endsWith('/accept'));
    opponent.once('dialog', dialog => dialog.accept());
    await opponent.getByRole('button', { name: 'Accept these terms', exact: true }).click();
    expect((await stale).status()).toBe(409);
    expect((await snapshot(page)).status).toBe('proposed');
    await expect(opponent.locator('#decline-form [name=reason]')).toHaveValue('A private note I have not submitted.');
    await opponent.unroute(polling);
    await expect(opponent.getByRole('button', { name: 'Review updated terms', exact: true })).toBeVisible();
    await expect(opponent.getByRole('button', { name: 'Accept these terms', exact: true })).toBeDisabled();
    await opponent.getByRole('button', { name: 'Review updated terms', exact: true }).click();
    await accept(opponent);
    const final = await snapshot(opponent);
    expect(final.events.filter(event => event.kind === 'accepted')).toEqual([
      expect.objectContaining({ details: { termsVersion: 2 } }),
    ]);
    expect(final.terms.successCriteria).toBe('Finish two original drawings and share both.');
  } finally { await context.close(); }
});

test('polls and reconnection preserve focused evidence and a failed command is never replayed', async ({ page, browser, baseURL }) => {
  const invitation = await create(page, 'An unfinished statement');
  const context = await browser.newContext({ baseURL }), opponent = await context.newPage();
  try {
    await claim(opponent, invitation); await accept(opponent);
    const draft = page.locator('#evidence-form [name=text]');
    await draft.fill('Still composing my statement.');
    await evidence(opponent, 'A separate completed statement.');
    await expect(page.locator('#evidence-list')).toContainText('A separate completed statement.');
    await expect(draft).toHaveValue('Still composing my statement.');
    await draft.focus();
    const { challengeId } = await credentials(page), polling = `**/api/challenges/${challengeId}`;
    await page.route(polling, route => route.request().method() === 'GET' ? route.abort('failed') : route.continue());
    await expect(page.locator('#connection-status')).toContainText(/retry|disconnect|paused|interrupt|reconnect/i);
    await expect(draft).toBeFocused();
    await expect(draft).toHaveValue('Still composing my statement.');
    await page.route(`**/api/challenges/${challengeId}/evidence`, route => route.abort('failed'));
    await page.getByRole('button', { name: 'Add evidence', exact: true }).click();
    await expect(page.locator('#message')).toContainText(/network|connect|failed|reach|confirm/i);
    await expect(draft).toHaveValue('Still composing my statement.');
    await page.unroute(`**/api/challenges/${challengeId}/evidence`); await page.unroute(polling);
    await expect(page.locator('#connection-status')).toContainText(/connected/i);
    expect((await snapshot(page)).evidence).toHaveLength(1);
    await page.getByRole('button', { name: 'Add evidence', exact: true }).click();
    await expect(page.locator('#evidence-list')).toContainText('Still composing my statement.');
    expect((await snapshot(page)).evidence).toHaveLength(2);
    let release!: () => void, received!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const published = new Promise<void>(resolve => { received = resolve; });
    await page.route(`**/api/challenges/${challengeId}/evidence`, async route => {
      const response = await route.fetch(); received(); await gate;
      await route.fulfill({ response });
    });
    try {
      await draft.fill('The statement submitted in this request.');
      await page.locator('#evidence-form [name=url]').fill('');
      await page.getByRole('button', { name: 'Add evidence', exact: true }).click();
      await published;
      await draft.fill('A new unsent draft typed while the response is pending.');
      release();
      await expect(page.locator('#evidence-list')).toContainText('The statement submitted in this request.');
      await expect(draft).toHaveValue('A new unsent draft typed while the response is pending.');
      const completed = await snapshot(page);
      expect(completed.evidence).toHaveLength(3);
      expect(completed.evidence.some(entry => entry.text === 'A new unsent draft typed while the response is pending.')).toBe(false);
    } finally { release(); await page.unroute(`**/api/challenges/${challengeId}/evidence`); }
    await draft.fill('A reference that must not be published.');
    await page.locator('#evidence-form [name=url]').fill('https://127.1/proof');
    const rejected = page.waitForResponse(response => response.url().endsWith('/evidence'));
    await page.getByRole('button', { name: 'Add evidence', exact: true }).click();
    expect((await rejected).status()).toBe(400);
    await expect(draft).toHaveValue('A reference that must not be published.');
    expect((await snapshot(page)).evidence).toHaveLength(3);
  } finally { await context.close(); }
});

test('mutual void needs the other party and retains its irreversible offer while a result is disputed', async ({ page, browser, baseURL }) => {
  const invitation = await create(page, 'A draw by agreement');
  const context = await browser.newContext({ baseURL }), opponent = await context.newPage();
  try {
    await claim(opponent, invitation); await accept(opponent);
    await page.locator('#void-form [name=reason]').fill('We can set the challenge aside if either outcome remains unclear.');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Offer to void', exact: true }).click();
    await expect.poll(async () => (await snapshot(opponent)).voidProposal !== null).toBe(true);
    const offer = (await snapshot(page)).voidProposal!;
    await expect(page.getByRole('button', { name: 'Agree and void', exact: true })).toHaveCount(0);
    await proposeResult(page, 'proposer', 'I think I completed first.');
    await opponent.locator('#result-response-form [name=reason]').fill('The order is still unclear.');
    await opponent.getByRole('button', { name: 'Dispute result', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).status).toBe('disputed');
    expect((await snapshot(opponent)).voidProposal).toEqual(offer);
    opponent.once('dialog', dialog => dialog.accept());
    await opponent.getByRole('button', { name: 'Agree and void', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).status).toBe('voided');
    expect((await snapshot(page)).resolution).toMatchObject({ method: 'mutual', by: 'opponent', outcome: 'void', proposalId: offer.id, reason: offer.reason });
  } finally { await context.close(); }
});

test('malformed saved credentials and links are visible, preserved and never claimed automatically', async ({ page }) => {
  const corrupt = '{"broken":"not-a-capability"}';
  await page.addInitScript(({ key, corrupt }) => localStorage.setItem(key, corrupt), { key: sessionsKey, corrupt });
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  await page.goto(`/?challenge=${'a'.repeat(32)}#invite=bad&access=${'b'.repeat(64)}`);
  await expect.poll(() => new URL(page.url()).hash).toBe('');
  await expect(page.locator('#message')).toContainText(/invalid|saved|storage|corrupt|malformed/i);
  expect(await page.evaluate(key => localStorage.getItem(key), sessionsKey)).toBe(corrupt);
  await expect(page.getByRole('button', { name: 'Claim opponent seat', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#message')).toContainText(/invalid|saved|storage|corrupt|malformed/i);
  expect(await page.evaluate(key => localStorage.getItem(key), sessionsKey)).toBe(corrupt);
  expect(writes).toEqual([]);
});

test('a delayed real snapshot cannot replace the challenge opened afterward', async ({ page }) => {
  await create(page, 'The previous challenge');
  const first = await credentials(page);
  await create(page, 'The selected challenge');
  const second = await credentials(page);
  await page.getByRole('button', { name: 'Back to challenges', exact: true }).click();
  await page.locator(`[data-challenge-id="${first.challengeId}"]`).getByRole('button', { name: 'Open challenge', exact: true }).click();
  await expect(page.locator('#terms-form [name=title]')).toHaveValue('The previous challenge');
  let release!: () => void, requested!: () => void, finished!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { requested = resolve; });
  const settled = new Promise<void>(resolve => { finished = resolve; });
  await page.route(`**/api/challenges/${first.challengeId}`, async route => {
    // The payload is from the actual service; only delivery ordering is held.
    const response = await route.fetch();
    requested(); await gate;
    try { await route.fulfill({ response }); } finally { finished(); }
  });
  try {
    await started;
    await page.getByRole('button', { name: 'Back to challenges', exact: true }).click();
    await page.locator(`[data-challenge-id="${second.challengeId}"]`).getByRole('button', { name: 'Open challenge', exact: true }).click();
    await expect(page.locator('#terms-form [name=title]')).toHaveValue('The selected challenge');
    release(); await settled;
    // Let the released continuation run before checking the selected record.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.locator('#terms-form [name=title]')).toHaveValue('The selected challenge');
    expect(await credentials(page)).toEqual(second);
  } finally { release(); }
  await page.unroute(`**/api/challenges/${first.challengeId}`);
  await page.getByRole('button', { name: 'Back to challenges', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator(`[data-challenge-id="${first.challengeId}"]`).getByRole('button', { name: 'Forget saved seat', exact: true }).click();
  await expect(page.locator(`[data-challenge-id="${first.challengeId}"]`)).toHaveCount(0);
  const retained = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), sessionsKey) as Record<string, string>;
  expect(retained).toEqual({ [second.challengeId]: second.token });
  expect((await page.request.get(`/api/challenges/${first.challengeId}`, { headers: { Authorization: `Bearer ${first.token}` } })).status()).toBe(200);
  await page.locator(`[data-challenge-id="${second.challengeId}"]`).getByRole('button', { name: 'Open challenge', exact: true }).click();
  await expect(page.locator('#terms-form [name=title]')).toHaveValue('The selected challenge');
});

test('used invitations cannot read or claim a record, and own private links require explicit seat switching', async ({ page, browser, baseURL }) => {
  const invitation = await create(page, 'Only the invited seat');
  const context = await browser.newContext({ baseURL }), opponent = await context.newPage();
  const strangerContext = await browser.newContext({ baseURL }), stranger = await strangerContext.newPage();
  try {
    await create(opponent, 'Another private proposal');
    const remembered = await credentials(opponent), challengeId = new URL(invitation).searchParams.get('challenge')!;
    let release!: () => void, received!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const issued = new Promise<void>(resolve => { received = resolve; });
    await opponent.route(`**/api/challenges/${challengeId}/join`, async route => {
      const response = await route.fetch(); received(); await gate;
      await route.fulfill({ response });
    });
    try {
      await consumeLink(opponent, invitation);
      await opponent.locator('#claim-form [name=name]').fill('Sam');
      await opponent.getByRole('button', { name: 'Claim opponent seat', exact: true }).click();
      await issued;
      await opponent.locator(`[data-challenge-id="${remembered.challengeId}"]`).getByRole('button', { name: 'Open challenge', exact: true }).click();
      await expect(opponent.locator('#message')).toContainText(/finish|wait/i);
      release();
      await expect.poll(async () => (await snapshot(opponent)).myRole).toBe('opponent');
      expect(await opponent.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key)!)[id] as string, { key: sessionsKey, id: remembered.challengeId })).toBe(remembered.token);
    } finally { release(); await opponent.unroute(`**/api/challenges/${challengeId}/join`); }
    const proposerCredential = await credentials(page), opponentCredential = await credentials(opponent);
    expect(proposerCredential.token).not.toBe(opponentCredential.token);
    const inviteToken = new URL(invitation).hash.slice('#invite='.length);
    expect(proposerCredential.token).not.toBe(inviteToken); expect(opponentCredential.token).not.toBe(inviteToken);
    const invitationRead = await stranger.request.get(`/api/challenges/${proposerCredential.challengeId}`, { headers: { Authorization: `Bearer ${inviteToken}` } });
    expect(invitationRead.status()).toBe(401);
    await consumeLink(stranger, invitation);
    await stranger.locator('#claim-form [name=name]').fill('Another person');
    await stranger.getByRole('button', { name: 'Claim opponent seat', exact: true }).click();
    await expect(stranger.locator('#message')).toContainText(/invitation|invite|claimed|available/i);
    expect(await stranger.evaluate(key => localStorage.getItem(key), sessionsKey)).toBeNull();
    await opponent.getByRole('button', { name: 'My private access link', exact: true }).click();
    const access = await opponent.locator('#shared-link').inputValue();
    await consumeLink(page, access);
    await expect(page.getByRole('button', { name: 'Keep my current seat', exact: true })).toBeVisible();
    expect((await credentials(page)).token).toBe(proposerCredential.token);
    await page.getByRole('button', { name: 'Keep my current seat', exact: true }).click();
    expect((await snapshot(page)).myRole).toBe('proposer');
    await consumeLink(page, access);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Use this private access link', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).myRole).toBe('opponent');
    expect((await credentials(page)).token).toBe(opponentCredential.token);
  } finally { await context.close(); await strangerContext.close(); }
});
