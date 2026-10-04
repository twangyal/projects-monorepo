/* global Buffer, console, process, window, URL */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { deflateSync, inflateSync } from 'node:zlib';
import { chromium, expect } from '@playwright/test';
import { parseGIF, decompressFrames } from 'gifuct-js';

// Frozen original scalar/artifact oracle. No producer modules are imported.
const MAX_BYTES = 6291624;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bytesOf = value => Buffer.from(JSON.stringify(value));
const clone = value => JSON.parse(JSON.stringify(value));
function crc(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0;}
function chunk(type,data){const result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);result.write(type,4);data.copy(result,8);result.writeUInt32BE(crc(result.subarray(4,-4)),result.length-4);return result;}
function originalPng(padding=0){
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(800);ihdr.writeUInt32BE(800,4);ihdr[8]=8;ihdr[9]=6;
  const raw=Buffer.alloc(800*(800*4+1));for(let y=0;y<800;y++)raw.fill(255,y*3201+1,(y+1)*3201);
  const parts=[Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw))];
  // CRC-correct private ancillary capacity data, not hidden artwork or compression tricks.
  if(padding)parts.push(chunk('paDd',Buffer.alloc(padding,63)));parts.push(chunk('IEND',Buffer.alloc(0)));return Buffer.concat(parts);
}
function decodePng(bytes){
  assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));let at=8,width,height,channels;const parts=[];
  while(at<bytes.length){const size=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8),end=at+size+12;assert(end<=bytes.length);assert.equal(crc(bytes.subarray(at+4,end-4)),bytes.readUInt32BE(end-4));
    if(type==='IHDR'){width=bytes.readUInt32BE(at+8);height=bytes.readUInt32BE(at+12);assert.equal(bytes[at+16],8);channels=bytes[at+17]===6?4:bytes[at+17]===2?3:0;assert(channels);assert.equal(bytes[at+20],0);}if(type==='IDAT')parts.push(bytes.subarray(at+8,end-4));at=end;if(type==='IEND'){assert.equal(at,bytes.length);break;}}
  const raw=inflateSync(Buffer.concat(parts)),stride=width*channels;assert.equal(raw.length,height*(stride+1));const decoded=Buffer.alloc(width*height*channels);
  const paeth=(a,b,c)=>{const p=a+b-c,aa=Math.abs(p-a),bb=Math.abs(p-b),cc=Math.abs(p-c);return aa<=bb&&aa<=cc?a:bb<=cc?b:c;};
  for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];assert(filter<=4);for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=channels?decoded[i-channels]:0,b=y?decoded[i-stride]:0,c=y&&x>=channels?decoded[i-stride-channels]:0;decoded[i]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}}
  const rgba=Buffer.alloc(width*height*4);for(let p=0;p<width*height;p++){decoded.copy(rgba,p*4,p*channels,p*channels+3);rgba[p*4+3]=channels===4?decoded[p*channels+3]:255;}return{width,height,rgba};
}
const pose = (frame = 0, x = 0, y = 0) => ({ frame, x, y, scale: 1, rotation: 0, opacity: 1, easing: 'linear' });
const START = ['#E02040', '#20E040', '#2040E0', '#A06020'];
const END = ['#2040E0', '#E02040', '#A06020', '#20E040'];
const framesFor = count => Array.from({ length: count }, (_, i) => Math.floor((i + 1) * 95 / (count + 1)));
const channels = color => [1, 3, 5].map(at => parseInt(color.slice(at, at + 2), 16));
function shade(index, t) {
  const a = channels(START[index % 4]), b = channels(END[index % 4]);
  return a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
}
const hex = color => '#' + color.map(v => v.toString(16).padStart(2, '0')).join('');
const rowY = (i, pairs) => pairs === 4 ? 45 + 75 * i : 30 + 40 * i;
function sourceStroke(i, end, pairs, points) {
  const dot = pairs === 8 && i === 7;
  return { color: (end ? END : START)[i % 4], width: end ? 26 : 18,
    points: Array.from({ length: points }, (_, k) => ({
      x: dot ? 460 : (end ? 260 : 60) + 90 * k / (points - 1),
      y: rowY(i, pairs) + (end && !dot ? 10 : 0),
    })) };
}
function fixture(pairs, images) {
  const endpoints = [0, 95].map(frame => ({ frame, strokes: Array.from({ length: pairs }, (_, i) => sourceStroke(i, frame === 95, pairs, pairs === 4 ? 46 : 55)) }));
  const main = { id: 'tween', name: `Original ${pairs}-pair collinear drawings`, kind: 'drawing', cels: endpoints, keys: [pose(), pose(95, 40)] };
  const control = { id: 'controls', name: 'Four untouched 1000-point controls', kind: 'drawing',
    cels: [{ frame: 0, strokes: Array.from({ length: 4 }, (_, i) => ({ color: '#000000', width: 14,
      points: Array.from({ length: 1000 }, (_, k) => ({ x: 520 + 40 * k / 999, y: 45 + 80 * i })) })) }], keys: [pose()] };
  const layers = [];
  if (images) {
    const png = originalPng(1000000);
    for (let i = 0; i < 4; i++) layers.push({ id: `image${i}`, name: `Original padded PNG ${i}`, kind: 'image',
      image: { dataUrl: 'data:image/png;base64,' + png.toString('base64'), width: 800, height: 800 }, keys: [pose(0, -640, -360)] });
  }
  layers.push(main, control);
  return { schemaVersion: 2, title: pairs === 4 ? 'Maximum topology - original independent fixture' : 'Maximum eight explicit pairs - independent fixture', background: '#FFFFFF', frameCount: 96, layers };
}
function counts(project) {
  const layers = project.layers.filter(l => l.kind === 'drawing'), strokes = layers.flatMap(l => l.cels.flatMap(c => c.strokes));
  return { selectedCels: layers.find(l => l.id === 'tween').cels.length, strokes: strokes.length,
    points: strokes.reduce((n, s) => n + s.points.length, 0), images: project.layers.filter(l => l.kind === 'image').length,
    canonicalBytes: bytesOf(project).length };
}
// Closed-form straight-line expectation; no cumulative-distance implementation.
function expectedCandidate(source, count) {
  const result = clone(source), layer = result.layers.find(l => l.id === 'tween'), pairs = layer.cels[0].strokes.length;
  layer.cels.splice(1, 0, ...framesFor(count).map(frame => {
    const t = frame / 95;
    return { frame, strokes: Array.from({ length: pairs }, (_, i) => ({ color: hex(shade(i, t)), width: 18 + 8 * t,
      points: Array.from({ length: 64 }, (_, k) => ({ x: pairs === 8 && i === 7 ? 460 : 60 + 200 * t + 90 * k / 63,
        y: rowY(i, pairs) + (pairs === 8 && i === 7 ? 0 : 10 * t) })) })) };
  }));
  return result;
}
function inspectCandidate(actual, source, count) {
  const main = actual.layers.find(l => l.id === 'tween'), expected = expectedCandidate(source, count), wanted = expected.layers.find(l => l.id === 'tween');
  assert.equal(actual.schemaVersion, 2); assert.equal(actual.title, source.title); assert.equal(actual.background, source.background); assert.equal(actual.frameCount, 96);
  assert.deepEqual(actual.layers.map(l => l.id), source.layers.map(l => l.id));
  assert.deepEqual(actual.layers.filter(l => l.id !== 'tween'), source.layers.filter(l => l.id !== 'tween'));
  assert.deepEqual(main.keys, wanted.keys); assert.equal(main.name, wanted.name); assert.equal(main.kind, wanted.kind);
  assert.deepEqual(main.cels.map(c => c.frame), wanted.cels.map(c => c.frame));
  assert.deepEqual(main.cels[0], wanted.cels[0]); assert.deepEqual(main.cels.at(-1), wanted.cels.at(-1));
  let maxCoordinateError = 0;
  for (let f = 1; f <= count; f++) {
    assert.equal(main.cels[f].strokes.length, wanted.cels[f].strokes.length);
    main.cels[f].strokes.forEach((stroke, i) => {
      const w = wanted.cels[f].strokes[i]; assert.equal(stroke.color, w.color); assert(Math.abs(stroke.width - w.width) < 1e-12); assert.equal(stroke.points.length, 64);
      stroke.points.forEach((p, k) => { for (const axis of ['x', 'y']) { const error = Math.abs(p[axis] - w.points[k][axis]); maxCoordinateError = Math.max(error, maxCoordinateError); assert(error < 1e-9, `frame ${f} stroke ${i} point ${k} ${axis}: ${error}`); } });
    });
  }
  const usage = counts(actual); assert.equal(usage.selectedCels, count + 2); assert.equal(usage.strokes, 100); assert.equal(usage.points, 10000); assert(usage.canonicalBytes <= MAX_BYTES);
  return { ...usage, maxCoordinateError };
}
const palette = rgb => [Math.round(Math.floor(rgb[0] / 32) * 255 / 7), Math.round(Math.floor(rgb[1] / 32) * 255 / 7), Math.floor(rgb[2] / 64) * 85];
function inspectRaster(rgba, frame, pairs, count, gif) {
  const held = [0, ...framesFor(count), 95].filter(f => f <= frame).at(-1), t = held / 95;
  const patch = (x, y, rgb) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const at = ((Math.floor(y) + dy) * 640 + Math.floor(x) + dx) * 4;
      assert.deepEqual([...rgba.subarray(at, at + 4)], [...(gif ? palette(rgb) : rgb), 255], `frame ${frame}, patch ${x},${y}`);
    }
  };
  for (let i = 0; i < pairs; i++) {
    const dot = pairs === 8 && i === 7;
    patch((dot ? 460 : 105 + 200 * t) + 40 * frame / 95, rowY(i, pairs) + (dot ? 0 : 10 * t), shade(i, t));
  }
  for (let i = 0; i < 4; i++) patch(540, 45 + 80 * i, [0, 0, 0]);
  patch(600, 340, [255, 255, 255]);
}
function inspectGif(bytes, pairs, count) {
  const parsed = parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  const frames = decompressFrames(parsed, true); assert.equal(frames.length, 96); let durationMs = 0;
  const frameHashes = frames.map((frame, i) => {
    assert.deepEqual(frame.dims, { top: 0, left: 0, width: 640, height: 360 });
    const delay = 10 * (Math.round((i + 1) * 100 / 12) - Math.round(i * 100 / 12)); assert.equal(frame.delay, delay); durationMs += frame.delay;
    inspectRaster(frame.patch, i, pairs, count, true); return sha(frame.patch);
  });
  assert.equal(durationMs, 8000); const loop = bytes.indexOf(Buffer.from('NETSCAPE2.0')); assert(loop >= 0); assert.deepEqual([...bytes.subarray(loop + 11, loop + 16)], [3, 1, 0, 0, 0]);
  return { frames: frames.length, durationMs, frameHashes };
}
async function artifact(path, bytes) { await writeFile(path, bytes); return { path, bytes: bytes.length, sha256: sha(bytes) }; }
async function download(page, selector, path) {
  const wait = page.waitForEvent('download', { timeout: 45000 }); await page.locator(selector).click(); const file = await wait; await file.saveAs(path); return readFile(path);
}
async function open(page, project) {
  await expect(page.getByLabel('Open project file', { exact: true })).toBeEnabled();
  await page.getByLabel('Open project file', { exact: true }).setInputFiles({ name: 'original-tween-fixture.motion.json', mimeType: 'application/json', buffer: bytesOf(project) });
  await expect(page.locator('#message')).toContainText('Project opened'); await expect(page.locator('#project-title')).toHaveValue(project.title);
  await expect(page.locator('#stage')).toHaveAttribute('aria-disabled', 'false');
  await page.locator('#layers button').filter({ hasText: project.layers.find(l => l.id === 'tween').name }).click();
}
async function review(page, count) {
  await page.locator('#make-tween').click(); await page.locator('#tween-pair-order').click(); await page.locator('#tween-count').fill(String(count));
  const start = performance.now(); await page.locator('#tween-review').click(); await expect(page.locator('#tween-apply')).toBeEnabled();
  return performance.now() - start;
}
async function seek(page, frame) {
  await page.locator('#frame').focus(); await page.keyboard.press('Home'); for (let i = 0; i < frame; i++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('#stage')).toHaveAttribute('data-frame', String(frame));
}
async function processIdentity(context) {
  const session = await context.browser().newBrowserCDPSession(); try { return (await session.send('SystemInfo.getProcessInfo')).processInfo.filter(p => p.type === 'browser').map(p => p.id); } finally { await session.detach(); }
}
async function main() {
  const out = process.env.MOTION_TWEENS_OUTPUT ? resolve(process.env.MOTION_TWEENS_OUTPUT) : await mkdtemp(join(tmpdir(), 'motion-tweens-'));
  if (process.env.MOTION_TWEENS_OUTPUT) await mkdir(out, { recursive: false });
  const topology = fixture(4, true), pairs = fixture(8, false), originalExpected = expectedCandidate(topology, 22), pairExpected = expectedCandidate(pairs, 10);
  for (const [p, c] of [[originalExpected, 24], [pairExpected, 12]]) { const u = counts(p); assert.equal(u.selectedCels, c); assert.equal(u.strokes, 100); assert.equal(u.points, 10000); assert(u.canonicalBytes < MAX_BYTES); }
  const image = Buffer.from(topology.layers[0].image.dataUrl.split(',')[1], 'base64'), decoded = decodePng(image);
  assert.equal(decoded.width, 800); assert.equal(decoded.height, 800); for (const channel of decoded.rgba) assert.equal(channel, 255);
  const evidence = { schemaVersion: 1, scope: 'Independent original scalar and artifact oracle; no producer module imports. Normal native File, controls, downloads and persistent-profile restart.',
    status: 'fixtures-only', outputDirectory: out,
    frozenExpectations: { topology: counts(originalExpected), eightPairs: counts(pairExpected), topologyFrames: framesFor(22), pairFrames: framesFor(10),
      coordinateTolerance: 1e-9, widthTolerance: 1e-12, rasterCorePatch: '5x5 exact opaque color pixels away from antialias edges', gifDurationMs: 8000, gifFrames: 96,
      pixelFormula: 'Held boundary h selects local x=105+200*h/95; independent pose adds40*f/95 at every output frame. y=row+10*h/95. Separate8-pair last path is stationary degenerate local(460,310).',
      images: { count: 4, width: 800, height: 800, eachPngBytes: image.length, eachDataUrlCharacters: topology.layers[0].image.dataUrl.length, ancillaryPaddingBytes: 1000000 },
      byteClaim: 'Measured near-capacity fixture, not exact JSON byte ceiling. Four images are genuinely decoded original white PNGs with declared ancillary capacity padding.' },
    fixtures: [], artifacts: [], cases: [], limitations: ['Browser memory peak is not inferred from fixture size.', 'Wall times include native UI and download overhead; no isolated kernel timing or hardware-independent speed claim.', 'No producer implementation supplies expected geometry or export pixels.'] };
  for (const [name, value] of [['topology-source', topology], ['eight-pair-source', pairs], ['topology-analytic-expected', originalExpected], ['eight-pair-analytic-expected', pairExpected]]) evidence.fixtures.push(await artifact(join(out, name + '.json'), bytesOf(value)));
  evidence.fixtureImage = await artifact(join(out, 'original-white-ancillary.png'), image);
  const save = () => writeFile(join(out, 'verification.json'), JSON.stringify(evidence, null, 2) + '\n'); await save();
  if (process.argv.includes('--fixtures-only')) { console.log(JSON.stringify({ status: evidence.status, out, expected: evidence.frozenExpectations }, null, 2)); return; }
  const baseURL = process.env.MOTION_TWEENS_BASE_URL; if (!baseURL) throw Error('Set MOTION_TWEENS_BASE_URL to the root-owned coherent preview; this script does not build or start a server.');
  const origin = new URL(baseURL).origin, profile = join(out, 'profile'), errors = [], external = []; let context, page;
  const launch = { headless: true, acceptDownloads: true, viewport: { width: 1280, height: 1000 }, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) };
  const mount = async () => { context = await chromium.launchPersistentContext(profile, launch); page = context.pages()[0];
    page.on('dialog', d => d.accept()); page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (/^https?:/.test(r.url()) && new URL(r.url()).origin !== origin) external.push(r.url()); }); await page.goto(baseURL); };
  try {
    await mount(); evidence.browserVersion = context.browser().version();
    for (const [source, count, label] of [[topology, 22, 'topology'], [pairs, 10, 'eight-pairs']]) {
      await open(page, source); const before = await download(page, '#backup', join(out, label + '-before.json')); assert.deepEqual(JSON.parse(before), source);
      const reviewWallMs = await review(page, count);
      await page.locator('#tween-preview-frame').focus(); await page.keyboard.press('Home');
      for (let i = 0; i < framesFor(count)[0]; i++) await page.keyboard.press('ArrowRight');
      await expect(page.locator('#tween-preview-frame')).toHaveValue(String(framesFor(count)[0]));
      // A public committed backup retires scratch; it must still contain the untouched source.
      const scratchBackup = await download(page, '#backup', join(out, label + '-scratch-committed.json')); assert.deepEqual(JSON.parse(scratchBackup), source);
      await expect(page.locator('#tween-apply')).toBeDisabled();
      await page.locator('#tween-review').click(); await expect(page.locator('#tween-apply')).toBeEnabled();
      const applyAt = performance.now(); await page.locator('#tween-apply').click(); await expect(page.locator('#save-status')).toHaveText('Saved in this browser', { timeout: 20000 }); const applyAndSaveWallMs = performance.now() - applyAt;
      const committed = await download(page, '#backup', join(out, label + '-applied.json')), actual = JSON.parse(committed), usage = inspectCandidate(actual, source, count);
      await page.getByRole('button', { name: 'Undo', exact: true }).click(); const undone = await download(page, '#backup', join(out, label + '-undo.json')); assert.deepEqual(JSON.parse(undone), source);
      await page.getByRole('button', { name: 'Redo', exact: true }).click(); const redone = await download(page, '#backup', join(out, label + '-redo.json')); assert(committed.equals(redone));
      for (const frame of [0, framesFor(count)[0], 47, 94, 95]) { await seek(page, frame); const png = await download(page, '#png', join(out, `${label}-frame-${frame}.png`)), raster = decodePng(png); assert.equal(raster.width, 640); assert.equal(raster.height, 360); inspectRaster(raster.rgba, frame, count === 22 ? 4 : 8, count, false); evidence.artifacts.push({ kind: 'png', label, frame, bytes: png.length, sha256: sha(png) }); }
      const encodeAt = performance.now(), gif = await download(page, '#gif', join(out, label + '-96-frames.gif')), encodeAndDownloadWallMs = performance.now() - encodeAt;
      assert(gif.length <= 32 * 1024 * 1024); const decodeAt = performance.now(), inspection = inspectGif(gif, count === 22 ? 4 : 8, count), decodeWallMs = performance.now() - decodeAt;
      evidence.cases.push({ label, usage, reviewWallMs, applyAndSaveWallMs, gif: { ...inspection, bytes: gif.length, sha256: sha(gif), encodeAndDownloadWallMs, decodeWallMs }, oneUndoRestoresSource: true, redoByteExact: true });
      if (label === 'topology') {
        await expect(page.locator('#save-status')).toHaveText('Saved in this browser', { timeout: 15000 }); const firstPid = await processIdentity(context);
        await context.close(); context = undefined; await mount(); const secondPid = await processIdentity(context); assert.notDeepEqual(firstPid, secondPid);
        await expect(page.locator('#project-title')).toHaveValue(source.title); await expect(page.locator('#stage')).toHaveAttribute('aria-disabled', 'false');
        const restored = await download(page, '#backup', join(out, 'topology-after-process-restart.json')); assert(committed.equals(restored));
        evidence.restart = { firstBrowserProcess: firstPid, secondBrowserProcess: secondPid, bytes: restored.length, sha256: sha(restored), byteExact: true };
      }
      await save();
    }
    await page.screenshot({ path: join(out, 'desktop.png'), fullPage: true }); await page.setViewportSize({ width: 390, height: 844 }); assert(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)); await page.screenshot({ path: join(out, '390px.png'), fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(external, []); evidence.pageErrors = errors; evidence.externalRequests = external; evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.failure = { name: error.name, message: error.message, stack: error.stack }; throw error; }
  finally { await context?.close(); await save(); }
  console.log(JSON.stringify({ status: evidence.status, outputDirectory: out, cases: evidence.cases.map(c => ({ label: c.label, usage: c.usage, gifFrames: c.gif.frames })), restart: evidence.restart }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
