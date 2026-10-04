import { test as base, expect } from '@playwright/test';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
export const APP = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PYTHON = process.env.GIT_HISTORY_PYTHON || 'python3';
const gitEnvironment = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_DATE: '2026-10-04T12:00:00+00:00', GIT_COMMITTER_DATE: '2026-10-04T12:00:00+00:00' };
export const SPECIAL_PATH = 'src/odd\tname.py';
export const SOURCE = '# Literal <img src=x onerror="globalThis.OWNED=1">\ndef calculate(value):\n    """Literal </code><script>globalThis.OWNED=1</script> & text."""\n    return value + 2\n';

export const test = base.extend({
  missingNative: [false, { option: true }],
  workbench: async ({ missingNative }, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'git-history-browser-'));
    const repo = join(directory, 'repository');
    await mkdir(repo);
    const git = async (...args) => (await execute('git', ['-C', repo, ...args], { env: gitEnvironment, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
    const write = async (path, value) => { const target = join(repo, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, value); };
    const commit = async message => { await git('add', '--all'); await git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
    let service;
    try {
      await git('init', '-q', '--initial-branch=main');
      await git('config', 'user.name', 'Original Fixture Author');
      await git('config', 'user.email', 'fixture@example.invalid');
      await git('config', 'remote.origin.url', 'https://github.com/fixture/local-evidence.git');
      await write('src/original.py', SOURCE.replace('value + 2', 'value + 1'));
      const initial = await commit('Original local function');
      await write('src/original.py', SOURCE);
      const changed = await commit('Change return value <script>globalThis.OWNED=1</script>');
      await git('mv', 'src/original.py', SPECIAL_PATH);
      await write('src/optional.ts', 'export function add(value: number): number {\n  return value + 2;\n}\n');
      await write('notes.txt', 'Literal manual source <img src=x onerror="globalThis.OWNED=1">\nSecond physical line without trailing LF');
      const revision = await commit('Rename function into a tab-containing path');
      const context = { schema_version: 1, entries: [
        { commit: changed, source: '<img src=x> Original supplied PR', url: 'https://github.com/fixture/local-evidence/pull/1#issuecomment-2',
          author: '<Supplied author>', excerpt: '<script>globalThis.OWNED=1</script> & a locally supplied claim.\nAnother literal line.' },
        { commit: revision, source: 'Supplied rename note', url: 'https://github.com/fixture/local-evidence/issues/2',
          author: 'Fixture author', excerpt: 'A supplied note about the displayed revision; unverified.' },
      ] };
      const args = [join(APP, 'tests/browser/launch_service.py'), '--repo', repo];
      if (missingNative) args.push('--missing-native');
      service = spawn(PYTHON, args, { cwd: directory, env: { ...process.env, PYTHONPATH: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      service.stderr.on('data', chunk => { if (stderr.length < 8192) stderr += chunk.toString(); });
      const startup = await new Promise((resolveStartup, reject) => {
        let output = '';
        const timeout = setTimeout(() => reject(new Error('Local browser fixture service did not start within 10 seconds.')), 10000);
        service.once('exit', () => { clearTimeout(timeout); reject(new Error(`Local fixture service exited before startup: ${stderr.slice(0, 500)}`)); });
        service.stdout.on('data', chunk => {
          output += chunk.toString();
          if (output.length > 4096) { clearTimeout(timeout); reject(new Error('Fixture startup output exceeded its bound.')); return; }
          if (!output.includes('\n')) return;
          try { const value = JSON.parse(output.split('\n', 1)[0]); clearTimeout(timeout); resolveStartup(value); }
          catch { clearTimeout(timeout); reject(new Error('Fixture startup did not provide the expected local session.')); }
        });
      });
      const url = new URL(startup.url);
      if (url.hostname !== '127.0.0.1' || !/^#session=[a-f0-9]{64}$/.test(url.hash)) throw new Error('Fixture must use an ephemeral authenticated loopback session.');
      const cli = async (format, { path = SPECIAL_PATH, functionName = null, lines = '2:4', maxCommits = 20, suppliedContext = null } = {}) => {
        const args = ['-m', 'git_history', 'explain', '--repo', repo, '--ref', revision, '--file', path, '--max-commits', String(maxCommits), '--format', format];
        if (functionName) args.push('--function', functionName); else args.push('--lines', lines);
        if (suppliedContext !== null) { const contextPath = join(directory, 'cli-context.json'); await writeFile(contextPath, JSON.stringify(suppliedContext)); args.push('--context', contextPath); }
        const result = await execute(PYTHON, args, { cwd: process.env.GIT_HISTORY_BROWSER_INSTALLED === '1' ? directory : APP,
          env: { ...process.env, PYTHONPATH: '' }, maxBuffer: 16 * 1024 * 1024, timeout: 30000 });
        return result.stdout;
      };
      await use({ directory, repo, git, write, commit, revision, initial, changed, context, cli,
        url: startup.url, origin: url.origin, nativeAvailable: startup.native_available });
    } finally {
      if (service && service.exitCode === null && service.signalCode === null) {
        service.kill('SIGTERM');
        await new Promise((resolveExit, reject) => {
          const timeout = setTimeout(() => { service.kill('SIGKILL'); reject(new Error('Workbench did not shut down after cancellation within 10 seconds.')); }, 10000);
          service.once('exit', () => { clearTimeout(timeout); resolveExit(); });
        });
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
});
export { expect };

export async function openSession(page, workbench) {
  await page.goto(workbench.url);
  await expect(page.locator('#ref')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
  await expect.poll(() => page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
}
export async function discover(page) {
  await page.getByRole('button', { name: 'Discover files', exact: true }).click();
  await expect(page.locator('#file-list button').first()).toBeVisible();
}
export async function openSource(page, path = SPECIAL_PATH) {
  await page.locator('#path').fill(JSON.stringify(path));
  await page.getByRole('button', { name: 'Open source', exact: true }).click();
  await expect(page.locator('#source-lines tr').first()).toBeVisible();
}
export async function manualReport(page, start = '2', end = '4') {
  await page.locator('#selection-mode').selectOption('lines');
  await page.locator('#start-line').fill(start);
  await page.locator('#end-line').fill(end);
  await page.getByRole('button', { name: 'Generate report', exact: true }).click();
  await expect(page.locator('#download-json')).toHaveAttribute('href', /^blob:/);
}
export async function downloadText(page, selector) {
  const download = page.waitForEvent('download');
  await page.locator(selector).click();
  const file = await download;
  const path = await file.path();
  if (!path) throw new Error('Expected an actual downloaded evidence file.');
  return readFile(path, 'utf8');
}
