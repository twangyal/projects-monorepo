import { test, expect, SPECIAL_PATH, SOURCE, discover, downloadText, manualReport, openSession, openSource } from './fixtures.js';

const generate = page => page.getByRole('button', { name: 'Generate report', exact: true });
const disabledDownloads = async page => {
  await expect(page.locator('#download-html')).not.toHaveAttribute('href', /^blob:/);
  await expect(page.locator('#download-json')).not.toHaveAttribute('href', /^blob:/);
};
const functions = async page => {
  await page.locator('#functions-button').click();
  await expect(page.locator('#function-list button').first()).toBeVisible();
};

async function assertExactExports(page, workbench, options) {
  const html = await downloadText(page, '#download-html');
  const json = await downloadText(page, '#download-json');
  expect(html).toBe(await workbench.cli('html', options));
  expect(json).toBe(await workbench.cli('json', options));
  return { html, report: JSON.parse(json) };
}

test('real function evidence remains pinned through branch movement, rename and hostile supplied text', async ({ page, workbench }) => {
  const errors = [], cspErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Playwright's isolated-world evaluations may warn about sandboxed script
  // execution; the product iframe itself contains no scripts. Capture actual
  // policy/resource failures, including forbidden fragment navigation.
  page.on('console', message => { if (/Content Security Policy|Not allowed to load local resource/.test(message.text())) cspErrors.push(message.text()); });
  await openSession(page, workbench);
  await discover(page);
  await expect(page.locator('#revision')).toContainText(workbench.revision);
  const specialFile = page.locator('#file-list button').filter({ hasText: 'odd\\tname.py' });
  await expect(specialFile).toHaveCount(1);
  await workbench.write(SPECIAL_PATH, SOURCE.replace('value + 2', 'value + 999'));
  await workbench.commit('Move main after browser discovery');
  await workbench.write(SPECIAL_PATH, SOURCE.replace('value + 2', 'value + 404'));
  const dirtyStatus = await workbench.git('status', '--porcelain');
  await specialFile.click();
  await expect(page.locator('#source-lines')).toContainText('return value + 2');
  await expect(page.locator('#source-lines')).not.toContainText('value + 999');
  await expect(page.locator('#source-lines')).not.toContainText('value + 404');
  await expect(page.locator('#source-lines img, #source-lines script')).toHaveCount(0);
  await functions(page);
  await page.locator('#function-list li').filter({ hasText: 'calculate' }).getByRole('button', { name: 'Select function', exact: true }).click();
  await expect(page.locator('#selection-mode')).toHaveValue('function');
  await page.getByText('Add supplied discussion context', { exact: true }).click();
  await page.locator('#context-file').setInputFiles({ name: 'supplied-original.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(workbench.context)) });
  await expect(page.locator('#context-status')).toContainText('supplied-original.json');
  await generate(page).click();
  await expect(page.locator('#download-json')).toHaveAttribute('href', /^blob:/);
  const frame = page.frameLocator('#report-frame');
  await expect(frame.getByRole('heading', { name: 'Evidence synopsis', exact: true })).toBeVisible();
  await expect(frame.getByRole('heading', { name: 'Unverified supplied context', exact: true })).toBeVisible();
  await expect(frame.locator('#renames')).toContainText('src/original.py');
  await expect(frame.locator('#supplied-context')).toContainText('<script>globalThis.OWNED=1</script>');
  await expect(frame.locator('script, img')).toHaveCount(0);
  await frame.getByRole('link', { name: 'Selected source', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'Evidence synopsis', exact: true })).toBeVisible();
  await expect(frame.locator('#source')).toBeVisible();
  expect(await frame.locator('html').evaluate(() => location.hash)).toBe('#source');
  expect(await frame.locator('html').evaluate(() => location.href)).toBe('about:srcdoc#source');
  await expect(frame.locator(':target')).toHaveAttribute('id', 'source');
  expect(await frame.locator('#source').evaluate(element => {
    const top = element.getBoundingClientRect().top;
    return scrollY > 0 && top >= 0 && top < innerHeight / 2;
  })).toBe(true);
  const brokenAnchors = await frame.locator('a[href^="about:srcdoc#"]').evaluateAll(links => links
    .map(link => new URL(link.href).hash.slice(1)).filter(id => !document.getElementById(id)));
  expect(brokenAnchors).toEqual([]);
  expect(await frame.locator('html').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(247, 248, 250)');
  expect(new Set((await page.locator('#report-frame').getAttribute('sandbox')).split(/\s+/))).toEqual(new Set(['allow-popups', 'allow-popups-to-escape-sandbox']));
  expect(await page.evaluate(() => {
    try { return document.querySelector('#report-frame').contentWindow.document !== null; }
    catch { return false; }
  })).toBe(false);
  const external = frame.locator('#supplied-context a[target="_blank"]').first();
  await expect(external).toHaveAttribute('rel', /noopener/);
  await expect(external).toHaveAttribute('href', /^https:\/\/github\.com\/fixture\/local-evidence\//);
  const { report } = await assertExactExports(page, workbench, { functionName: 'calculate', suppliedContext: workbench.context });
  expect(report.revision).toBe(workbench.revision);
  expect(report.selected_function).toBe('calculate');
  expect(report.source).toContain('return value + 2');
  expect(report.renames.some(rename => rename.old_path === 'src/original.py' && rename.new_path === SPECIAL_PATH)).toBe(true);
  expect(report.supplied_context.provenance).toContain('Unverified');
  expect(await workbench.git('status', '--porcelain')).toBe(dirtyStatus);
  expect(await page.evaluate(() => globalThis.OWNED)).toBeUndefined();
  expect(errors).toEqual([]);
  expect(cspErrors).toEqual([]);
});

test('explicit non-candidate source has exact physical lines and real manual CLI parity', async ({ page, workbench }) => {
  await openSession(page, workbench);
  await discover(page);
  await openSource(page, 'notes.txt');
  await expect(page.locator('#source-lines tr')).toHaveCount(2);
  await expect(page.locator('#source-lines')).toContainText('Second physical line without trailing LF');
  await expect(page.locator('#source-lines img')).toHaveCount(0);
  await page.locator('#functions-button').click();
  await expect(page.locator('#error')).toContainText(/manual|supported|Python|JavaScript|TypeScript/i);
  await manualReport(page, '1', '2');
  const { report } = await assertExactExports(page, workbench, { path: 'notes.txt', lines: '1:2' });
  expect(report.selected_function).toBeNull();
  expect(report.source.endsWith('trailing LF')).toBe(true);
});

test('real optional native grammar selects a TypeScript function when installed', async ({ page, workbench }) => {
  test.skip(!workbench.nativeAvailable, 'The chosen service Python lacks the pinned optional javascript extra.');
  await openSession(page, workbench);
  await discover(page);
  await openSource(page, 'src/optional.ts');
  await functions(page);
  await page.locator('#function-list li').filter({ hasText: 'add' }).getByRole('button', { name: 'Select function', exact: true }).click();
  await generate(page).click();
  await expect(page.locator('#download-json')).toHaveAttribute('href', /^blob:/);
  const { report } = await assertExactExports(page, workbench, { path: 'src/optional.ts', functionName: 'add' });
  expect(report.selected_function).toBe('add');
  expect(report.start_line).toBe(1);
  expect(report.end_line).toBe(3);
});

test.describe('controlled missing-site-packages worker interpreter', () => {
  test.use({ missingNative: true });
  test('actual dependency failure retains committed source and manual selection', async ({ page, workbench }) => {
    await openSession(page, workbench);
    await discover(page);
    await openSource(page, 'src/optional.ts');
    await page.locator('#functions-button').click();
    await expect(page.locator('#error')).toContainText(/javascript extra|dependencies|install/i);
    await expect(page.locator('#source-lines')).toContainText('return value + 2');
    await manualReport(page, '1', '3');
    const { report } = await assertExactExports(page, workbench, { path: 'src/optional.ts', lines: '1:3' });
    expect(report.selected_function).toBeNull();
    expect(report.source).toContain('export function add');
  });
});

test('invalid ref, range and supplied context preserve correction drafts and revoke old downloads', async ({ page, workbench }) => {
  await openSession(page, workbench);
  await discover(page);
  await openSource(page);
  await manualReport(page);
  const oldPreview = await page.locator('#report-frame').getAttribute('srcdoc');
  await page.locator('#max-commits').fill('0');
  await disabledDownloads(page);
  await generate(page).click();
  await expect(page.locator('#max-commits')).toHaveValue('0');
  await expect(page.locator('#revision')).toContainText(workbench.revision);
  await page.locator('#max-commits').fill('20');
  await page.locator('#end-line').fill('999');
  await generate(page).click();
  await expect(page.locator('#end-line')).toHaveValue('999');
  await disabledDownloads(page);
  await page.locator('#end-line').fill('4');
  await page.getByText('Add supplied discussion context', { exact: true }).click();
  await page.locator('#context-file').setInputFiles({ name: 'retained-context.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(workbench.context)) });
  await expect(page.locator('#context-status')).toContainText('retained-context.json');
  await page.locator('#context-file').setInputFiles({ name: 'oversized-context.json', mimeType: 'application/json', buffer: Buffer.alloc(256 * 1024 + 1, 32) });
  await expect(page.locator('#error')).toContainText('256 KiB');
  await expect(page.locator('#context-status')).toContainText('retained-context.json');
  await page.locator('#context-file').setInputFiles({ name: 'not-utf8.json', mimeType: 'application/json', buffer: Buffer.from([255]) });
  await expect(page.locator('#error')).toContainText('UTF-8');
  await expect(page.locator('#context-status')).toContainText('retained-context.json');
  await page.locator('#context-file').setInputFiles({ name: 'invalid-context.json', mimeType: 'application/json', buffer: Buffer.from('{"schema_version":99,"entries":[]}') });
  await generate(page).click();
  await expect(page.locator('#error')).toContainText(/context|version|schema/i);
  await expect(page.locator('#path')).toHaveValue(JSON.stringify(SPECIAL_PATH));
  await expect(page.locator('#end-line')).toHaveValue('4');
  await disabledDownloads(page);
  await expect(page.locator('#report-stale')).toBeVisible();
  await expect(page.locator('#report-description')).toContainText(workbench.revision);
  await expect(page.locator('#report-frame')).toHaveAttribute('srcdoc', oldPreview);
  await expect(page.frameLocator('#report-frame').getByRole('heading', { name: 'Evidence synopsis', exact: true })).toBeVisible();
  await page.locator('#context-clear').click();
  await manualReport(page);
  await page.locator('#ref').fill('missing-browser-fixture-ref');
  await disabledDownloads(page);
  await page.getByRole('button', { name: 'Discover files', exact: true }).click();
  await expect(page.locator('#error')).not.toHaveText('');
  await expect(page.locator('#ref')).toHaveValue('missing-browser-fixture-ref');
  await page.locator('#ref').fill('HEAD');
  await discover(page);
  await openSource(page);
  await manualReport(page);
});

// Delay ONLY delivery of a completed real service response; evidence tests above
// and the CLI comparisons never substitute mocked source/history/report data.
test('delayed completed report after Stop cannot publish stale iframe or download URLs', async ({ page, workbench }) => {
  await openSession(page, workbench);
  await discover(page);
  await openSource(page);
  let release, held;
  const delivered = new Promise(resolve => { held = resolve; });
  const releaseDelivery = new Promise(resolve => { release = resolve; });
  let holdOnce = true;
  await page.route('**/api/result', async route => {
    const response = await route.fetch();
    const body = await response.json();
    if (holdOnce && body.state === 'complete' && body.result?.html) {
      holdOnce = false;
      held();
      await releaseDelivery;
    }
    await route.fulfill({ response }).catch(() => {});
  });
  await page.locator('#start-line').fill('2');
  await page.locator('#end-line').fill('4');
  await generate(page).click();
  await delivered;
  await page.locator('#stop-button').click();
  await expect(page.getByRole('button', { name: 'Open source', exact: true })).toBeEnabled();
  await page.locator('#path').fill('notes.txt');
  await page.getByRole('button', { name: 'Open source', exact: true }).click();
  release();
  await disabledDownloads(page);
  await expect(page.locator('#source-lines')).toContainText('Second physical line without trailing LF');
  await manualReport(page, '1', '2');
  const { report } = await assertExactExports(page, workbench, { path: 'notes.txt', lines: '1:2' });
  expect(report.path).toBe('notes.txt');
});

test('delayed real job acceptance is cancelled before replacement and keeps corrected path text', async ({ page, workbench }) => {
  await openSession(page, workbench);
  await discover(page);
  let release, accepted;
  const ready = new Promise(resolve => { accepted = resolve; });
  const delivery = new Promise(resolve => { release = resolve; });
  let holdOnce = true;
  const operations = [];
  await page.route('**/api/jobs', async route => {
    const data = route.request().postDataJSON();
    operations.push(data);
    const response = await route.fetch();
    if (holdOnce && data.operation === 'source') {
      holdOnce = false;
      accepted();
      await delivery;
    }
    await route.fulfill({ response }).catch(() => {});
  });
  await page.locator('#path').fill(JSON.stringify(SPECIAL_PATH));
  await page.getByRole('button', { name: 'Open source', exact: true }).click();
  await ready;
  await page.locator('#stop-button').click();
  await page.locator('#path').fill('notes.txt');
  release();
  await expect(page.getByRole('button', { name: 'Open source', exact: true })).toBeEnabled();
  await expect(page.locator('#path')).toHaveValue('notes.txt');
  await page.getByRole('button', { name: 'Open source', exact: true }).click();
  await expect(page.locator('#source-lines')).toContainText('Second physical line without trailing LF');
  expect(operations.filter(operation => operation.operation === 'source').map(operation => operation.args.path)).toEqual([SPECIAL_PATH, 'notes.txt']);
  await disabledDownloads(page);
});

test('bounded catalogs and maximum-line source stay keyboard-usable on mobile; reload has no session', async ({ page, workbench }) => {
  for (let i = 0; i < 55; i++) await workbench.write(`catalog/file-${String(i).padStart(2, '0')}.py`, `def item_${i}():\n    return ${i}\n`);
  await workbench.write('data/maximum-lines.txt', '\n'.repeat(512 * 1024));
  await workbench.write('many-functions.py', Array.from({ length: 55 }, (_, i) => `def function_${String(i).padStart(2, '0')}():\n    return ${i}\n`).join(''));
  const revision = await workbench.commit('Original bounded catalog and maximum physical lines');
  await page.setViewportSize({ width: 390, height: 844 });
  await openSession(page, workbench);
  await page.locator('#directory').fill('catalog');
  await page.locator('#language').selectOption('python');
  await page.getByRole('button', { name: 'Discover files', exact: true }).press('Enter');
  await expect(page.locator('#file-list button')).toHaveCount(50);
  await page.locator('#file-next').press('Enter');
  await expect(page.locator('#file-list button')).toHaveCount(5);
  await page.locator('#file-filter').fill('file-54');
  await expect(page.locator('#file-list button')).toHaveCount(1);
  await expect(page.locator('#file-page')).toContainText('55 total');
  await page.locator('#file-filter').fill('');
  await expect(page.locator('#file-list button')).toHaveCount(50);
  await openSource(page, 'data/maximum-lines.txt');
  await expect(page.locator('#source-lines tr')).toHaveCount(100);
  await page.locator('#source-next').press('Enter');
  await expect(page.locator('#source-lines tr')).toHaveCount(100);
  await expect(page.locator('#source-lines tr').first().locator('th,td').first()).toHaveText('101');
  await expect(page.locator('#revision')).toContainText(revision);
  await openSource(page, 'many-functions.py');
  await functions(page);
  await expect(page.locator('#function-list button')).toHaveCount(50);
  await page.locator('#function-next').press('Enter');
  await expect(page.locator('#function-list button')).toHaveCount(5);
  await page.locator('#function-filter').fill('function_54');
  await expect(page.locator('#function-list button')).toHaveCount(1);
  await expect(page.locator('#function-page')).toContainText('55 total');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const unauthenticatedCalls = [];
  page.on('request', request => { if (request.url().includes('/api/')) unauthenticatedCalls.push(request.url()); });
  await page.reload();
  await expect(page.locator('#error')).toContainText(/terminal|reopen|session/i);
  await expect(page.getByRole('button', { name: 'Discover files', exact: true })).toBeDisabled();
  expect(unauthenticatedCalls).toEqual([]);
  await disabledDownloads(page);
  // Same-document navigation: after reload the original fragment must bootstrap
  // an explicit new in-memory session without requiring another full reload.
  await page.goto(workbench.url);
  await expect(page.getByRole('button', { name: 'Discover files', exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
  await expect(page.locator('#error')).toBeHidden();
  await discover(page);
  await expect(page.locator('#context-status')).toContainText(/no|none|not/i);
});
