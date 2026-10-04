import {test, expect} from '@playwright/test';
import {readFile, stat, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

const KEY = 'shot-studio-v1';
// Authored from the original v1 export contract, without importing the model.
function legacyFilm() {
  return {schemaVersion: 1, title: 'Original camera study', light: 1,
    actors: [{name: 'Red landmark', x: -1.25, z: 0, color: '#ff0000', action: 'idle'},
      {name: 'Green landmark', x: 1.25, z: 0, color: '#00ff00', action: 'idle'}],
    shots: [{name: 'Truck study', duration: 2, eye: [-2, 2.2, 8], target: [-2, 1.15, 0], fov: 50},
      {name: 'Next cut', duration: 2, eye: [0, 2.2, 5], target: [0, 1.15, 0], fov: 40}]};
}
// Literal old backups remain old; assertions compare their explicit migrated form.
function canonicalFilm(project) {
  return {...project, schemaVersion: 3, actors: project.actors.map(actor => ({...actor, performanceMode: 'loop'}))};
}
function travelFilm() {
  const project = legacyFilm(); project.schemaVersion = 2;
  project.shots[0] = {...project.shots[0], cameraMode: 'linear', endEye: [2, 2.2, 8], endTarget: [2, 1.15, 0]};
  project.shots[1].cameraMode = 'static'; return project;
}
async function openFilm(page, project = legacyFilm(), name = 'authored-film.json') {
  await page.goto('/'); await expect(page.locator('#stage')).toBeVisible();
  await page.locator('#import').setInputFiles({name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project))});
  await expect(page.getByLabel('Film title', {exact: true})).toHaveValue(project.title);
}
async function download(page, name = 'Save project') {
  const waiting = page.waitForEvent('download'); await page.getByRole('button', {name, exact: true}).click();
  const file = await waiting, path = await file.path();
  if (!path) throw Error('Expected a real downloaded artifact.');
  return {file, path, text: await readFile(path, 'utf8')};
}
async function backup(page) { return JSON.parse((await download(page)).text); }
async function raw(page) { return page.evaluate(key => localStorage.getItem(key), KEY); }
async function edit(page, id, value) { await page.locator(`#${id}`).fill(String(value)); await page.locator(`#${id}`).press('Tab'); }
async function filmPosition(page, seconds) {
  await page.locator('#scrub').evaluate((input, value) => {
    input.value = String(value); input.dispatchEvent(new Event('input', {bubbles: true}));
  }, seconds);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function sampleCanvas(page) {
  const frame = await page.locator('#stage').evaluate(canvas => {
    return {png: canvas.toDataURL('image/png').split(',')[1], width: canvas.width, height: canvas.height,
      time: Number(document.querySelector('#time').textContent.split('/')[0].trim())};
  });
  // Native PNG transports the exact canvas pixels without serializing two million
  // JS numbers through the browser protocol. Decode without scaling/filtering.
  const pixels = execFileSync('ffmpeg', ['-v', 'error', '-threads', '1', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'],
    {input: Buffer.from(frame.png, 'base64'), timeout: 10_000, maxBuffer: 4 * 1024 * 1024});
  expect(pixels.length).toBe(frame.width * frame.height * 4);
  return {pixels, width: frame.width, height: frame.height, time: frame.time};
}
function landmark(pixels, width, height, color, channels = 3) {
  let count = 0, sumX = 0, sumY = 0, minX = width, maxX = -1, minY = height, maxY = -1;
  const dominant = color === 'red' ? 0 : 1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * channels;
    if (pixels[offset + dominant] <= 80 || [0, 1, 2].some(channel => channel !== dominant && pixels[offset + dominant] <= 2 * pixels[offset + channel])) continue;
    count++; sumX += x; sumY += y; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  expect(count, `${color} isolated costume pixels`).toBeGreaterThan(400);
  expect(count).toBeLessThan(50_000);
  return {x: sumX / count, y: sumY / count, minX, maxX, minY, maxY, count};
}
// Independent scalar pinhole basis, never importing renderer/matrix/camera code.
function projectPoint(point, eye, target, fov, width = 960, height = 540) {
  const norm = vector => { const length = Math.hypot(...vector); return vector.map(value => value / length); };
  const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  const forward = norm(target.map((value, index) => value - eye[index]));
  const right = norm([-forward[2], 0, forward[0]]);
  const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
  const relative = point.map((value, index) => value - eye[index]), depth = dot(relative, forward);
  const focal = height / (2 * Math.tan(fov * Math.PI / 360));
  return {x: width / 2 + focal * dot(relative, right) / depth, y: height / 2 - focal * dot(relative, up) / depth};
}
function expectedLandmark(actorX, camera) {
  const center = projectPoint([actorX, 1.15, 0], camera.eye, camera.target, camera.fov);
  const boxes = [[actorX, 1.15, 0, .5, .65, .32], [actorX - .4, 1.13, 0, .15, .65, .2], [actorX + .4, 1.13, 0, .15, .65, .2]];
  const vertices = boxes.flatMap(([x, y, z, sx, sy, sz]) => [-1, 1].flatMap(a => [-1, 1].flatMap(b => [-1, 1].map(c =>
    projectPoint([x + a * sx / 2, y + b * sy / 2, z + c * sz / 2], camera.eye, camera.target, camera.fov)))));
  return {...center, minX: Math.min(...vertices.map(vertex => vertex.x)), maxX: Math.max(...vertices.map(vertex => vertex.x)),
    minY: Math.min(...vertices.map(vertex => vertex.y)), maxY: Math.max(...vertices.map(vertex => vertex.y))};
}
function verifyProjection(observed, camera, actorX) {
  const expected = expectedLandmark(actorX, camera);
  for (const coordinate of ['x', 'y', 'minX', 'maxX', 'minY', 'maxY']) {
    expect(Math.abs(observed[coordinate] - expected[coordinate]), `${coordinate}: observed ${observed[coordinate]}, independent ${expected[coordinate]}`).toBeLessThanOrEqual(16);
  }
  return expected;
}
async function holdImports(page) {
  await page.addInitScript(() => {
    const nativeText = File.prototype.text;
    window.travelReads = {pending: [], reads: 0};
    File.prototype.text = async function () {
      window.travelReads.reads++;
      const text = await nativeText.call(this);
      if (this.name === 'held-film.json') await new Promise(resolve => window.travelReads.pending.push(resolve));
      return text;
    };
  });
}
async function sendHeldImport(page) {
  const incoming = travelFilm(); incoming.title = 'Incoming replacement must stay unapplied';
  await page.locator('#import').setInputFiles({name: 'held-film.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming))});
  await expect.poll(() => page.evaluate(() => window.travelReads.pending.length)).toBe(1);
}
async function releaseImport(page) {
  await page.evaluate(() => { for (const resolve of window.travelReads.pending.splice(0)) resolve(); });
}

const failures = new WeakMap();
test.beforeEach(async ({page, baseURL}) => {
  const errors = [], external = []; failures.set(page, {errors, external});
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).origin !== new URL(baseURL).origin) external.push(request.url()); });
});
test.afterEach(async ({page}) => { expect(failures.get(page).errors).toEqual([]); expect(failures.get(page).external).toEqual([]); });

test('native endpoint authoring copies, captures and reverses explicit travel without losing the Start camera', async ({page}) => {
  const original = legacyFilm(); await openFilm(page, original);
  await expect(page.getByRole('combobox', {name: 'Camera motion', exact: true})).toHaveValue('static');
  await page.locator('#cameraMode').selectOption('linear');
  let film = await backup(page);
  expect(film.schemaVersion).toBe(3); expect(film.shots[0]).toMatchObject({cameraMode: 'linear', endEye: original.shots[0].eye, endTarget: original.shots[0].target});
  await page.locator('#cameraEndpoint').selectOption('end'); await edit(page, 'eyeX', 2); await edit(page, 'targetX', 2); await edit(page, 'fov', 55);
  film = await backup(page);
  expect(film.shots[0]).toEqual({...original.shots[0], cameraMode: 'linear', fov: 55, endEye: [2, 2.2, 8], endTarget: [2, 1.15, 0]});
  await page.getByRole('button', {name: 'Copy other endpoint', exact: true}).click();
  expect((await backup(page)).shots[0]).toMatchObject({endEye: original.shots[0].eye, endTarget: original.shots[0].target, fov: 55});
  await page.getByRole('button', {name: 'Undo scene', exact: true}).click();
  await page.locator('#cameraEndpoint').selectOption('end'); await filmPosition(page, 1);
  await page.getByRole('button', {name: 'Use current preview', exact: true}).click();
  expect((await backup(page)).shots[0]).toMatchObject({eye: original.shots[0].eye, target: original.shots[0].target, endEye: [0, 2.2, 8], endTarget: [0, 1.15, 0], fov: 55});
  await page.getByRole('button', {name: 'Undo scene', exact: true}).click();
  const moving = await backup(page);
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('#cameraMode').selectOption('static');
  expect(await backup(page)).toEqual(moving); await expect(page.locator('#cameraMode')).toHaveValue('linear');
  page.once('dialog', async dialog => { expect(dialog.message()).toMatch(/end|travel/i); expect(dialog.message()).toMatch(/undo/i); await dialog.accept(); });
  await page.locator('#cameraMode').selectOption('static');
  expect((await backup(page)).shots[0]).toEqual({...original.shots[0], cameraMode: 'static', fov: 55});
  await page.getByRole('button', {name: 'Undo scene', exact: true}).click(); expect(await backup(page)).toEqual(moving);
  await page.reload(); await expect(page.locator('#cameraMode')).toHaveValue('linear'); expect(await backup(page)).toEqual(moving);
});

test('editing endpoints stay separate from an exact film cut and real rehearsal camera', async ({page}) => {
  const project = travelFilm(); await openFilm(page, project); await filmPosition(page, 0);
  const initialRaw = await raw(page), initial = await sampleCanvas(page);
  const startRed = landmark(initial.pixels, initial.width, initial.height, 'red', 4);
  await page.locator('#cameraEndpoint').selectOption('end');
  await expect(page.locator('#eyeX')).toHaveValue('2'); await expect(page.locator('#endpointLabel')).toContainText(/end/i);
  const selected = await sampleCanvas(page);
  expect(Math.abs(landmark(selected.pixels, selected.width, selected.height, 'red', 4).x - startRed.x)).toBeLessThanOrEqual(4);
  await expect(page.locator('#time')).toHaveText('0.00 / 4.00s');
  await page.getByRole('button', {name: 'Preview endpoint', exact: true}).click(); await filmPositionFrame(page);
  await expect(page.locator('#shotLabel')).toContainText(/end.*endpoint|endpoint.*end/i);
  await expect(page.locator('#shotLabel')).toContainText(/not.*film.*cut/i);
  await expect(page.locator('#time')).toHaveText('2.00 / 4.00s');
  const endpoint = await sampleCanvas(page);
  verifyProjection(landmark(endpoint.pixels, 960, 540, 'red', 4), {eye: [2, 2.2, 8], target: [2, 1.15, 0], fov: 50}, -1.25);
  await filmPosition(page, 2); await expect(page.locator('#shotLabel')).toContainText('CAMERA 02');
  await expect(page.locator('#shots button').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', {name: 'Use current preview', exact: true})).toBeDisabled();
  const nextCut = await sampleCanvas(page);
  verifyProjection(landmark(nextCut.pixels, 960, 540, 'red', 4), project.shots[1], -1.25);
  expect(await raw(page)).toBe(initialRaw);
  await filmPosition(page, 1);
  await page.getByRole('button', {name: 'Preview endpoint', exact: true}).click();
  await page.getByRole('button', {name: 'Rehearse', exact: true}).click();
  // The prior endpoint already displays 2s until the next real animation frame.
  // Admit the actual PNG and its time together, then verify that same frame.
  let moving;
  await expect.poll(async () => {
    const frame = await sampleCanvas(page);
    if (frame.time > .1 && frame.time < 1) { moving = frame; return true; }
    return false;
  }).toBe(true);
  expect(moving.time).toBeGreaterThan(.1); expect(moving.time).toBeLessThan(1);
  const x = -2 + 2 * moving.time;
  verifyProjection(landmark(moving.pixels, 960, 540, 'red', 4), {eye: [x, 2.2, 8], target: [x, 1.15, 0], fov: 50}, -1.25);
  await page.getByRole('button', {name: 'Stop', exact: true}).click(); await filmPositionFrame(page);
  await expect(page.locator('#time')).toHaveText('0.00 / 4.00s'); expect(await raw(page)).toBe(initialRaw);
});
async function filmPositionFrame(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }

test('endpoint presets, duration, cloning and shot ordering retain complete independently editable travel', async ({page}) => {
  await openFilm(page, travelFilm()); await page.locator('#cameraEndpoint').selectOption('end');
  await page.getByRole('combobox', {name: 'Camera preset', exact: true}).selectOption('wide');
  expect((await backup(page)).shots[0]).toMatchObject({eye: [-2, 2.2, 8], target: [-2, 1.15, 0], endEye: [5, 3, 7], endTarget: [0, 1, 0], fov: 45});
  await page.getByRole('button', {name: 'Undo scene', exact: true}).click(); await page.locator('#cameraEndpoint').selectOption('end');
  await page.getByRole('button', {name: 'Preview endpoint', exact: true}).click(); await edit(page, 'duration', 3); await filmPositionFrame(page);
  await expect(page.locator('#time')).toHaveText('3.00 / 5.00s');
  const prior = await backup(page); expect(prior.shots[0].endEye).toEqual([2, 2.2, 8]);
  await page.getByRole('button', {name: 'Add shot', exact: true}).click();
  let added = await backup(page); expect(added.shots[2]).toEqual({...prior.shots[0], name: 'Shot 3', duration: 2});
  await edit(page, 'eyeX', -1); added = await backup(page);
  expect(added.shots[0]).toEqual(prior.shots[0]); expect(added.shots[2].eye).toEqual([-1, 2.2, 8]);
  await page.getByRole('button', {name: 'Move earlier', exact: true}).click();
  const ordered = await backup(page); expect(ordered.shots).toEqual([added.shots[0], added.shots[2], added.shots[1]]);
  await page.getByRole('button', {name: 'Undo scene', exact: true}).click(); expect(await backup(page)).toEqual(added);
  await page.getByRole('button', {name: 'Redo scene', exact: true}).click(); expect(await backup(page)).toEqual(ordered);
  const exported = await download(page); await page.locator('#import').setInputFiles(exported.path);
  expect(await backup(page)).toEqual(ordered); await page.reload(); expect(await backup(page)).toEqual(ordered);
});

test('invalid interior path and empty coordinates preserve raw edits, committed preview and redo', async ({page}) => {
  const project = travelFilm(); Object.assign(project.shots[0], {eye: [0, 2, 8], target: [0, 2, 0], endEye: [0, 2, 6], endTarget: [0, 2, 0]});
  await openFilm(page, project); await edit(page, 'title', 'A valid redo branch');
  await page.getByRole('button', {name: 'Undo scene', exact: true}).click();
  await page.locator('#cameraEndpoint').selectOption('end'); await filmPosition(page, .4);
  const committed = await backup(page), stored = await raw(page);
  await edit(page, 'eyeZ', -8); await expect(page.locator('#eyeZ')).toHaveValue('-8');
  await expect(page.locator('#status')).toContainText(/path|camera|separation/i);
  expect(await backup(page)).toEqual(committed); expect(await raw(page)).toBe(stored);
  await expect(page.locator('#time')).toHaveText('0.40 / 4.00s');
  for (const [id, value] of [['cameraEndpoint', 'start'], ['cameraMode', 'static'], ['actor', '1']]) {
    if (await page.locator(`#${id}`).isEnabled()) await page.locator(`#${id}`).selectOption(value);
    await expect(page.locator('#eyeZ')).toHaveValue('-8'); expect(await raw(page)).toBe(stored);
  }
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', {name: 'Discard unsent edits', exact: true}).click();
  await expect(page.locator('#eyeZ')).toHaveValue('-8');
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', {name: 'Discard unsent edits', exact: true}).click();
  await expect(page.locator('#eyeZ')).toHaveValue('6');
  await page.locator('#eyeX').fill(''); await page.locator('#eyeX').press('Tab');
  await expect(page.locator('#eyeX')).toHaveValue(''); expect(await backup(page)).toEqual(committed); expect(await raw(page)).toBe(stored);
  await expect(page.locator('#status')).toContainText(/unsent|committed|draft/i);
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', {name: 'Discard unsent edits', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Redo scene', exact: true})).toBeEnabled();
  await page.getByRole('button', {name: 'Redo scene', exact: true}).click(); await expect(page.getByLabel('Film title', {exact: true})).toHaveValue('A valid redo branch');
});

for (const intent of ['endpoint', 'shot', 'mode', 'copy', 'preview capture']) {
  test(`a delayed native import cannot override newer ${intent} intent`, async ({page}) => {
    await holdImports(page); await openFilm(page, travelFilm());
    if (intent === 'copy' || intent === 'preview capture') await page.locator('#cameraEndpoint').selectOption('end');
    if (intent === 'preview capture') await filmPosition(page, 1);
    await sendHeldImport(page);
    if (intent === 'endpoint') await page.locator('#cameraEndpoint').selectOption('end');
    if (intent === 'shot') await page.locator('#shots button').nth(1).click();
    if (intent === 'mode') { page.once('dialog', dialog => dialog.accept()); await page.locator('#cameraMode').selectOption('static'); }
    if (intent === 'copy') await page.getByRole('button', {name: 'Copy other endpoint', exact: true}).click();
    if (intent === 'preview capture') await page.getByRole('button', {name: 'Use current preview', exact: true}).click();
    const durable = await raw(page), current = await backup(page);
    await releaseImport(page); await expect(page.locator('#status')).toContainText(/scene changed while opening/i);
    expect(await backup(page)).toEqual(current); expect(await raw(page)).toBe(durable);
    if (intent === 'endpoint') await expect(page.locator('#cameraEndpoint')).toHaveValue('end');
    if (intent === 'shot') await expect(page.locator('#shots button').nth(1)).toHaveAttribute('aria-pressed', 'true');
  });
}

test('focused off-step End typing defeats a pending import and preexisting raw edits block a new read', async ({page}) => {
  await holdImports(page); await openFilm(page, travelFilm()); await page.locator('#cameraEndpoint').selectOption('end');
  const durable = await raw(page), current = await backup(page); await sendHeldImport(page);
  await page.locator('#eyeX').fill('6.250'); await releaseImport(page);
  await expect(page.locator('#status')).toContainText(/scene changed while opening/i);
  await expect(page.locator('#eyeX')).toHaveValue('6.250'); await expect(page.locator('#eyeX')).toBeFocused();
  expect(await raw(page)).toBe(durable);
  const readCount = await page.evaluate(() => window.travelReads.reads);
  await page.locator('#import').setInputFiles({name: 'blocked-before-read.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({...current, title: 'Must not read or apply'}))});
  await expect(page.locator('#status')).toContainText(/unsent|draft|correct|discard/i);
  expect(await page.evaluate(() => window.travelReads.reads)).toBe(readCount);
  await expect(page.locator('#eyeX')).toHaveValue('6.250'); await expect(page.locator('#eyeX')).toBeFocused();
  // Clicking Save would intentionally blur and commit this valid numeric draft.
  // Inspect the native record without changing focus, then commit with real Tab.
  expect(await raw(page)).toBe(durable);
  await page.locator('#eyeX').press('Tab');
  expect((await backup(page)).shots[0]).toMatchObject({endEye: [6.25, 2.2, 8], eye: [-2, 2.2, 8]});
});

test('genuine original v1 draft migrates only in memory and real editing writes exact schema 3', async ({page}) => {
  const legacy = legacyFilm(), originalRaw = JSON.stringify(legacy, null, 2) + '\n';
  await page.addInitScript(({key, text}) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, text);
    const set = Storage.prototype.setItem; window.travelWrites = 0;
    Storage.prototype.setItem = function (name, value) { if (name === key) window.travelWrites++; return set.call(this, name, value); };
  }, {key: KEY, text: originalRaw});
  await page.goto('/'); await expect(page.getByLabel('Film title', {exact: true})).toHaveValue(legacy.title);
  const canonical = {...legacy, schemaVersion: 3, actors: legacy.actors.map(actor => ({...actor, performanceMode: 'loop'})), shots: legacy.shots.map(shot => ({...shot, cameraMode: 'static'}))};
  expect(await backup(page)).toEqual(canonical); expect(await raw(page)).toBe(originalRaw);
  expect(await page.evaluate(() => window.travelWrites)).toBe(0);
  await expect(page.locator('#cameraEndpoint option[value=end]')).toBeDisabled();
  await filmPosition(page, 1); await page.getByRole('button', {name: 'Preview endpoint', exact: true}).click();
  expect(await raw(page)).toBe(originalRaw); expect(await page.evaluate(() => window.travelWrites)).toBe(0);
  await edit(page, 'title', 'Edited canonical static film');
  expect(JSON.parse(await raw(page))).toEqual({...canonical, title: 'Edited canonical static film'});
  await page.reload(); await expect(page.getByLabel('Film title', {exact: true})).toHaveValue('Edited canonical static film');
  expect((await backup(page)).schemaVersion).toBe(3);
});

for (const rejected of ['motion-bearing v1', 'future schema']) {
  test(`${rejected} recovery bytes survive motion authoring and failed explicit replacement`, async ({page}) => {
    const invalid = travelFilm(); invalid.schemaVersion = rejected === 'motion-bearing v1' ? 1 : 99;
    const text = JSON.stringify(invalid, null, 2) + '\n';
    await page.goto('/'); await page.evaluate(({key, value}) => localStorage.setItem(key, value), {key: KEY, value: text}); await page.reload();
    await expect(page.locator('#status')).toContainText(/preserved|blocked/i);
    const recovery = await download(page, 'Download unreadable draft');
    expect(JSON.parse(recovery.text)).toEqual({schemaVersion: 1, kind: 'unreadable-shot-studio-draft', storageKey: KEY, raw: text});
    await page.locator('#import').setInputFiles({name: 'valid-travel.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(travelFilm()))});
    await expect(page.getByLabel('Film title', {exact: true})).toHaveValue(legacyFilm().title);
    await expect(page.locator('#cameraMode')).toHaveValue('linear'); expect(await backup(page)).toEqual(canonicalFilm(travelFilm())); expect(await raw(page)).toBe(text);
    page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', {name: 'Replace browser draft', exact: true}).click(); expect(await raw(page)).toBe(text);
    await page.evaluate(() => { const put = Storage.prototype.setItem; window.restoreTravelStorage = () => { Storage.prototype.setItem = put; };
      Storage.prototype.setItem = function (key, value) { if (key === 'shot-studio-v1') throw new DOMException('Full', 'QuotaExceededError'); return put.call(this, key, value); }; });
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', {name: 'Replace browser draft', exact: true}).click();
    await expect(page.locator('#status')).toContainText(/could not replace/i); expect(await raw(page)).toBe(text); expect(await backup(page)).toEqual(canonicalFilm(travelFilm()));
    await page.evaluate(() => window.restoreTravelStorage());
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', {name: 'Replace browser draft', exact: true}).click();
    expect(JSON.parse(await raw(page))).toEqual(canonicalFilm(travelFilm())); await page.reload(); await expect(page.locator('#cameraMode')).toHaveValue('linear');
    expect(await backup(page)).toEqual(canonicalFilm(travelFilm()));
  });
}

test('controlled XR captures the frozen End only and rejects an interior-singular path without false success', async ({page}) => {
  await page.addInitScript(() => {
    WebGLRenderingContext.prototype.makeXRCompatible = async () => {};
    window.XRWebGLLayer = class {};
    Object.defineProperty(navigator, 'xr', {configurable: true, value: {isSessionSupported: async () => true, requestSession: async () => {
      const session = new EventTarget(); session.end = async () => session.dispatchEvent(new Event('end'));
      session.updateRenderState = () => {}; session.requestReferenceSpace = async type => ({type}); session.requestAnimationFrame = () => {};
      window.travelXR = session; return session;
    }}});
    window.captureTravelView = matrix => { const event = new Event('squeeze'); event.frame = {getPose: (viewer, floor) => {
      if (viewer.type !== 'viewer' || floor.type !== 'local-floor') throw Error('Wrong XR pose spaces'); return {transform: {matrix}};
    }}; window.travelXR.dispatchEvent(event); };
  });
  const project = travelFilm(); await openFilm(page, project); await page.locator('#cameraEndpoint').selectOption('end');
  const durable = await raw(page);
  await page.getByRole('button', {name: 'Enter VR', exact: true}).click(); await expect(page.locator('#status')).toContainText('VR active');
  for (const id of ['cameraEndpoint', 'cameraMode', 'eyeX', 'undo', 'import']) await expect(page.locator(`#${id}`)).toBeDisabled();
  await page.evaluate(() => window.captureTravelView([-1,0,0,0,0,1,0,0,0,0,-1,0,0,2,-6,1]));
  await expect(page.locator('#status')).toContainText(/path|camera|travel|separation/i); await expect(page.locator('#status')).not.toContainText('Camera captured');
  expect(await raw(page)).toBe(durable); await expect(page.locator('#eyeX')).toHaveValue('2');
  await page.evaluate(() => { const put = Storage.prototype.setItem; window.restoreTravelStorage = () => { Storage.prototype.setItem = put; };
    Storage.prototype.setItem = function (key, value) { if (key === 'shot-studio-v1') throw new DOMException('Full', 'QuotaExceededError'); return put.call(this, key, value); }; });
  await page.evaluate(() => window.captureTravelView([1,0,0,0,0,1,0,0,0,0,1,0,1,2,5,1]));
  await expect(page.locator('#status')).toContainText(/storage.*unavailable|save project|backup/i); await expect(page.locator('#status')).not.toContainText('Saved in this browser');
  expect(await raw(page)).toBe(durable);
  await page.getByRole('button', {name: 'Exit VR', exact: true}).click();
  const captured = await backup(page);
  expect(captured.shots[0]).toEqual({...project.shots[0], endEye: [1, 2, 5], endTarget: [1, 2, 2]});
  await expect(page.locator('#shotLabel')).toContainText(/end.*endpoint|endpoint.*end/i);
  await page.getByRole('button', {name: 'Undo scene', exact: true}).click(); expect(await backup(page)).toEqual(canonicalFilm(project));
  await page.evaluate(() => window.restoreTravelStorage()); await page.getByRole('button', {name: 'Redo scene', exact: true}).click();
  expect(JSON.parse(await raw(page))).toEqual(captured);
});

test('mobile keyboard End controls remain usable and never encode or replace unsent coordinates', async ({page}, info) => {
  await page.setViewportSize({width: 390, height: 844}); await openFilm(page, travelFilm());
  await page.getByRole('combobox', {name: 'Editing endpoint', exact: true}).focus();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await expect(page.locator('#cameraEndpoint')).toHaveValue('end');
  await page.locator('#eyeX').fill('1.500'); await page.locator('#eyeX').press('Tab');
  expect((await backup(page)).shots[0].endEye).toEqual([1.5, 2.2, 8]);
  await page.getByRole('button', {name: 'Preview endpoint', exact: true}).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#shotLabel')).toContainText(/end.*endpoint|endpoint.*end/i);
  await page.locator('#eyeZ').fill(''); await page.locator('#eyeZ').press('Tab');
  const committed = await backup(page), durable = await raw(page);
  for (const name of ['Rehearse', 'Export WebM', 'Enter VR']) {
    const control = page.getByRole('button', {name, exact: true}); if (await control.isEnabled()) await control.click();
    expect(await raw(page)).toBe(durable); await expect(page.locator('#eyeZ')).toHaveValue('');
  }
  expect(await backup(page)).toEqual(committed);
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', {name: 'Discard unsent edits', exact: true}).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#eyeZ')).toHaveValue('8');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path: info.outputPath('travel-mobile.png'), fullPage: true});
});

test('native recording cancellation and persisted page lifecycle release real capture tracks without a download', async ({page}) => {
  await page.addInitScript(() => {
    const capture = HTMLCanvasElement.prototype.captureStream; window.travelTrackStops = 0;
    HTMLCanvasElement.prototype.captureStream = function (...args) {
      const stream = capture.apply(this, args);
      for (const track of stream.getTracks()) { const stop = track.stop; track.stop = function () { window.travelTrackStops++; return stop.call(this); }; }
      return stream;
    };
  });
  await openFilm(page, travelFilm()); const durable = await raw(page), downloads = [];
  page.on('download', file => downloads.push(file.suggestedFilename()));
  await page.getByRole('button', {name: 'Export WebM', exact: true}).click();
  for (const id of ['cameraMode', 'cameraEndpoint', 'eyeX', 'undo', 'scrub', 'import']) await expect(page.locator(`#${id}`)).toBeDisabled();
  await page.getByRole('button', {name: 'Cancel export', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Rehearse', exact: true})).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.travelTrackStops)).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', {name: 'Export WebM', exact: true}).click();
  await page.evaluate(() => { dispatchEvent(new PageTransitionEvent('pagehide', {persisted: true})); dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true})); });
  await expect(page.getByRole('button', {name: 'Rehearse', exact: true})).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.travelTrackStops)).toBeGreaterThanOrEqual(2);
  await filmPositionFrame(page); expect(downloads).toEqual([]); expect(await raw(page)).toBe(durable);
});

// Frozen before observed exports: same original courtyard, idle actors, fixed light;
// independent costume centroid/envelope error <=16px, control drift <=4px,
// actual early/late span >=2.6s and travel >=180px. No production math imports.
function videoFixture(mode) {
  const project = travelFilm(); project.title = `Independent ${mode} camera export`;
  project.shots = [{...project.shots[0], duration: 4}];
  if (mode === 'static') { project.shots[0].cameraMode = 'static'; delete project.shots[0].endEye; delete project.shots[0].endTarget; }
  if (mode === 'identical') { project.shots[0].endEye = [...project.shots[0].eye]; project.shots[0].endTarget = [...project.shots[0].target]; }
  return project;
}
function decodeVideo(path, mode) {
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-show_frames',
    '-show_entries', 'stream=codec_name,width,height:frame=best_effort_timestamp_time', '-of', 'json', path], {encoding: 'utf8', timeout: 15_000, maxBuffer: 2 * 1024 * 1024}));
  expect(probe.streams).toHaveLength(1); expect(probe.streams[0]).toMatchObject({width: 960, height: 540});
  expect(['vp8', 'vp9']).toContain(probe.streams[0].codec_name);
  const timestamps = probe.frames.map(frame => Number(frame.best_effort_timestamp_time));
  expect(timestamps.every(Number.isFinite)).toBe(true); expect(timestamps.length).toBeGreaterThanOrEqual(30);
  expect(timestamps.every((time, index) => index === 0 || time >= timestamps[index - 1])).toBe(true);
  const relative = timestamps.map(time => time - timestamps[0]), span = relative.at(-1);
  expect(span).toBeGreaterThan(3.4); expect(span).toBeLessThan(5.5);
  const selected = [.4, 1.2, 2, 2.8, 3.6].map(target => relative.reduce((best, time, index) => Math.abs(time - target) < Math.abs(relative[best] - target) ? index : best, 0));
  expect(new Set(selected).size).toBe(5);
  expect(relative[selected.at(-1)] - relative[selected[0]]).toBeGreaterThanOrEqual(2.6);
  const filter = `select=${selected.map(index => `eq(n\\,${index})`).join('+')}`;
  const bytes = execFileSync('ffmpeg', ['-v', 'error', '-threads', '1', '-i', path, '-vf', filter, '-vsync', '0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    {timeout: 20_000, maxBuffer: 16 * 1024 * 1024});
  const frameBytes = 960 * 540 * 3; expect(bytes.length).toBe(frameBytes * 5);
  const samples = selected.map((index, offset) => {
    const time = relative[index], cameraX = mode === 'linear' ? -2 + Math.min(4, Math.max(0, time)) : -2;
    const camera = {eye: [cameraX, 2.2, 8], target: [cameraX, 1.15, 0], fov: 50};
    const pixels = bytes.subarray(offset * frameBytes, (offset + 1) * frameBytes);
    const red = landmark(pixels, 960, 540, 'red'), green = landmark(pixels, 960, 540, 'green');
    return {index, pts: timestamps[index], elapsed: time, red, green, expectedRed: verifyProjection(red, camera, -1.25), expectedGreen: verifyProjection(green, camera, 1.25)};
  });
  for (const color of ['red', 'green']) {
    const displacement = samples[0][color].x - samples.at(-1)[color].x;
    if (mode === 'linear') {
      expect(displacement).toBeGreaterThanOrEqual(180);
      for (let index = 1; index < samples.length; index++) expect(samples[index - 1][color].x - samples[index][color].x).toBeGreaterThan(35);
    } else expect(Math.max(...samples.map(sample => sample[color].x)) - Math.min(...samples.map(sample => sample[color].x))).toBeLessThanOrEqual(4);
  }
  return {mode, path, codec: probe.streams[0].codec_name, width: 960, height: 540, decodedFrames: timestamps.length, firstPts: timestamps[0], lastPts: timestamps.at(-1), span, samples};
}

test('actual WebM camera-only motion follows independent decoded projection while static and identical controls stay still', async ({page}, info) => {
  const results = [];
  for (const mode of ['linear', 'static', 'identical']) {
    const project = videoFixture(mode); await openFilm(page, project, `${mode}-camera.json`);
    if (mode !== 'static') await page.locator('#cameraEndpoint').selectOption('end');
    await page.getByRole('button', {name: 'Preview endpoint', exact: true}).click();
    const before = await backup(page), durable = await raw(page);
    const waiting = page.waitForEvent('download'); await page.getByRole('button', {name: 'Export WebM', exact: true}).click();
    await expect(page.locator('#cameraEndpoint')).toBeDisabled(); await expect(page.locator('#cameraMode')).toBeDisabled();
    const artifact = await waiting, path = info.outputPath(`${mode}-camera.webm`); await artifact.saveAs(path);
    const size = (await stat(path)).size; expect(size).toBeGreaterThan(8_192); expect(size).toBeLessThan(8 * 1024 * 1024);
    results.push({...decodeVideo(path, mode), bytes: size});
    await expect(page.getByRole('button', {name: 'Rehearse', exact: true})).toBeEnabled();
    expect(await backup(page)).toEqual(before); expect(await raw(page)).toBe(durable);
  }
  const metadata = {verification: 'real-decoded-camera-only-travel', thresholds: {projectionPixels: 16, staticDriftPixels: 4, minimumTravelPixels: 180, minimumObservedSampleSpanSeconds: 2.6}, results};
  const path = info.outputPath('decoded-landmarks.json'); await writeFile(path, JSON.stringify(metadata, null, 2) + '\n');
  await info.attach('Independent decoded landmark measurements', {path, contentType: 'application/json'});
  console.log(JSON.stringify({verification: metadata.verification, artifacts: results.map(result => ({mode: result.mode, path: result.path, frames: result.decodedFrames, span: result.span, redTravelPixels: result.samples[0].red.x - result.samples.at(-1).red.x, greenTravelPixels: result.samples[0].green.x - result.samples.at(-1).green.x}))}));
});
