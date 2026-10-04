import { test, expect, record, envelope, rows, evidence, author, add, fillRecord, generate, disabled,
  exportsMatch, preserveArtifacts, holdReport, discover, downloadText, manualReport, openSource } from './context-authoring-fixtures.js';
import { SOURCE, SPECIAL_PATH } from './fixtures.js';

test('displayed immutable evidence can start a locally authored discussion', async ({ page, workbench }) => {
  const original = await evidence(page, workbench);
  if (!await page.locator('#author-context').isVisible()) await page.getByText('Add supplied discussion context', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Author supplied discussion', exact: true })).toBeVisible({ timeout: 2000 });
  await author(page);
  const values = await page.locator('#discussion-commit option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
  const expected = [...new Set([...original.blame, ...original.changes, ...original.renames].map(item => item.commit))];
  expect(values).toEqual(expected); for (const id of values) expect(id).toMatch(/^[0-9a-f]{40}$/);
  const supplied = record(workbench.changed); await add(page, supplied); await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('#download-context')).not.toHaveAttribute('href', /^blob:/);
  await generate(page);
  const result = await exportsMatch(page, workbench, envelope(workbench.revision, [supplied]));
  await preserveArtifacts(page, workbench, 'desktop-literal', { 'context.json': result.context, 'report.html': result.html, 'report.json': await downloadText(page, '#download-json') }, true);
  expect(result.report.supplied_context).toEqual([supplied]); expect(result.report.supplied_context_note).toContain('not verified');
  const frame = page.frameLocator('#report-frame'); await expect(frame.locator('#context')).toContainText(supplied.excerpt);
  await expect(frame.locator('#context script, #context img')).toHaveCount(0);
  await expect(page.locator('#authored-context-list script, #authored-context-list img')).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.CONTEXT_OWNED)).toBeUndefined();
  await expect(page.locator('#context-evidence-status')).toContainText(workbench.revision);
});

test('selected revision alone is excluded from picker and a moved branch cannot rewrite pinned evidence', async ({ page, workbench }) => {
  await workbench.write('unrelated.txt', 'Unrelated new commit\n'); const unrelated = await workbench.commit('Commit with no selected evidence');
  const result = await evidence(page, workbench); expect(result.revision).toBe(unrelated); await author(page);
  const values = await page.locator('#discussion-commit option').evaluateAll(options => options.map(option => option.value));
  expect(values).not.toContain(unrelated); expect(values).toContain(workbench.changed);
  await workbench.write(SPECIAL_PATH, SOURCE.replace('value + 2', 'value + 90')); await workbench.commit('Branch moves while authoring');
  await workbench.write(SPECIAL_PATH, SOURCE.replace('value + 2', 'value + 404'));
  const supplied = record(workbench.changed); await add(page, supplied); await generate(page);
  expect(JSON.parse(await downloadText(page, '#download-context'))).toEqual(envelope(unrelated, [supplied]));
  const report = JSON.parse(await downloadText(page, '#download-json')); expect(report.revision).toBe(unrelated); expect(report.source).toContain('value + 2');
});

test('ordered row editing and cancel retain literal raw values and downloaded records contain no private keys', async ({ page, workbench }) => {
  await evidence(page, workbench); await author(page);
  const first = record(workbench.changed), second = record(workbench.initial, { title: 'Original root note', excerpt: 'Second supplied statement.' });
  await add(page, first); await add(page, second); await generate(page);
  const keys = await rows(page).evaluateAll(nodes => nodes.map(node => node.dataset.contextRow));
  await rows(page).nth(0).getByRole('button', { name: 'Edit context record 1', exact: true }).click();
  await page.locator('#discussion-excerpt').fill('  discarded literal edit  '); await disabled(page);
  await page.locator('#context-cancel-edit').click(); await generate(page);
  await exportsMatch(page, workbench, envelope(workbench.revision, [first, second]));
  await rows(page).nth(1).getByRole('button', { name: 'Edit context record 2', exact: true }).click();
  const changed = { ...second, author: '  Changed attribution  ', excerpt: '\tLiteral replacement\n  with spaces.  ' };
  await page.locator('#discussion-author').fill(changed.author); await page.locator('#discussion-excerpt').fill(changed.excerpt);
  await page.locator('#context-save-record').click(); expect(await rows(page).evaluateAll(nodes => nodes.map(node => node.dataset.contextRow))).toEqual(keys);
  await rows(page).nth(0).getByRole('button', { name: 'Remove context record 1', exact: true }).click(); await expect(rows(page)).toHaveCount(1);
  await generate(page); await exportsMatch(page, workbench, envelope(workbench.revision, [changed]));
});

test('uploaded entries and revision records both remain exact and separate from the retained authored draft', async ({ page, workbench }) => {
  await evidence(page, workbench); await author(page); const draft = record(workbench.changed); await add(page, draft);
  for (const [name, uploaded] of [['entries.json', workbench.context], ['records.json', envelope(workbench.revision, [record(workbench.initial, { title: 'Uploaded root' })])]]) {
    await page.locator('#context-mode').selectOption('uploaded');
    await page.locator('#context-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(uploaded)) });
    await expect(page.locator('#context-status')).toContainText(name); await generate(page);
    expect(await downloadText(page, '#download-json')).toBe(await workbench.cli('json', { suppliedContext: uploaded }));
    await expect(page.locator('#download-context')).not.toHaveAttribute('href', /^blob:/);
    await page.locator('#context-mode').selectOption('authored'); await expect(rows(page)).toHaveCount(1); await generate(page);
    await exportsMatch(page, workbench, envelope(workbench.revision, [draft]));
  }
});

test('changed selection is stale and server rejects out-of-scope records atomically until deliberate removal', async ({ page, workbench }) => {
  await evidence(page, workbench); await author(page); const supplied = record(workbench.changed); await add(page, supplied); await generate(page);
  await page.locator('#max-commits').fill('1'); await disabled(page); await expect(page.locator('#report-stale')).toBeVisible();
  await page.locator('#max-commits').fill('20'); await disabled(page); await generate(page);
  await page.locator('#context-mode').selectOption('none'); await openSource(page, 'notes.txt'); await manualReport(page, '1', '2');
  await page.locator('#context-mode').selectOption('authored'); await expect(rows(page)).toHaveCount(1);
  const submissions = []; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/jobs') && request.postDataJSON()?.operation === 'report') submissions.push(request.postDataJSON()); });
  await page.locator('#generate-report').click(); await expect(page.locator('#error')).toContainText(/record 1|displayed evidence/i); await disabled(page);
  expect(submissions).toHaveLength(1); expect(submissions[0].args.path).toBe('notes.txt'); expect(JSON.parse(submissions[0].args.context)).toEqual(envelope(workbench.revision, [supplied]));
  await expect(rows(page).first()).toContainText(supplied.title); await expect(page.locator('#error')).not.toContainText(supplied.excerpt);
  await rows(page).first().getByRole('button', { name: 'Remove context record 1', exact: true }).click(); await generate(page);
  await exportsMatch(page, workbench, envelope(workbench.revision, []), { path: 'notes.txt', lines: '1:2' });
});

test('new revision needs explicit reviewed rebinding and refused consent keeps every authored record', async ({ page, workbench }) => {
  await evidence(page, workbench); await author(page); const supplied = record(workbench.changed); await add(page, supplied); await generate(page);
  await workbench.write('unrelated-new.txt', 'A new revision without changing selected code\n'); const next = await workbench.commit('New revision for explicit rebind');
  await page.locator('#context-mode').selectOption('none'); await page.locator('#ref').fill('HEAD'); await discover(page); await openSource(page); await manualReport(page);
  await page.locator('#context-mode').selectOption('authored'); await disabled(page);
  let denied = ''; page.once('dialog', async dialog => { denied = dialog.message(); await dialog.dismiss(); });
  await page.locator('#context-rebind').click(); expect(denied).toContain(next); await expect(rows(page)).toHaveCount(1); await disabled(page);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#context-rebind').click(); await generate(page);
  expect(JSON.parse(await downloadText(page, '#download-context'))).toEqual(envelope(next, [supplied]));
  expect(JSON.parse(await downloadText(page, '#download-json')).revision).toBe(next);
});

test('50 native authored rows validate, while the 51st remains an unaccepted editable draft', async ({ page, workbench }) => {
  test.setTimeout(90_000); await evidence(page, workbench); await author(page); const expected = [];
  for (let i = 0; i < 50; i++) {
    const next = record(workbench.changed, { title: `Original record ${i + 1}`, author: 'Fixture reader', excerpt: `Literal supplied excerpt ${i + 1}.` });
    await add(page, next); expected.push(next);
  }
  await expect(rows(page)).toHaveCount(50);
  const extra = record(workbench.changed, { title: 'Unaccepted record 51', excerpt: 'Keep this raw draft.' }); await add(page, extra);
  await expect(rows(page)).toHaveCount(50); await expect(page.locator('#discussion-excerpt')).toHaveValue(extra.excerpt);
  await expect(page.locator('#error')).toContainText(/50|limit/i); await disabled(page);
  await page.locator('#context-cancel-edit').click(); await generate(page);
  const result = await exportsMatch(page, workbench, envelope(workbench.revision, expected));
  await preserveArtifacts(page, workbench, 'maximum-50-records', { 'context.json': result.context, 'report.html': result.html, 'report.json': await downloadText(page, '#download-json') });
});

test('astral code-point limits and whole-envelope UTF-8 bytes reject only the overflowing row', async ({ page, workbench }) => {
  test.setTimeout(90_000); await evidence(page, workbench); await author(page); const expected = [];
  for (let i = 0; i < 16; i++) {
    const next = record(workbench.changed, { title: i ? `UTF-8 record ${i}` : '🙂'.repeat(300), author: i ? 'Reader' : '🖋'.repeat(200), excerpt: '🎨'.repeat(4000) });
    await fillRecord(page, next); await expect(page.locator('#discussion-excerpt')).toHaveValue(next.excerpt); await page.locator('#context-add-record').click(); expected.push(next);
  }
  await expect(rows(page)).toHaveCount(16);
  const next = record(workbench.changed, { title: 'Byte-overflow seventeenth', excerpt: '🎨'.repeat(4000) });
  expect(Buffer.byteLength(JSON.stringify(envelope(workbench.revision, expected)), 'utf8')).toBeLessThan(256 * 1024);
  expect(Buffer.byteLength(JSON.stringify(envelope(workbench.revision, [...expected, next])), 'utf8')).toBeGreaterThan(256 * 1024);
  await add(page, next); await expect(rows(page)).toHaveCount(16); await expect(page.locator('#discussion-excerpt')).toHaveValue(next.excerpt);
  await expect(page.locator('#error')).toContainText(/256|bytes|KiB/i);
  await page.locator('#context-cancel-edit').click(); await generate(page);
  const actual = await downloadText(page, '#download-context'); expect(JSON.parse(actual)).toEqual(envelope(workbench.revision, expected));
  expect(Buffer.byteLength(actual, 'utf8')).toBeLessThanOrEqual(256 * 1024);
  const json = await downloadText(page, '#download-json'); expect(json).toBe(await workbench.cli('json', { suppliedContext: JSON.parse(actual) }));
  await preserveArtifacts(page, workbench, 'multibyte-envelope-boundary', { 'context.json': actual, 'report.json': json, 'report.html': await downloadText(page, '#download-html') });
});

test('unsafe links and oversized raw excerpts cannot partially replace accepted records or echo credentials in errors', async ({ page, workbench }) => {
  await evidence(page, workbench); await author(page); const supplied = record(workbench.changed); await add(page, supplied); await generate(page);
  const preview = await page.locator('#report-frame').getAttribute('srcdoc');
  for (const url of ['javascript:PRIVATE_LINK_SENTINEL', 'https://PRIVATE_LINK_SENTINEL@github.com/fixture/repo/issues/2', 'https://github.com/fixture/repo/issues/2?token=PRIVATE_LINK_SENTINEL', 'https://github.com.evil.invalid/fixture/repo/issues/2']) {
    await fillRecord(page, { ...supplied, title: 'Unaccepted unsafe link', url }); await page.locator('#context-add-record').click();
    await expect(rows(page)).toHaveCount(1); await expect(page.locator('#discussion-url')).toHaveValue(url);
    await expect(page.locator('#context-draft-status')).not.toContainText('PRIVATE_LINK_SENTINEL');
    await expect(page.locator('#error')).not.toContainText('PRIVATE_LINK_SENTINEL');
    await disabled(page); await page.locator('#context-cancel-edit').click();
  }
  await fillRecord(page, { ...supplied, excerpt: 'x'.repeat(4001) }); await page.locator('#context-add-record').click();
  await expect(page.locator('#discussion-excerpt')).toHaveValue('x'.repeat(4001)); await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('#report-frame')).toHaveAttribute('srcdoc', preview);
  await page.locator('#context-cancel-edit').click(); await generate(page); await exportsMatch(page, workbench, envelope(workbench.revision, [supplied]));
});

test('late genuine report completion preserves focused changed-back raw text and cannot grant a validation receipt', async ({ page, workbench }) => {
  await evidence(page, workbench); await author(page); const supplied = record(workbench.changed); await add(page, supplied); await generate(page);
  const preview = await page.locator('#report-frame').getAttribute('srcdoc'), pending = await holdReport(page);
  await page.locator('#generate-report').click(); await pending.ready;
  const excerpt = page.locator('#discussion-excerpt'); await excerpt.fill('  Raw pending form 🖋  '); await excerpt.fill('  Raw pending form 🖋 changed  '); await excerpt.fill('  Raw pending form 🖋  ');
  await excerpt.evaluate(element => { element.dataset.receiptIdentity = 'retained'; element.focus(); element.setSelectionRange(3, 9); });
  pending.release(); await expect(page.locator('#stop-button')).toBeDisabled();
  await expect(excerpt).toHaveValue('  Raw pending form 🖋  '); await expect(excerpt).toBeFocused(); await expect(excerpt).toHaveAttribute('data-receipt-identity', 'retained');
  expect(await excerpt.evaluate(element => [element.selectionStart, element.selectionEnd])).toEqual([3, 9]);
  await disabled(page); await expect(page.locator('#report-stale')).toBeVisible(); await expect(page.locator('#report-frame')).toHaveAttribute('srcdoc', preview);
  await page.locator('#context-cancel-edit').click(); await generate(page); await exportsMatch(page, workbench, envelope(workbench.revision, [supplied]));
});

test('Stop drains a real delayed acceptance before replacement and never discards the authored rows', async ({ page, workbench }) => {
  await evidence(page, workbench); await author(page); const supplied = record(workbench.changed); await add(page, supplied);
  const pending = await holdReport(page, true); await page.locator('#generate-report').click(); await pending.ready;
  await page.locator('#stop-button').click(); await page.locator('#context-mode').selectOption('none');
  await page.locator('#path').fill('notes.txt'); await page.getByRole('button', { name: 'Open source', exact: true }).click();
  pending.release(); await expect(page.locator('#source-lines')).toContainText('Second physical line'); await disabled(page);
  await page.locator('#context-mode').selectOption('authored'); await expect(rows(page)).toHaveCount(1); await expect(rows(page).first()).toContainText(supplied.title);
  await page.locator('#context-mode').selectOption('none'); await openSource(page); await manualReport(page);
  await page.locator('#context-mode').selectOption('authored'); await generate(page); await exportsMatch(page, workbench, envelope(workbench.revision, [supplied]));
});

test('controlled pagehide retires delayed genuine report publication without clearing raw authoring fields', async ({ page, workbench }) => {
  await evidence(page, workbench); await author(page); await add(page, record(workbench.changed));
  const pending = await holdReport(page); await page.locator('#generate-report').click(); await pending.ready;
  await page.locator('#discussion-title').fill('Keep this raw title across controlled lifecycle');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))); pending.release();
  await page.waitForTimeout(150); await disabled(page); await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('#discussion-title')).toHaveValue('Keep this raw title across controlled lifecycle');
});

test('late native context File bytes cannot switch mode or replace a newer authored raw draft', async ({ page, workbench }) => {
  await evidence(page, workbench); await author(page); await add(page, record(workbench.changed));
  await page.locator('#context-mode').selectOption('uploaded');
  await page.locator('#context-file').setInputFiles({ name: 'retained-entries.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(workbench.context)) });
  await expect(page.locator('#context-status')).toContainText('retained-entries.json');
  await page.evaluate(() => {
    const state = { pending: [] }; globalThis.contextFileGate = state;
    const native = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function() { return native.call(this).then(bytes => this.name === 'late-records.json' ? new Promise(resolve => state.pending.push(() => resolve(bytes))) : bytes); };
  });
  await page.locator('#context-file').setInputFiles({ name: 'late-records.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(envelope(workbench.revision, []))) });
  await expect.poll(() => page.evaluate(() => globalThis.contextFileGate.pending.length)).toBe(1);
  await page.locator('#context-mode').selectOption('authored'); await page.locator('#discussion-title').fill('A newer unsaved title'); await page.locator('#discussion-title').focus();
  await page.evaluate(() => globalThis.contextFileGate.pending.shift()());
  await page.waitForTimeout(100); await expect(page.locator('#context-mode')).toHaveValue('authored'); await expect(page.locator('#discussion-title')).toHaveValue('A newer unsaved title');
  await expect(page.locator('#discussion-title')).toBeFocused(); await expect(rows(page)).toHaveCount(1);
  await page.locator('#context-cancel-edit').click(); await page.locator('#context-mode').selectOption('uploaded');
  await expect(page.locator('#context-status')).toContainText('retained-entries.json'); await generate(page);
  expect(await downloadText(page, '#download-json')).toBe(await workbench.cli('json', { suppliedContext: workbench.context }));
});

test('narrow keyboard authoring retains literal rows and shows memory-only backup guidance', async ({ page, workbench }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await evidence(page, workbench); await author(page);
  const supplied = record(workbench.changed, { title: '<Literal keyboard title>', excerpt: 'A short original keyboard-authored excerpt.' });
  await fillRecord(page, supplied); await page.locator('#context-add-record').focus(); await page.keyboard.press('Enter'); await expect(rows(page)).toHaveCount(1);
  const edit = rows(page).first().getByRole('button', { name: 'Edit context record 1', exact: true }); await edit.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#discussion-excerpt')).toHaveValue(supplied.excerpt); await page.locator('#context-cancel-edit').focus(); await page.keyboard.press('Enter');
  await generate(page); const result = await exportsMatch(page, workbench, envelope(workbench.revision, [supplied]));
  await preserveArtifacts(page, workbench, 'narrow-keyboard-390px', { 'context.json': result.context, 'report.html': result.html, 'report.json': await downloadText(page, '#download-json') }, true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  await expect(page.locator('#context-draft-status')).toContainText(/download|reload|memory|local/i);
});

test('workspace navigation keeps unsaved authoring in memory and reload requires explicit discard consent', async ({ page, workbench }) => {
  await evidence(page, workbench); await author(page); await add(page, record(workbench.changed)); await generate(page);
  await page.locator('#discussion-title').fill('Unsent literal title kept through workspace navigation');
  await page.locator('#discussion-title').evaluate(element => { element.dataset.workspaceIdentity = 'stable'; });
  let submissions = 0; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/jobs')) submissions++; });
  await page.locator('#workspace-mode').selectOption('comparison'); await disabled(page);
  await page.locator('#workspace-mode').selectOption('history'); expect(submissions).toBe(0);
  await expect(page.locator('#discussion-title')).toHaveValue('Unsent literal title kept through workspace navigation');
  await expect(page.locator('#discussion-title')).toHaveAttribute('data-workspace-identity', 'stable'); await expect(rows(page)).toHaveCount(1);
  let kind = ''; page.once('dialog', async dialog => { kind = dialog.type(); await dialog.dismiss(); });
  await page.reload({ timeout: 2000 }).catch(() => {}); expect(kind).toBe('beforeunload');
  await expect(page.locator('#discussion-title')).toHaveValue('Unsent literal title kept through workspace navigation');
  page.once('dialog', dialog => dialog.accept()); await page.reload();
  await expect(page.getByRole('button', { name: 'Discover files', exact: true })).toBeDisabled();
  await expect(page.locator('#error')).toContainText(/terminal|reopen|session/i); await expect(rows(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});
