import { test as base, expect, discover, downloadText, manualReport, openSession, openSource } from './fixtures.js';
export { expect, discover, downloadText, manualReport, openSession, openSource };
export const test = base.extend({
  audit: [async ({ page, workbench }, use) => {
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!/^(data|blob):/.test(request.url()) && new URL(request.url()).origin !== workbench.origin) external.push(request.url()); });
    await use(); expect(errors).toEqual([]); expect(external).toEqual([]);
  }, { auto: true }],
});
export function record(commit, changes = {}) {
  return { commit, title: '  Original supplied decision <title>  ', author: '  Attributed reader 🖋  ',
    url: 'https://github.com/fixture/local-evidence/pull/42#issuecomment-123',
    excerpt: '  A literal supplied claim about token and password naming.\n<script>globalThis.CONTEXT_OWNED=1</script> & <img src=https://never.invalid/a>\nTrailing space.  ', ...changes };
}
export const envelope = (revision, records) => ({ schema_version: 1, revision, records });
export const rows = page => page.locator('#authored-context-list [data-context-row]');
export async function evidence(page, workbench) {
  await openSession(page, workbench); await discover(page); await openSource(page); await manualReport(page);
  return JSON.parse(await downloadText(page, '#download-json'));
}
export async function author(page) {
  const button = page.locator('#author-context');
  if (!await button.isVisible()) await page.getByText('Add supplied discussion context', { exact: true }).click();
  await button.click(); await expect(page.locator('#context-mode')).toHaveValue('authored');
}
export async function fillRecord(page, value) {
  await page.locator('#discussion-commit').selectOption(value.commit);
  for (const field of ['title', 'author', 'url', 'excerpt']) await page.locator(`#discussion-${field}`).fill(value[field]);
}
export async function add(page, value) { await fillRecord(page, value); await page.locator('#context-add-record').click(); }
export async function generate(page) { await page.locator('#generate-report').click(); await expect(page.locator('#download-json')).toHaveAttribute('href', /^blob:/); }
export async function disabled(page) {
  for (const id of ['download-context', 'download-html', 'download-json']) await expect(page.locator(`#${id}`)).not.toHaveAttribute('href', /^blob:/);
}
export async function exportsMatch(page, workbench, expected, options = {}) {
  const context = await downloadText(page, '#download-context'); expect(JSON.parse(context)).toEqual(expected);
  const html = await downloadText(page, '#download-html'), json = await downloadText(page, '#download-json');
  expect(html).toBe(await workbench.cli('html', { ...options, suppliedContext: JSON.parse(context) }));
  expect(json).toBe(await workbench.cli('json', { ...options, suppliedContext: JSON.parse(context) }));
  for (const artifact of [context, html, json]) { expect(artifact).not.toContain(workbench.repo); expect(artifact).not.toContain(new URL(workbench.url).hash.slice(9)); }
  return { context, html, report: JSON.parse(json) };
}
export async function holdReport(page, acceptance = false) {
  let release, delivered; const ready = new Promise(resolve => { delivered = resolve; });
  const wait = new Promise(resolve => { release = resolve; }); let once = true;
  await page.route(acceptance ? '**/api/jobs' : '**/api/result', async route => {
    const isReport = acceptance && route.request().postDataJSON()?.operation === 'report';
    const response = await route.fetch(), result = acceptance ? null : await response.json();
    if (once && (isReport || result?.state === 'complete' && result.result?.html)) { once = false; delivered(); await wait; }
    await route.fulfill({ response }).catch(() => {});
  });
  return { ready, release: () => release() };
}

export async function preserveArtifacts(page, workbench, label, artifacts, screenshot = false) {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const { env } = await import('node:process');
  const directory = `${env.GIT_HISTORY_ARTIFACT_DIR || test.info().outputPath('evidence')}/${label}`; await mkdir(directory, { recursive: true });
  const files = {};
  for (const [name, text] of Object.entries(artifacts)) {
    if (text.includes(workbench.repo) || text.includes(new URL(workbench.url).hash.slice(9))) throw Error('Private service identity must not enter evidence artifacts.');
    const bytes = Buffer.from(text, 'utf8'); await writeFile(`${directory}/${name}`, bytes);
    files[name] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  if (screenshot) {
    await page.locator('#authored-context-list').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${directory}/workbench.png` });
    await page.locator('#report-frame').scrollIntoViewIfNeeded();
    await expect(page.frameLocator('#report-frame').getByRole('heading', { name: 'Evidence synopsis', exact: true })).toBeVisible();
    await page.screenshot({ path: `${directory}/report-preview.png` });
  }
  await writeFile(`${directory}/verification.json`, `${JSON.stringify({ fixture: 'Original locally authored browser fixtures; real Git/service and native downloads', revision: workbench.revision, files, viewport: page.viewportSize() }, null, 2)}\n`);
}
