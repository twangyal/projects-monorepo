import { test as base, expect, APP, openSession, downloadText } from './fixtures.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { chmod, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
const execute = promisify(execFile);
export { expect, downloadText };
export const ODD = 'src/literal\tline\n雪[one]<img onerror=OWNED>.txt';
export const BEFORE = 'first\nold <script>globalThis.CHANGES_OWNED=1</script>\nlast\n';
export const AFTER = 'first\nnew & literal\nlast\n';
export const blobId = value => { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value); return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'); };
const endpoint = (value, mode = '100644', kind = 'regular') => ({ kind, mode, object_id: blobId(value) });
// Freeze facts before running Git or any changed-file producer. Commit IDs only fill exact gitlink endpoints at runtime.
export function originalFacts(leftCommit, rightCommit, many = false) {
  const row = (path, change, left, right, addressable = true) => ({ path, change, left, right, addressable });
  const result = [
    row('added.txt', 'added', null, endpoint('original addition\n')),
    row('binary.dat', 'modified', endpoint(Buffer.from([0, 1, 2])), endpoint(Buffer.from([0, 3, 4]))),
    row('deleted.txt', 'deleted', endpoint('original deletion\n'), null),
    row('empty.txt', 'added', null, endpoint('')),
    row('executable.txt', 'mode-changed', endpoint('unchanged mode bytes\n'), endpoint('unchanged mode bytes\n', '100755')),
    row('large.txt', 'modified', endpoint(Array.from({ length: 201 }, (_, n) => `old ${n + 1}\n`).join('')), endpoint(Array.from({ length: 201 }, (_, n) => `new ${n + 1}\n`).join(''))),
    row('link', 'type-changed', endpoint('outside-target', '120000', 'symlink'), endpoint('literal regular replacement\n')),
    row('mode-and-content.txt', 'modified', endpoint('old executable body\n'), endpoint('new executable body\n', '100755')),
    row('moved/from.txt', 'deleted', endpoint('identical moved bytes\n'), null),
    row('moved/to.txt', 'added', null, endpoint('identical moved bytes\n')),
    row('src-extra/neighbor.txt', 'modified', endpoint('neighbor old\n'), endpoint('neighbor new\n')),
    row('src/edited.txt', 'modified', endpoint(BEFORE), endpoint(AFTER)),
    row(ODD, 'modified', endpoint('literal path old\n'), endpoint('literal path new\n')),
    row('submodule', 'modified', { kind: 'gitlink', mode: '160000', object_id: leftCommit }, { kind: 'gitlink', mode: '160000', object_id: rightCommit }),
    row('swap', 'deleted', endpoint('old leaf\n'), null),
    row('swap/child.txt', 'added', null, endpoint('new child\n')),
    row('utf8-invalid.txt', 'modified', endpoint(Buffer.from([255, 10])), endpoint(Buffer.from([254, 10]))),
  ];
  if (many) for (let n = 0; n < 105; n++) result.push(row(`pages/${String(n).padStart(3, '0')}.txt`, 'added', null, endpoint(`original page ${n}\n`)));
  return result.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}
export const test = base.extend({
  manyChanges: [false, { option: true }],
  changes: async ({ workbench, manyChanges }, use) => {
    const w = workbench;
    for (const [path, bytes] of [
      ['deleted.txt', 'original deletion\n'], ['binary.dat', Buffer.from([0, 1, 2])], ['executable.txt', 'unchanged mode bytes\n'],
      ['large.txt', Array.from({ length: 201 }, (_, n) => `old ${n + 1}\n`).join('')], ['mode-and-content.txt', 'old executable body\n'],
      ['moved/from.txt', 'identical moved bytes\n'], ['src-extra/neighbor.txt', 'neighbor old\n'], ['src/edited.txt', BEFORE], [ODD, 'literal path old\n'],
      ['swap', 'old leaf\n'], ['utf8-invalid.txt', Buffer.from([255, 10])],
    ]) await w.write(path, bytes);
    await symlink('outside-target', join(w.repo, 'link'));
    await w.git('add', '--all'); await w.git('update-index', '--add', '--cacheinfo', `160000,${w.initial},submodule`);
    await w.git('commit', '-qm', 'Original changed-file left'); const left = await w.git('rev-parse', 'HEAD'); await w.git('branch', 'changes-left', left);
    await w.git('rm', '--', 'deleted.txt', 'moved/from.txt', 'swap', 'link');
    for (const [path, bytes] of [
      ['added.txt', 'original addition\n'], ['empty.txt', ''], ['binary.dat', Buffer.from([0, 3, 4])], ['mode-and-content.txt', 'new executable body\n'],
      ['large.txt', Array.from({ length: 201 }, (_, n) => `new ${n + 1}\n`).join('')], ['moved/to.txt', 'identical moved bytes\n'],
      ['src-extra/neighbor.txt', 'neighbor new\n'], ['src/edited.txt', AFTER], [ODD, 'literal path new\n'], ['swap/child.txt', 'new child\n'],
      ['link', 'literal regular replacement\n'], ['utf8-invalid.txt', Buffer.from([254, 10])],
    ]) await w.write(path, bytes);
    await chmod(join(w.repo, 'executable.txt'), 0o755); await chmod(join(w.repo, 'mode-and-content.txt'), 0o755);
    if (manyChanges) for (let n = 0; n < 105; n++) await w.write(`pages/${String(n).padStart(3, '0')}.txt`, `original page ${n}\n`);
    await w.git('add', '--all'); await w.git('update-index', '--add', '--cacheinfo', `160000,${w.changed},submodule`);
    await w.git('commit', '-qm', 'Original changed-file right'); const right = await w.git('rev-parse', 'HEAD'); await w.git('branch', 'changes-right', right);
    const expected = originalFacts(w.initial, w.changed, manyChanges);
    const cli = async args => (await execute(process.env.GIT_HISTORY_PYTHON || 'python3', ['-m', 'git_history', ...args, '--repo', w.repo], {
      cwd: process.env.GIT_HISTORY_BROWSER_INSTALLED === '1' ? w.directory : APP, env: { ...process.env, PYTHONPATH: '' }, timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    })).stdout;
    await use({ ...w, left, right, expected, cli });
    // Any worktree file made by a case belongs solely to the original temporary fixture.
    await rm(join(w.repo, 'untracked-oracle.txt'), { force: true });
  },
});
export async function openChanges(page, fixture) { await openSession(page, fixture); await page.locator('#workspace-mode').selectOption('comparison'); }
export async function discoverChanges(page, { left = 'changes-left', right = 'changes-right', directory = '' } = {}) {
  await page.locator('#changes-left-ref').fill(left); await page.locator('#changes-right-ref').fill(right); await page.locator('#changes-directory').fill(directory);
  await page.locator('#changes-discover').click(); await expect(page.locator('#changes-download-json')).toHaveAttribute('href', /^blob:/); await expect(page.locator('#stop-button')).toBeDisabled();
}
export async function usePath(page, path) {
  await page.locator('#changes-filter').fill(path);
  const rows = page.locator('#changes-table tbody tr'); await expect(rows).toHaveCount(1);
  await rows.locator('[data-use-change]').click();
}
export async function compareHandoff(page) {
  for (const side of ['left', 'right']) if (await page.locator(`#${side}-selection-mode`).inputValue() !== 'missing') {
    await page.locator(`#${side}-open-source`).click(); await expect(page.locator(`#${side}-source-caption`)).toContainText(/physical|committed/); await expect(page.locator('#stop-button')).toBeDisabled();
  }
  await page.locator('#compare-button').click(); await expect(page.locator('#comparison-download-json')).toHaveAttribute('href', /^blob:/); await expect(page.locator('#stop-button')).toBeDisabled();
}
export async function exactComparison(page, fixture, path, leftKind = 'whole', rightKind = 'whole') {
  const json = await downloadText(page, '#comparison-download-json'), html = await downloadText(page, '#comparison-download-html');
  for (const [format, actual] of [['json', json], ['html', html]]) {
    expect(actual).toBe(await fixture.cli(['compare', '--left-ref', fixture.left, '--right-ref', fixture.right, '--left-file', path, '--right-file', path, `--left-${leftKind}`, `--right-${rightKind}`, '--format', format]));
    expect(actual).not.toContain(new URL(fixture.url).hash.slice(9)); expect(actual).not.toContain(fixture.repo);
  }
  return { report: JSON.parse(json), html };
}
export async function holdChanges(page, boundary = 'complete') {
  let release, reached, id, held = false; const gate = new Promise(resolve => { release = resolve; }); const ready = new Promise(resolve => { reached = resolve; }); const operations = [], cancellations = [];
  await page.route('**/api/jobs', async route => {
    const body = route.request().postDataJSON(); operations.push(body.operation); const response = await route.fetch();
    if (body.operation === 'changed-files' && !id) { id = (await response.json()).id; if (boundary === 'accepted') { held = true; reached(); await gate; } }
    await route.fulfill({ response }).catch(() => {});
  });
  await page.route('**/api/cancel', async route => { cancellations.push(route.request().postDataJSON().id); const response = await route.fetch(); await route.fulfill({ response }).catch(() => {}); });
  if (boundary === 'complete') await page.route('**/api/result', async route => {
    const response = await route.fetch(); const value = await response.json();
    if (!held && route.request().postDataJSON().id === id && value.state === 'complete') { held = true; reached(); await gate; }
    await route.fulfill({ response }).catch(() => {});
  });
  return { release, reached: ready, operations, cancellations };
}
