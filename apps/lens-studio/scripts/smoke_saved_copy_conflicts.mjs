/* global Buffer, console, process, window, document, indexedDB */
/** Independent Lens #117 maximum source and scalar artifact oracle.
 * Fixture expectations are frozen before saved-copy implementation inspection.
 * No application module supplies expected masks, pixels, JSON or identities.
 * Browser bindings are intentionally deferred until root approves the UI seam.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {performance} from 'node:perf_hooks';
import {chromium, expect} from '@playwright/test';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {URL} from 'node:url';
import {deflateSync} from 'node:zlib';
import {PNG} from 'pngjs';

const SIDE = 1280, PIXELS = SIDE * SIDE;
const PHOTO_CAP = 7 * 1024 * 1024, PROJECT_CAP = 12 * 1024 * 1024;
const HISTORY_CAP = 32 * 1024 * 1024;
const PROJECT_ID = '00000000-0000-4000-8000-000000000117';
const PHOTO_ID = '00000000-0000-4000-8000-000000001117';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = project => Buffer.from(JSON.stringify(project));
const FROZEN_SAMPLES = [[0, 0], [1279, 1279], [64, 640], [319, 320], [400, 500], [640, 640], [879, 800], [1024, 384], [1279, 640]];

function originalPlan() {
  return {schemaVersion: 1, issue: 117, dimensions: {width: SIDE, height: SIDE, pixels: PIXELS},
    identity: {projectId: PROJECT_ID, photoId: PHOTO_ID, title: 'Original maximum lens 00'},
    source: {format: 'PNG', bitDepth: 8, colorType: 6, interlace: 0, filter: 0,
      deflate: 'zlib level 0 (stored DEFLATE blocks), no ancillary padding or metadata',
      formula: 'RGBA = [(17*x+3*y+salt)%256,(5*x+11*y+salt)%256,(7*x+13*y+salt)%256,255]',
      salts: {A: 0, B: 97, C: 97}},
    masks: {A: [400, 880], B: [320, 960], C: [480, 800]},
    settings: {
      A: {mode: 'perspective', sourceFocal: 50, targetFocal: 75, shiftX: .0625, shiftY: -.0312, near: .5, far: 2},
      B: {mode: 'perspective', sourceFocal: 50, targetFocal: 100, shiftX: -.05, shiftY: .025, near: .7, far: 3},
      C: {mode: 'perspective', sourceFocal: 50, targetFocal: 65, shiftX: .125, shiftY: -.0625, near: .8, far: 4},
    },
    samples: FROZEN_SAMPLES, rgbaTolerance: 1,
    localBrush: {x: 640.25, y: 640.25, radius: 2, plane: 0, coordinateTolerance: .001},
    expected: {photoCap: PHOTO_CAP, portableCap: PROJECT_CAP, overflowBytes: PROJECT_CAP + 1,
      wrapperOverhead: 80, historyCap: HISTORY_CAP, historyStateCap: 30, titleEdits: 20},
    differences: ['B preserves project/photo IDs, title and dimensions but changes actual source PNG pixels, mask region boundaries and projection settings.',
      'C preserves B source PNG, IDs, title and dimensions but changes mask region boundaries and projection settings.',
      'Local A changes target focal length to 80 and one original radius-2 near brush stamp at source (640.25,640.25); losing Undo/Redo and outputs retain original A PNG.'],
    limitations: ['The original integer texture and uncompressed DEFLATE deliberately exercise real large decoded pixels and file bytes; they are not worst-case photographic complexity or peak-memory evidence.',
      'Exact 12 MiB JSON admission uses trailing whitespace after complete canonical content; no claim that canonical supported content fills the raw input cap.',
      'The full mask reaches the 32 MiB history-byte cap before 30 edit states; the immutable photo is not charged to those edit states.',
      'Manual labels/projection are authored test inputs, not inferred depth or camera-calibration evidence.',
      'The runner owns only fresh browser processes and directories. An external root-owned same-origin service supplies the production build.']};
}

function pixel(x, y, salt) {
  return [(17 * x + 3 * y + salt) % 256, (5 * x + 11 * y + salt) % 256, (7 * x + 13 * y + salt) % 256, 255];
}
function label(x, boundaries) { return x < boundaries[0] ? 0 : x < boundaries[1] ? 1 : 2; }
function localLabel(x, y) {
  return (x + .5 - 640.25) ** 2 + (y + .5 - 640.25) ** 2 <= 4 ? 0 : label(x, [400, 880]);
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(kind, payload) {
  const name = Buffer.from(kind, 'ascii'), framed = Buffer.alloc(payload.length + 12);
  framed.writeUInt32BE(payload.length); name.copy(framed, 4); payload.copy(framed, 8);
  framed.writeUInt32BE(crc32(Buffer.concat([name, payload])), payload.length + 8);
  return framed;
}
function originalPng(salt) {
  const rows = Buffer.alloc((SIDE * 4 + 1) * SIDE);
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
    const at = y * (SIDE * 4 + 1) + 1 + x * 4;
    rows.set(pixel(x, y, salt), at);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(SIDE); header.writeUInt32BE(SIDE, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(rows, {level: 0})), chunk('IEND', Buffer.alloc(0))]);
}
function mask(boundaries) {
  const labels = Buffer.alloc(PIXELS);
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) labels[y * SIDE + x] = label(x, boundaries);
  return labels;
}
function makeProject(png, boundaries, settings) {
  return {schemaVersion: 1, id: PROJECT_ID, title: 'Original maximum lens 00',
    photo: {id: PHOTO_ID, width: SIDE, height: SIDE, dataUrl: `data:image/png;base64,${png.toString('base64')}`},
    settings, depth: {width: SIDE, height: SIDE, labels: mask(boundaries).toString('base64')}};
}
function editBytes(project) {
  return canonical({title: project.title, settings: project.settings, depth: project.depth}).length;
}

/** At each declared output pixel, invert each authored plane projection and
 * enumerate the finite tent contributors at that point. This source-only
 * scalar check never calls an application render/sampling/PNG function.
 */
function expectedPixel(project, salt, boundaries, x, y, local = false) {
  const s = project.settings, r = s.targetFocal / s.sourceFocal;
  const depths = [s.near, 1, s.far], rgb = [0, 0, 0]; let alpha = 0;
  for (const plane of [2, 1, 0]) {
    const distance = depths[plane], inverse = plane === 1 ? 1 : (distance + r - 1) / (r * distance);
    const sourceX = SIDE / 2 + (x + .5 - SIDE / 2 - s.shiftX * SIDE) * inverse;
    const sourceY = SIDE / 2 + (y + .5 - SIDE / 2 - s.shiftY * SIDE) * inverse;
    let frontAlpha = 0; const front = [0, 0, 0];
    for (let yy = Math.ceil(sourceY - 1.5); yy <= Math.floor(sourceY + .5); yy++) {
      for (let xx = Math.ceil(sourceX - 1.5); xx <= Math.floor(sourceX + .5); xx++) {
        if (xx < 0 || yy < 0 || xx >= SIDE || yy >= SIDE || (local ? localLabel(xx, yy) : label(xx, boundaries)) !== plane) continue;
        const weight = Math.max(0, 1 - Math.abs(sourceX - xx - .5)) * Math.max(0, 1 - Math.abs(sourceY - yy - .5));
        const color = pixel(xx, yy, salt); frontAlpha += weight;
        for (let channel = 0; channel < 3; channel++) front[channel] += color[channel] * weight;
      }
    }
    frontAlpha = Math.min(1, frontAlpha);
    for (let channel = 0; channel < 3; channel++) rgb[channel] = front[channel] + rgb[channel] * (1 - frontAlpha);
    alpha = frontAlpha + alpha * (1 - frontAlpha);
  }
  const a = Math.round(alpha * 255);
  return a ? [...rgb.map(v => Math.round(v / alpha)), a] : [0, 0, 0, 0];
}

async function fixtures(root) {
  await mkdir(root, {recursive: false}); const plan = originalPlan();
  await writeFile(join(root, 'original-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  const sourceA = originalPng(0), sourceB = originalPng(97);
  assert(sourceA.length <= PHOTO_CAP && sourceB.length <= PHOTO_CAP);
  const projects = {
    A: makeProject(sourceA, plan.masks.A, plan.settings.A),
    B: makeProject(sourceB, plan.masks.B, plan.settings.B),
    C: makeProject(sourceB, plan.masks.C, plan.settings.C),
  };
  const paintedLabels = mask(plan.masks.A);
  for (let y = 638; y <= 642; y++) for (let x = 638; x <= 642; x++) paintedLabels[y * SIDE + x] = localLabel(x, y);
  projects.local = {...projects.A, settings: {...projects.A.settings, targetFocal: 80}, depth: {...projects.A.depth, labels: paintedLabels.toString('base64')}};
  const receipt = {schemaVersion: 1, issue: 117, status: 'original-fixtures-frozen', planSha256: hash(canonical(plan)),
    node: process.version, zlib: process.versions.zlib, photos: [], projects: [], samples: {},
    limits: plan.limitations, generatedBy: hash(await readFile(new URL(import.meta.url)))};
  for (const [name, data, salt] of [['source-A.png', sourceA, 0], ['source-B.png', sourceB, 97]]) {
    const decoded = PNG.sync.read(data); assert.equal(decoded.width, SIDE); assert.equal(decoded.height, SIDE);
    for (const [x, y] of FROZEN_SAMPLES) assert.deepEqual([...decoded.data.subarray((y * SIDE + x) * 4, (y * SIDE + x) * 4 + 4)], pixel(x, y, salt));
    await writeFile(join(root, name), data);
    receipt.photos.push({name, bytes: data.length, sha256: hash(data), decodedRgbaBytes: decoded.data.length});
  }
  for (const [name, project] of Object.entries(projects)) {
    const data = canonical(project); assert(data.length <= PROJECT_CAP);
    await writeFile(join(root, `project-${name}.json`), data);
    const rawMask = Buffer.from(project.depth.labels, 'base64'), boundaries = name === 'local' ? plan.masks.A : plan.masks[name];
    assert.equal(rawMask.length, PIXELS); let counts = [0, 0, 0];
    for (let at = 0; at < rawMask.length; at++) { assert.equal(rawMask[at], name === 'local' ? localLabel(at % SIDE, Math.floor(at / SIDE)) : label(at % SIDE, boundaries)); counts[rawMask[at]]++; }
    receipt.projects.push({name, bytes: data.length, sha256: hash(data), maskBytes: rawMask.length,
      maskSha256: hash(rawMask), planeCounts: counts, editStateBytes: editBytes(project)});
    const salt = name === 'A' || name === 'local' ? 0 : 97;
    receipt.samples[name] = FROZEN_SAMPLES.map(([x, y]) => ({x, y, rgba: expectedPixel(project, salt, boundaries, x, y, name === 'local')}));
  }
  const data = canonical(projects.A), raw = Buffer.concat([data, Buffer.alloc(PROJECT_CAP - data.length, 32)]);
  const overflow = Buffer.concat([raw, Buffer.from(' ')]);
  await writeFile(join(root, 'project-A-12MiB.json'), raw); await writeFile(join(root, 'project-A-12MiB-plus-one.json'), overflow);
  receipt.rawInput = {bytes: raw.length, sha256: hash(raw), whitespaceBytes: raw.length - data.length,
    overflowBytes: overflow.length, overflowSha256: hash(overflow)};
  const stateBytes = editBytes(projects.local);
  receipt.history = {photoStoredSeparately: true, editStateBytes: stateBytes,
    expectedRetainedSnapshots: Math.min(30, Math.floor(HISTORY_CAP / stateBytes)), budgetBytes: HISTORY_CAP,
    provesByteCap: stateBytes * Math.floor(HISTORY_CAP / stateBytes) <= HISTORY_CAP && stateBytes * (Math.floor(HISTORY_CAP / stateBytes) + 1) > HISTORY_CAP};
  assert(receipt.history.expectedRetainedSnapshots < 30); assert(receipt.history.provesByteCap);
  await writeFile(join(root, 'fixture-oracle.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({status: 'fixtures-frozen', root, photos: receipt.photos,
    projectBytes: data.length, history: receipt.history}));
}


async function rawStored(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('lens-studio.v1');
    request.onupgradeneeded = () => { request.transaction.abort(); reject(Error('Oracle never creates native storage.')); };
    request.onerror = () => reject(Error('Native snapshot open failed.'));
    request.onsuccess = () => {
      const db = request.result;
      if (db.version !== 2 || !db.objectStoreNames.contains('projects')) { db.close(); reject(Error('Expected version-2 projects store.')); return; }
      const tx = db.transaction('projects', 'readonly'), store = tx.objectStore('projects');
      const kr = store.getKey('current'), vr = store.get('current'); let key, value;
      kr.onsuccess = () => { key = kr.result; }; vr.onsuccess = () => { value = vr.result; };
      tx.oncomplete = () => { db.close(); resolve({present: key !== undefined, value}); };
      tx.onabort = tx.onerror = () => { db.close(); reject(Error('Actual native snapshot failed.')); };
    };
  }));
}
async function idle(page) {
  await expect(page.locator('#retry-load')).toBeEnabled({timeout: 40000});
  await expect(page.getByRole('button', {name: 'Cancel operation', exact: true})).toBeHidden({timeout: 40000});
}
async function rendered(page) {
  await expect(page.locator('#render-status')).toContainText(/^Projection ready\b/i, {timeout: 40000});
  await expect(page.getByRole('button', {name: 'Export PNG', exact: true})).toBeEnabled();
}
async function durable(page, project) {
  // Current truthful success and idle pump precede reading the final UUID:
  // equal historical contents alone do not establish completed queued writes.
  await expect(page.locator('#save-status')).toContainText(/^Saved locally\b/i, {timeout: 40000});
  await idle(page); let snapshot;
  await expect.poll(async () => {
    snapshot = await rawStored(page);
    return snapshot.present && snapshot.value?.schemaVersion === 2 && isDeepStrictEqual(snapshot.value.project, project);
  }, {timeout: 40000, intervals: [100, 250, 500]}).toBe(true);
  assert.deepEqual(Object.keys(snapshot.value).sort(), ['project', 'revision', 'schemaVersion']);
  assert.match(snapshot.value.revision, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  return snapshot.value;
}
async function nativeDownload(page, label, path) {
  const button = page.getByRole('button', {name: label, exact: true}); await expect(button).toBeEnabled();
  const pending = page.waitForEvent('download', {timeout: 40000}); await button.click();
  const item = await pending; await item.saveAs(path); assert.equal(await item.failure(), null); return readFile(path);
}
async function backup(page, expected, out, name, report) {
  const data = await nativeDownload(page, 'Download project', join(out, name));
  assert(isDeepStrictEqual(JSON.parse(data), expected), `${name}: complete project differs.`);
  assert(data.equals(canonical(expected)), `${name}: portable canonical order differs.`);
  report.artifacts.push({name, bytes: data.length, sha256: hash(data)}); return JSON.parse(data);
}
async function pngArtifact(page, name, variant, out, receipt, report) {
  await rendered(page); const data = await nativeDownload(page, 'Export PNG', join(out, name));
  const png = PNG.sync.read(data); assert.equal(png.width, SIDE); assert.equal(png.height, SIDE);
  for (const sample of receipt.samples[variant]) {
    const at = (sample.y * SIDE + sample.x) * 4, actual = [...png.data.subarray(at, at + 4)];
    assert(actual.every((value, channel) => Math.abs(value - sample.rgba[channel]) <= 1), `${name}: scalar mismatch at ${sample.x},${sample.y}.`);
  }
  assert(data.length <= PHOTO_CAP);
  report.artifacts.push({name, bytes: data.length, sha256: hash(data), samplesChecked: receipt.samples[variant].length, rgbaTolerance: 1});
  await rendered(page); // A download need not imply replacement preview paint.
}
async function importFile(page, file, expected) {
  await page.locator('#project-import').setInputFiles(file);
  await expect(page.locator('#message')).toContainText(/Study loaded/i, {timeout: 60000});
  await expect(page.locator('#project-title')).toHaveValue(expected.title);
  await expect(page.locator('#targetFocal')).toHaveValue(String(expected.settings.targetFocal));
  await idle(page); await rendered(page);
}
async function runPrepared(root, out, origin) {
  const url = new URL(origin); assert.equal(url.origin, origin);
  assert(['127.0.0.1', 'localhost'].includes(url.hostname)); assert.equal(url.protocol, 'http:');
  await mkdir(out, {recursive: false}); const plan = JSON.parse(await readFile(join(root, 'original-plan.json')));
  assert(isDeepStrictEqual(plan, originalPlan()), 'Original plan changed.');
  const receipt = JSON.parse(await readFile(join(root, 'fixture-oracle.json'))), projects = {};
  for (const item of receipt.projects) {
    const data = await readFile(join(root, `project-${item.name}.json`));
    assert.equal(data.length, item.bytes); assert.equal(hash(data), item.sha256); projects[item.name] = JSON.parse(data);
  }
  for (const item of receipt.photos) { const data = await readFile(join(root, item.name)); assert.equal(hash(data), item.sha256); assert.equal(data.length, item.bytes); }
  for (const [name, bytes, sha] of [['project-A-12MiB.json', PROJECT_CAP, receipt.rawInput.sha256], ['project-A-12MiB-plus-one.json', PROJECT_CAP + 1, receipt.rawInput.overflowSha256]]) {
    const data = await readFile(join(root, name)); assert.equal(data.length, bytes); assert.equal(hash(data), sha);
  }
  const report = {schemaVersion: 1, issue: 117, status: 'running', startedAt: new Date().toISOString(),
    fixtureReceiptSha256: hash(await readFile(join(root, 'fixture-oracle.json'))), scriptSha256: hash(await readFile(new URL(import.meta.url))),
    browserProcesses: [], chromium: null, originalFacts: {photos: receipt.photos, projects: receipt.projects, rawInput: receipt.rawInput, history: receipt.history},
    artifacts: [], checks: [], pageErrors: [], externalRequests: [], limits: plan.limitations};
  const started = performance.now(), save = () => writeFile(join(out, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  let context;
  const autoAccept = dialog => { void dialog.accept(); };
  const observe = page => {
    page.setDefaultTimeout(40000); page.on('dialog', autoAccept); page.on('pageerror', e => report.pageErrors.push(e.message));
    page.on('request', r => { const u = new URL(r.url()); if (u.protocol.startsWith('http') && u.origin !== origin) report.externalRequests.push(u.origin); });
  };
  const launch = async () => {
    context = await chromium.launchPersistentContext(join(out, 'browser-profile'), {executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      headless: true, viewport: {width: 1440, height: 1000}, acceptDownloads: true});
    const cdp = await context.browser().newBrowserCDPSession(), infos = await cdp.send('SystemInfo.getProcessInfo'); await cdp.detach();
    const pid = infos.processInfo.find(info => info.type === 'browser')?.id; assert(pid);
    report.browserProcesses.push(pid); report.chromium = context.browser().version();
    const page = context.pages()[0] || await context.newPage(); observe(page); return page;
  };
  try {
    const left = await launch(); await left.goto(origin);
    await expect(left.locator('#save-status')).toHaveText('Local storage ready · import a photo or study', {timeout: 40000}); await idle(left);
    // Actual normalization is separate from exact portable fixture identity:
    // native random IDs/compressed bytes are observations; full pixels are fixed.
    await left.locator('#photo-import').setInputFiles(join(root, 'source-A.png'));
    await expect(left.locator('#message')).toContainText(/Study loaded/i, {timeout: 60000}); await rendered(left);
    const normalizedData = await nativeDownload(left, 'Download project', join(out, 'normalized-photo-native.json'));
    const normalized = JSON.parse(normalizedData), decoded = PNG.sync.read(Buffer.from(normalized.photo.dataUrl.split(',')[1], 'base64'));
    assert.equal(decoded.width, SIDE); assert.equal(decoded.height, SIDE);
    for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
      const at = (y * SIDE + x) * 4, wanted = pixel(x, y, 0);
      for (let channel = 0; channel < 4; channel++) assert.equal(decoded.data[at + channel], wanted[channel]);
    }
    await durable(left, normalized);
    report.artifacts.push({name: 'normalized-photo-native.json', bytes: normalizedData.length, sha256: hash(normalizedData), checkedRgbaBytes: decoded.data.length});
    await importFile(left, join(root, 'project-A-12MiB.json'), projects.A); await durable(left, projects.A);
    await backup(left, projects.A, out, 'A-native.json', report); await pngArtifact(left, 'A-projection.png', 'A', out, receipt, report);
    await left.locator('#project-import').setInputFiles(join(root, 'project-A-12MiB-plus-one.json'));
    await expect(left.locator('#message')).toContainText(/Could not load|too large|12 MiB|kept/i, {timeout: 40000}); await idle(left);
    await backup(left, projects.A, out, 'after-overflow-native.json', report); await durable(left, projects.A);
    report.checks.push('Actual photo normalization checks all 6,553,600 RGBA bytes; exact 12 MiB accepted and +1 rejected retaining complete A.'); await save();
    const right = await context.newPage(); observe(right); await right.goto(origin);
    await expect(right.locator('#save-status')).toHaveText('Saved locally · restored this study', {timeout: 60000}); await idle(right); await rendered(right);
    await backup(right, projects.A, out, 'right-original-A-native.json', report);
    await importFile(right, join(root, 'project-B.json'), projects.B); const winner = await durable(right, projects.B);
    await backup(right, projects.B, out, 'B-native.json', report); await pngArtifact(right, 'B-projection.png', 'B', out, receipt, report);
    await left.locator('#targetFocal').fill('80'); await left.getByRole('button', {name: 'Apply settings', exact: true}).click();
    await expect(left.locator('#save-status')).toContainText(/protected|another tab|conflict|changed/i, {timeout: 40000});
    assert(isDeepStrictEqual((await rawStored(left)).value, winner), 'Stale edit overwrote the complete B winner.');
    await left.getByLabel('Paint near', {exact: true}).check(); await left.getByLabel('Brush size', {exact: true}).fill('2');
    const canvas = left.locator('#source-canvas'); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox(); assert(box);
    await canvas.evaluate(canvas => { canvas.addEventListener('pointerdown', event => {
      const b = canvas.getBoundingClientRect(); window.lensMaximumBrush = {trusted: event.isTrusted,
        x: (event.clientX - b.left) * canvas.width / b.width, y: (event.clientY - b.top) * canvas.height / b.height};
    }, {once: true}); });
    await left.mouse.click(box.x + box.width * plan.localBrush.x / SIDE, box.y + box.height * plan.localBrush.y / SIDE);
    const brush = await left.evaluate(() => window.lensMaximumBrush); assert(brush.trusted);
    assert(Math.abs(brush.x - plan.localBrush.x) <= .001 && Math.abs(brush.y - plan.localBrush.y) <= .001);
    report.nativeBrush = brush; await backup(left, projects.local, out, 'local-painted-native.json', report);
    const title = left.locator('#project-title'), focal = left.locator('#targetFocal'), rawTitle = '  Unsubmitted lens 🦉  ';
    await focal.fill('300'); await title.fill(rawTitle);
    await title.evaluate(node => { node.focus(); node.setSelectionRange(3, 9); window.lensMaximumNodes = {title: node, focal: document.querySelector('#targetFocal')}; });
    const rawIntact = async () => {
      await expect(title).toHaveValue(rawTitle); await expect(focal).toHaveValue('300');
      assert(await left.evaluate(() => { const o = window.lensMaximumNodes, t = document.querySelector('#project-title');
        return o.title === t && o.focal === document.querySelector('#targetFocal') && t.selectionStart === 3 && t.selectionEnd === 9;
      }), 'Raw field node/caret changed.');
    };
    await backup(left, projects.local, out, 'local-protected-native.json', report); await pngArtifact(left, 'local-projection.png', 'local', out, receipt, report); await rawIntact();
    for (let step = 0; step < 2; step++) await left.getByRole('button', {name: 'Undo', exact: true}).click();
    await backup(left, projects.A, out, 'local-undo-A-native.json', report); await rawIntact();
    for (let step = 0; step < 2; step++) await left.getByRole('button', {name: 'Redo', exact: true}).click();
    await backup(left, projects.local, out, 'local-redo-native.json', report); await rawIntact();
    assert(isDeepStrictEqual((await rawStored(left)).value, winner), 'Protected Undo/Redo wrote over B.');
    await idle(left); left.off('dialog', autoAccept);
    const dialogPending = left.waitForEvent('dialog'), clickPending = left.locator('#replace-saved-copy').click();
    const dialog = await dialogPending; assert.equal(dialog.type(), 'confirm');
    await importFile(right, join(root, 'project-C.json'), projects.C); const newer = await durable(right, projects.C);
    await dialog.accept(); await clickPending; left.on('dialog', autoAccept);
    await expect(left.locator('#save-status')).toContainText(/protected|changed|another tab|conflict/i, {timeout: 40000}); await idle(left);
    assert(isDeepStrictEqual((await rawStored(left)).value, newer), 'Stale reviewed replacement erased C.'); await rawIntact();
    await backup(left, projects.local, out, 'after-stale-review-native.json', report);
    await left.locator('#replace-saved-copy').click(); const replaced = await durable(left, projects.local);
    assert.notEqual(replaced.revision, newer.revision); await rawIntact(); await backup(left, projects.local, out, 'after-fresh-replacement-native.json', report);
    report.checks.push('Full A/B/C photo/mask/settings identity; protected loser brush/history/raw nodes/caret/PNG; stale review refused and fresh replacement complete.'); await save();
    // Resolve raw fields with actual no-op form actions, never internal flags.
    await title.fill(projects.local.title); await left.getByRole('button', {name: 'Save title', exact: true}).click();
    await focal.fill('80'); await left.getByRole('button', {name: 'Apply settings', exact: true}).click();
    const snapshots = receipt.history.expectedRetainedSnapshots;
    for (let index = 1; index <= 20; index++) {
      const value = `Original maximum lens ${String(index).padStart(2, '0')}`;
      await title.fill(value); await left.getByRole('button', {name: 'Save title', exact: true}).click();
      await durable(left, {...projects.local, title: value});
    }
    for (let step = 1; step < snapshots; step++) {
      await left.getByRole('button', {name: 'Undo', exact: true}).click();
      await expect(title).toHaveValue(`Original maximum lens ${String(20 - step).padStart(2, '0')}`);
    }
    await expect(left.getByRole('button', {name: 'Undo', exact: true})).toBeDisabled();
    for (let step = 1; step < snapshots; step++) await left.getByRole('button', {name: 'Redo', exact: true}).click();
    const final = {...projects.local, title: 'Original maximum lens 20'}, finalStored = await durable(left, final);
    await backup(left, final, out, 'final-native.json', report);
    report.finalStoredReceipt = {schemaVersion: finalStored.schemaVersion, revision: finalStored.revision,
      projectSha256: hash(canonical(final)), completeProjectBytes: canonical(final).length, editStateBytes: editBytes(final),
      wrapperBytes: canonical(finalStored).length, wrapperSha256: hash(canonical(finalStored))};
    report.history = {...receipt.history, undoTransitions: snapshots - 1, redoTransitions: snapshots - 1, distinctNativeTitleCommits: 20, exactPhotoSha256: receipt.photos[0].sha256};
    await save(); await context.close(); context = undefined;
    const reopened = await launch(); await reopened.goto(origin);
    await expect(reopened.locator('#save-status')).toHaveText('Saved locally · restored this study', {timeout: 60000}); await idle(reopened); await rendered(reopened);
    assert(isDeepStrictEqual((await rawStored(reopened)).value, finalStored), 'Full browser restart changed the complete wrapper/project/revision.');
    await backup(reopened, final, out, 'restart-native.json', report); await pngArtifact(reopened, 'restart-projection.png', 'local', out, receipt, report);
    assert(new Set(report.browserProcesses).size >= 2, 'Browser process was not replaced.');
    await reopened.screenshot({path: join(out, 'desktop.png'), fullPage: true}); await reopened.setViewportSize({width: 390, height: 844});
    assert(await reopened.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await reopened.screenshot({path: join(out, 'mobile-390.png'), fullPage: true});
    for (const name of ['desktop.png', 'mobile-390.png']) { const data = await readFile(join(out, name)); report.artifacts.push({name, bytes: data.length, sha256: hash(data)}); }
    assert.equal(report.pageErrors.length, 0); assert.equal(report.externalRequests.length, 0);
    report.checks.push('Measured history-byte cap excludes immutable photo; genuine fresh process retains full native UUID/data and exact backup/PNG.');
    report.status = 'passed'; report.wallMs = performance.now() - started; await save();
    console.log(JSON.stringify({status: report.status, output: out, wallMs: report.wallMs, artifacts: report.artifacts.length, history: report.history}));
  } catch (error) {
    report.status = 'failed'; report.wallMs = performance.now() - started; report.failure = String(error).slice(0, 2000); await save(); throw error;
  } finally { if (context) await context.close(); }
}

const root = resolve(process.env.LENS_CONFLICT_FIXTURES || '/workspace/lens117-maximum-fixtures');
if (process.argv.includes('--fixtures-only')) await fixtures(root);
else if (process.argv.includes('--run-prepared')) {
  assert(process.env.LENS_CONFLICT_OUTPUT, 'Set fresh LENS_CONFLICT_OUTPUT.');
  assert(process.env.LENS_CONFLICT_ORIGIN, 'Set root-owned LENS_CONFLICT_ORIGIN.');
  await runPrepared(root, resolve(process.env.LENS_CONFLICT_OUTPUT), process.env.LENS_CONFLICT_ORIGIN);
} else throw new Error('Choose --fixtures-only or --run-prepared; require root fixture/runtime lease.');
