import { test as base, expect, APP, openSession, downloadText } from './fixtures.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const execute = promisify(execFile);
export { expect, downloadText };
export const LEFT_PATH = 'before/original.py';
export const RIGHT_PATH = 'after/renamed\t<literal>.py';
export const LEFT_SOURCE = '# Original committed region\ndef amount(value):\n    """<script>globalThis.COMPARISON_OWNED=1</script>"""\n    return value + 1\n';
export const RIGHT_SOURCE = LEFT_SOURCE.replace('amount', 'total').replace('value + 1', 'value + 2');
export const PHYSICAL_LEFT = '\ufeffalpha\r\nseparator\u2028inside\nlast';
export const PHYSICAL_RIGHT = '\ufeffalpha\nseparator\u2028inside\nlast\n';
export const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
export const block = (kind, left_start, left_end, right_start, right_end) => ({ kind, left_start, left_end, right_start, right_end });

export const test = base.extend({
  comparison: async ({ workbench }, use) => {
    await workbench.write(LEFT_PATH, LEFT_SOURCE);
    await workbench.write('repeated.txt', 'A\nB\nA\n');
    await workbench.write('physical.txt', PHYSICAL_LEFT);
    await workbench.write('empty.txt', '');
    await workbench.write('gone.txt', 'Only on the left\n');
    await workbench.write('binary.txt', Buffer.from([0, 1, 2]));
    await workbench.write('large.txt', Array.from({ length: 201 }, (_, i) => `left ${i + 1}\n`).join(''));
    await workbench.write('optional.ts', 'export function first(): number {\n  return 1;\n}\n');
    const left = await workbench.commit('Independent comparison left');
    await workbench.git('branch', 'compare-left', left);
    await workbench.git('rm', LEFT_PATH, 'gone.txt');
    await workbench.write(RIGHT_PATH, RIGHT_SOURCE);
    await workbench.write('repeated.txt', 'B\nA\nB\n');
    await workbench.write('physical.txt', PHYSICAL_RIGHT);
    await workbench.write('added.txt', 'Only on the right\n');
    await workbench.write('large.txt', Array.from({ length: 201 }, (_, i) => `right ${i + 1}\n`).join(''));
    await workbench.write('optional.ts', 'export function second(): number {\n  return 2;\n}\n');
    const right = await workbench.commit('Independent comparison right');
    await workbench.git('branch', 'compare-right', right);
    const cli = async (format, leftTarget, rightTarget) => {
      const args = ['-m', 'git_history', 'compare', '--repo', workbench.repo, '--format', format];
      for (const [side, target] of [['left', leftTarget], ['right', rightTarget]]) {
        args.push(`--${side}-ref`, target.revision, `--${side}-file`, target.path);
        const selection = target.selection;
        args.push(`--${side}-${selection.kind}`);
        if (selection.kind === 'lines') args.push(`${selection.start}:${selection.end}`);
        if (selection.kind === 'function') args.push(selection.function);
      }
      return (await execute(process.env.GIT_HISTORY_PYTHON || 'python3', args, {
        cwd: process.env.GIT_HISTORY_BROWSER_INSTALLED === '1' ? workbench.directory : APP,
        env: { ...process.env, PYTHONPATH: '' }, timeout: 30000, maxBuffer: 16 * 1024 * 1024,
      })).stdout;
    };
    await use({ ...workbench, left, right, cli });
  },
});

export async function openComparison(page, fixture) {
  await openSession(page, fixture);
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption('comparison');
}
export async function pin(page, side, ref) {
  await page.locator(`#${side}-ref`).fill(ref);
  await page.locator(`#${side}-discover-button`).click();
  await expect(page.locator(`#${side}-revision`)).toContainText(/\b[a-f0-9]{40,64}\b/);
  await expect(page.locator('#stop-button')).toBeDisabled();
}
export async function source(page, side, path) {
  await page.locator(`#${side}-path`).fill(JSON.stringify(path));
  await page.locator(`#${side}-open-source`).click();
  await expect(page.locator(`#${side}-source-caption`)).toContainText(/physical|committed/);
  await expect(page.locator('#stop-button')).toBeDisabled();
}
export async function prepare(page, fixture, leftPath = 'repeated.txt', rightPath = leftPath) {
  await openComparison(page, fixture);
  await pin(page, 'left', 'compare-left');
  await pin(page, 'right', 'compare-right');
  await source(page, 'left', leftPath);
  await source(page, 'right', rightPath);
}
export async function compare(page) {
  await page.locator('#compare-button').click();
  await expect(page.locator('#comparison-download-json')).toHaveAttribute('href', /^blob:/);
  await expect(page.locator('#stop-button')).toBeDisabled();
}
export async function noDownloads(page) {
  for (const format of ['html', 'json']) await expect(page.locator(`#comparison-download-${format}`)).not.toHaveAttribute('href', /^blob:/);
}
export async function exportsMatch(page, fixture, left, right) {
  const json = await downloadText(page, '#comparison-download-json');
  const html = await downloadText(page, '#comparison-download-html');
  expect(json).toBe(await fixture.cli('json', left, right));
  expect(html).toBe(await fixture.cli('html', left, right));
  const token = new URL(fixture.url).hash.slice('#session='.length);
  for (const text of [json, html]) {
    expect(text).not.toContain(token);
    expect(text).not.toContain(fixture.repo);
    expect(text).not.toContain(fixture.directory);
  }
  return { json, html, report: JSON.parse(json) };
}
export const target = (revision, path, selection = { kind: 'whole' }) => ({ revision, path, selection });

// Delays delivery only AFTER the real service has accepted/completed work.
// No fabricated report or job state and no injected production state.
export async function holdComparison(page, boundary = 'complete') {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const reached = new Promise(resolve => { started = resolve; });
  let id, used = false;
  const operations = [];
  await page.route('**/api/jobs', async route => {
    const request = route.request().postDataJSON();
    operations.push(request.operation);
    const response = await route.fetch();
    if (request.operation === 'comparison' && !id) {
      id = (await response.json()).id;
      if (boundary === 'accepted') { used = true; started(); await gate; }
    }
    await route.fulfill({ response }).catch(() => {});
  });
  if (boundary === 'complete') await page.route('**/api/result', async route => {
    const response = await route.fetch();
    const value = await response.json();
    if (!used && route.request().postDataJSON().id === id && value.state === 'complete') {
      used = true; started(); await gate;
    }
    await route.fulfill({ response }).catch(() => {});
  });
  return { release, reached, operations };
}
