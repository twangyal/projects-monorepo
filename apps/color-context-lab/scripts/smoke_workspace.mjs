// Run only against a coordinated, frozen production build. No application helpers
// calculate expected pixels: the fixture/oracle was authored independently.
/* global indexedDB, innerWidth, document */
import assert from 'node:assert/strict';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { chromium, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { literalRaster, rawProject, scalar } from '../tests/oracle/color-fixtures.ts';

const outputInput = process.env.COLOR_CONTEXT_OUTPUT_DIR;
assert.ok(outputInput, 'Set COLOR_CONTEXT_OUTPUT_DIR to a new output directory.');
const output = resolve(outputInput);
const address = new URL(process.env.COLOR_CONTEXT_BASE_URL ?? 'http://127.0.0.1:4290');
assert.ok(address.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname), 'Use an existing local HTTP production server.');
assert.ok(!address.username && !address.password && !address.search && !address.hash, 'The workspace URL must not contain credentials, query or fragment.');
await mkdir(output); // Refuse to overwrite any earlier verification artifacts.
const profile = join(output, 'chromium-profile');
const started = performance.now();
const checks = [], artifacts = {}, observations = [];
const report = { schemaVersion: 1, status: 'running', baseUrl: address.href,
  startedAt: new Date().toISOString(), assertions: checks, artifacts,
  browserProcesses: [], observations, phases: {}, limitations: [
    'The maximum fixture imports canonical normalized RGBA, not an original encoded PNG; native PNG normalization is a separate acceptance gate.',
    'Screenshots exercise browser presentation, whose translucent pixels may be quantized. Artifact checks compare decoded PNG RGBA directly.',
    'No human-perception, protection or uploaded-artwork model behavior is measured.'
  ] };
let context;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = literalRaster(720, 720);
const project = rawProject({ mode: 'checker', border: 128, cellSize: 7, colorA: '#1858a0', colorB: '#e8b060' }, source.width, source.height, source.rgba);
project.title = 'Maximum color context · literal <study> 🟩';
project.image.source.fileName = '<img src=x> maximum normalized source.png';
const expected = scalar(project), expectedJson = Buffer.from(JSON.stringify(project));
report.fixture = { imageWidth: 720, imageHeight: 720, outputWidth: 976, outputHeight: 976,
  rawBytes: source.rgba.length, rawSha256: hash(source.rgba), settings: project.settings, expectedMetrics: expected.metrics };

async function saveArtifact(name, bytes) {
  const data = Buffer.from(bytes);
  await writeFile(join(output, name), data);
  artifacts[name] = { bytes: data.length, sha256: hash(data) };
}
function assertPng(bytes, raster, label) {
  const decoded = PNG.sync.read(bytes);
  assert.equal(decoded.width, raster.width, `${label} width`);
  assert.equal(decoded.height, raster.height, `${label} height`);
  assert.ok(decoded.data.equals(Buffer.from(raster.rgba)), `${label} decoded RGBA must match every expected byte, including alpha0 RGB`);
  checks.push(`${label}: every decoded RGBA byte matches the independent oracle`);
}
function assertMetrics(actual, label) {
  for (const [key, value] of Object.entries(expected.metrics)) {
    assert.ok(Number.isFinite(actual[key]), `${label} ${key} must be finite`);
    if (Number.isInteger(value)) assert.equal(actual[key], value, `${label} ${key}`);
    else assert.ok(Math.abs(actual[key] - value) <= 1e-10, `${label} ${key}: ${actual[key]} differs from ${value}`);
  }
  checks.push(`${label}: all seven metrics match the independent oracle (absolute tolerance1e-10 for nonintegers)`);
}
async function observe(page, phase) {
  const record = { phase, pageErrors: [], consoleErrors: [], externalRequests: [], truncated: false };
  observations.push(record);
  const add = (key, value) => { if (record[key].length < 50) record[key].push(String(value).slice(0, 1000)); else record.truncated = true; };
  page.on('pageerror', error => add('pageErrors', error.message));
  page.on('console', message => { if (message.type() === 'error') add('consoleErrors', message.text()); });
  page.on('request', request => {
    const url = request.url();
    if (!url.startsWith('blob:') && !url.startsWith('data:') && new URL(url).origin !== address.origin) add('externalRequests', url);
  });
  page.on('dialog', async dialog => { assert.equal(dialog.type(), 'confirm', 'Only explicit expected confirmation dialogs are accepted'); await dialog.accept(); });
  page.setDefaultTimeout(30000);
  return page;
}
async function launch(phase) {
  const next = await chromium.launchPersistentContext(profile, {
    headless: true, acceptDownloads: true, viewport: { width: 1440, height: 1000 },
    executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium'
  });
  const page = await observe(next.pages()[0] ?? await next.newPage(), phase);
  const browser = next.browser();
  assert.ok(browser, 'Persistent context must expose its actual browser process');
  const cdp = await browser.newBrowserCDPSession();
  const processes = await cdp.send('SystemInfo.getProcessInfo');
  await cdp.detach();
  const browserProcess = processes.processInfo.find(info => info.type === 'browser');
  assert.ok(browserProcess, 'Browser process identity must be observable');
  report.browserProcesses.push({ phase, processId: browserProcess.id, version: browser.version() });
  return { context: next, page };
}
async function getRawSaved(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('color-context-lab.v1', 1);
    request.onerror = () => reject(new Error('Cannot inspect saved project'));
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('projects', 'readonly'), store = tx.objectStore('projects');
      const key = store.getKey('current'), value = store.get('current');
      tx.oncomplete = () => { const result = { present: key.result !== undefined, value: value.result }; db.close(); resolve(result); };
      tx.onabort = () => { db.close(); reject(new Error('Saved project read aborted')); };
    };
  }));
}
async function downloaded(page, selector, name) {
  await expect(page.locator(selector)).toBeEnabled();
  const waiting = page.waitForEvent('download', { timeout: 30000 });
  await page.locator(selector).click();
  const download = await waiting;
  assert.equal(await download.failure(), null, `${name}: download must finish`);
  const path = await download.path(); assert.ok(path);
  const bytes = await readFile(path);
  await saveArtifact(name, bytes);
  return bytes;
}
async function previewReady(page) {
  await expect(page.locator('#preview-status')).toHaveText('Applied settings preview ready.', { timeout: 30000 });
  await expect(page.locator('#metrics')).toContainText('Artwork pixels unchanged');
}
async function inspectWorkspaceMetrics(page) {
  const fields = await page.locator('#metrics').evaluate(container => Object.fromEntries([...container.querySelectorAll('dt')].map(dt => [dt.textContent, Number(dt.nextElementSibling?.textContent)])));
  assertMetrics({ artworkChangedPixels: fields['Changed artwork pixels'], artworkMaxChannelDelta: fields['Artwork maximum RGBA delta'], surroundPixels: fields['Surround pixels'], totalPixels: fields['Total pixels'], rgbRmse: fields['Encoded RGB RMSE (byte units)'], maxRgbDelta: fields['Maximum RGB delta (byte units)'], meanAbsoluteLuminanceDelta: fields['Mean absolute relative luminance delta'] }, 'Workspace');
}
async function inspectHtml(bytes, phase) {
  assert.ok(bytes.length <= 16 * 1024 ** 2, 'Complete HTML stays within16MiB');
  const html = bytes.toString('utf8');
  assert.ok(!/<script(?:\s|>)/i.test(html), 'Report must contain no executable scripts');
  assert.ok(!html.includes('<img src=x>'), 'Supplied filename must stay escaped');
  const embedded = [...html.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)];
  assert.equal(embedded.length, 2, 'Complete report embeds exactly two PNGs');
  const neutral = Buffer.from(embedded[0][1], 'base64'), result = Buffer.from(embedded[1][1], 'base64');
  assertPng(neutral, expected.baseline, `${phase} embedded baseline`); assertPng(result, expected.result, `${phase} embedded result`);
  await saveArtifact(`${phase}-embedded-baseline.png`, neutral); await saveArtifact(`${phase}-embedded-result.png`, result);
  const page = await observe(await context.newPage(), `${phase} HTML`);
  await page.setContent(html, { waitUntil: 'load' });
  await expect(page.locator('h1')).toHaveText(project.title);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  assert.ok(csp?.includes("default-src 'none'") && csp.includes("base-uri 'none'"), 'Report must retain its restrictive CSP');
  const fields = await page.locator('dl').evaluate(container => Object.fromEntries([...container.querySelectorAll('dt')].map(dt => [dt.textContent, dt.nextElementSibling?.textContent])));
  assert.equal(fields['Normalized raw RGBA SHA-256'], report.fixture.rawSha256);
  assert.equal(fields['Source label'], project.image.source.fileName);
  assert.equal(fields['Normalized dimensions'], '720 × 720'); assert.equal(fields['Output dimensions'], '976 × 976');
  assertMetrics({ artworkChangedPixels: Number(fields['Artwork changed pixels (any RGBA byte)']), artworkMaxChannelDelta: Number(fields['Artwork maximum RGBA byte delta']), surroundPixels: Number(fields['Surround pixels']), totalPixels: Number(fields['Total pixels']), rgbRmse: Number(fields['RGB RMSE (encoded-sRGB bytes; denominator 3 × total pixels)']), maxRgbDelta: Number(fields['Maximum encoded-sRGB RGB byte delta']), meanAbsoluteLuminanceDelta: Number(fields['Mean absolute linear-Y luminance delta (denominator total pixels)']) }, `${phase} HTML`);
  assert.equal(await page.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth === 976 && image.naturalHeight === 976)), true);
  await page.close();
}
async function artifactsFor(page, phase) {
  const result = {};
  for (const [kind, extension] of [['source', 'png'], ['result', 'png'], ['project', 'json'], ['report', 'html']]) result[kind] = await downloaded(page, `#download-${kind}`, `${phase}-${kind}.${extension}`);
  assertPng(result.source, source, `${phase} source`); assertPng(result.result, expected.result, `${phase} result`);
  assert.ok(result.project.equals(expectedJson), `${phase} complete project must be byte-identical canonical fixture`);
  await inspectHtml(result.report, phase);
  return result;
}
try {
  await saveArtifact('input-max-project.json', expectedJson);
  const initialStarted = performance.now();
  const first = await launch('before-restart'); context = first.context;
  const page = first.page;
  await page.goto(address.href);
  await expect(page.locator('#project-file')).toBeEnabled();
  await page.locator('#project-file').setInputFiles({ name: 'max-project.json', mimeType: 'application/json', buffer: expectedJson });
  await expect(page.locator('#project-title')).toHaveValue(project.title);
  await previewReady(page); await inspectWorkspaceMetrics(page);
  await page.locator('#save-current').click();
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser.');
  const saved = await getRawSaved(page);
  assert.deepEqual(saved, { present: true, value: expectedJson.toString('utf8') });
  checks.push('Explicit Save completed and native readonly transaction proves exact current record');
  const before = await artifactsFor(page, 'before');
  await page.screenshot({ path: join(output, 'workspace-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#download-report')).toBeEnabled();
  const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(geometry.scrollWidth <= geometry.width + 1, 'Maximum workspace must not overflow390px viewport');
  report.mobileGeometry = geometry;
  await page.screenshot({ path: join(output, 'workspace-mobile-390.png'), fullPage: true });
  for (const name of ['workspace-desktop.png', 'workspace-mobile-390.png']) { const bytes = await readFile(join(output, name)); artifacts[name] = { bytes: bytes.length, sha256: hash(bytes) }; }
  report.phases.beforeRestartSeconds = (performance.now() - initialStarted) / 1000;
  await context.close(); context = undefined;
  const restartStarted = performance.now();
  const second = await launch('after-restart'); context = second.context;
  assert.notEqual(report.browserProcesses[0].processId, report.browserProcesses[1].processId, 'A fresh Chromium process must replace the first process');
  await second.page.goto(address.href);
  await expect(second.page.locator('#project-title')).toHaveValue(project.title);
  await previewReady(second.page); await inspectWorkspaceMetrics(second.page);
  assert.deepEqual(await getRawSaved(second.page), saved);
  const after = await artifactsFor(second.page, 'after');
  for (const kind of ['source', 'result', 'project', 'report']) assert.ok(after[kind].equals(before[kind]), `${kind} must be byte-identical after complete process restart`);
  checks.push('Full persistent Chromium process restart preserves byte-identical project, source/result PNG and HTML report');
  report.phases.afterRestartSeconds = (performance.now() - restartStarted) / 1000;
  for (const observation of observations) {
    assert.deepEqual(observation.pageErrors, [], `${observation.phase}: page errors`);
    assert.deepEqual(observation.consoleErrors, [], `${observation.phase}: console errors`);
    assert.deepEqual(observation.externalRequests, [], `${observation.phase}: external requests`);
    assert.equal(observation.truncated, false, 'Diagnostics must not exceed bounded log capacity');
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error?.stack ?? error).slice(0, 8000);
  process.exitCode = 1;
} finally {
  await context?.close();
  report.completedAt = new Date().toISOString(); report.durationSeconds = (performance.now() - started) / 1000;
  await writeFile(join(output, 'verification.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, output, durationSeconds: report.durationSeconds, error: report.error }));
}
