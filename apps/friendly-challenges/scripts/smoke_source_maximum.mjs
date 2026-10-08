/** Independent manual boundary acceptance. No production helpers or injected state. */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { URL } from 'node:url';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import console from 'node:console';
import { createDeflate } from 'node:zlib';
import { once } from 'node:events';
import { tmpdir } from 'node:os';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const output = process.env.FRIENDLY_SOURCE_OUTPUT ? resolve(process.env.FRIENDLY_SOURCE_OUTPUT) : await mkdtemp(resolve(tmpdir(), 'friendly-source-maximum-'));
await mkdir(output, { recursive: true });

/** Original independent literal pixels/CRC/framing, no application image helpers. */
async function prepareFixtures() {
  try { await readFile(resolve(output, 'fixture-oracle.json')); return; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const crc = bytes => {
    let value = 0xffffffff;
    for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, bytes) => {
    const out = Buffer.alloc(bytes.length + 12); out.writeUInt32BE(bytes.length); out.write(type, 4, 4, 'ascii'); bytes.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + bytes.length)), 8 + bytes.length); return out;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4000); ihdr.writeUInt32BE(4000, 4); ihdr[8] = 8; ihdr[9] = 6;
  const top = Buffer.alloc(16001), bottom = Buffer.alloc(16001);
  for (let x = 0; x < 4000; x++) {
    top.set(x < 2000 ? [255, 0, 0, 255] : [0, 255, 0, 255], 1 + x * 4);
    bottom.set(x < 2000 ? [0, 0, 255, 255] : [0, 0, 0, 0], 1 + x * 4);
  }
  const compressor = createDeflate({ level: 9 }), compressed = [];
  compressor.on('data', bytes => compressed.push(bytes));
  const completed = once(compressor, 'end');
  for (let y = 0; y < 4000; y++) if (!compressor.write(y < 2000 ? top : bottom)) await once(compressor, 'drain');
  compressor.end(); await completed;
  const prefix = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)]);
  const idat = chunk('IDAT', Buffer.concat(compressed)), end = chunk('IEND', Buffer.alloc(0));
  const padding = 8388608 - prefix.length - idat.length - end.length - 12;
  assert.ok(padding > 0);
  const exact = Buffer.concat([prefix, chunk('paDd', Buffer.alloc(padding)), idat, end]); assert.equal(exact.length, 8388608);
  const oracle = {
    source: { bytes: exact.length, sha256: hash(exact), width: 4000, height: 4000, pixels: 16000000, format: 'PNG RGBA8', ancillaryPadding: { type: 'paDd', bytes: padding, meaning: 'unknown private ancillary safe-to-copy chunk, ignored for pixels' } },
    rejectedBytes: exact.length + 1,
    normalized: { width: 1024, height: 1024, mime: 'image/jpeg', maxBytes: 524288, interiorSamples: [{ xy: [256, 256], rgb: [255, 0, 0] }, { xy: [768, 256], rgb: [0, 255, 0] }, { xy: [256, 768], rgb: [0, 0, 255] }, { xy: [768, 768], rgb: [255, 255, 255] }], channelAbsoluteTolerance: 4 },
    claims: 'Exact source byte/pixel limits using low-complexity padded source, not worst-case compressed decoding or memory use.',
    generator: { formatVersion: 1, node: process.versions.node, zlib: process.versions.zlib, compressionLevel: 9 }
  };
  await writeFile(resolve(output, 'source-exact-8MiB.png'), exact, { flag: 'wx' });
  await writeFile(resolve(output, 'source-plus-one.png'), Buffer.concat([exact, Buffer.from([0])]), { flag: 'wx' });
  await writeFile(resolve(output, 'fixture-oracle.json'), JSON.stringify(oracle, null, 2) + '\n', { flag: 'wx' });
}
await prepareFixtures();
const oracle = JSON.parse(await readFile(resolve(output, 'fixture-oracle.json'), 'utf8'));
const source = await readFile(resolve(output, 'source-exact-8MiB.png'));
assert.equal(source.length, oracle.source.bytes); assert.equal(hash(source), oracle.source.sha256);
if (process.argv.includes('--fixtures-only')) {
  console.log(JSON.stringify({ output, sourceBytes: source.length, sourceSha256: hash(source), generator: oracle.generator || 'Existing frozen original fixture; generator metadata not rewritten.' }));
  process.exit(0);
}
const origin = process.env.FRIENDLY_SOURCE_ORIGIN;
if (!origin || new URL(origin).hostname !== '127.0.0.1') throw new Error('Provide the root-coordinated loopback FRIENDLY_SOURCE_ORIGIN.');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
let contexts = [];
const errors = [];
try {
  contexts = await Promise.all([browser.newContext({ baseURL: origin }), browser.newContext({ baseURL: origin })]);
  // Observe the genuine Blob argument without changing URL creation or CSP.
  await contexts[0].addInitScript(() => {
    const captured = new Map(), native = globalThis.URL.createObjectURL;
    Object.defineProperty(globalThis, '__friendlySourceBlobs', { value: captured });
    const uploads = [], nativeFetch = globalThis.fetch;
    Object.defineProperty(globalThis, '__friendlySourceUploads', { value: uploads });
    globalThis.fetch = function (...args) {
      const [path, options] = args;
      if (typeof path === 'string' && path.endsWith('/evidence/image') && options?.method === 'POST' && options.body instanceof globalThis.Blob) uploads.push(options.body);
      return nativeFetch.apply(this, args);
    };
    globalThis.URL.createObjectURL = function (blob) {
      const url = native.call(this, blob); captured.set(url, blob); return url;
    };
  });
  const owner = await contexts[0].newPage(), opponent = await contexts[1].newPage();
  for (const page of [owner, opponent]) { page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => { void dialog.accept(); }); }
  await owner.goto('/');
  const form = owner.locator('#create-form');
  for (const [name, value] of Object.entries({ name: 'Maximum source owner', title: 'Original maximum PNG boundary', description: 'Four independently authored pixel quadrants.', successCriteria: 'Retain one reviewed normalized copy.', evidenceRule: 'The supplied image is unverified and normalized onto white.' })) await form.locator(`[name=${name}]`).fill(value);
  await form.locator('[name=stake]').selectOption('pick-a-movie');
  await form.locator('[name=deadline]').fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await form.getByRole('button', { name: 'Propose challenge', exact: true }).click();
  await expect(owner.locator('#shared-link')).toHaveValue(/#invite=[a-f0-9]{64}$/);
  const privateInvite = await owner.locator('#shared-link').inputValue();
  await opponent.goto(privateInvite);
  await opponent.locator('#claim-form [name=name]').fill('Independent participant');
  await opponent.getByRole('button', { name: 'Claim opponent seat', exact: true }).click();
  await expect(opponent.getByRole('button', { name: 'Accept these terms', exact: true })).toBeVisible();
  await opponent.getByRole('button', { name: 'Accept these terms', exact: true }).click();
  await expect(owner.locator('#challenge-status')).toContainText('active');
  const credential = await owner.evaluate(() => {
    const id = new URL(globalThis.location.href).searchParams.get('challenge');
    const token = JSON.parse(globalThis.localStorage.getItem('friendly-challenges.sessions.v1') || '{}')[id];
    return { id, token };
  });
  const snapshot = async () => {
    const response = await owner.request.get(`/api/challenges/${credential.id}`, { headers: { Authorization: `Bearer ${credential.token}` } });
    assert.equal(response.status(), 200); return response.json();
  };
  const previewBytes = async () => Buffer.from(await owner.locator('#evidence-image-preview').evaluate(async image => {
    await image.decode();
    const blob = globalThis.__friendlySourceBlobs.get(image.src);
    if (!(blob instanceof globalThis.Blob)) throw new Error('Preview must use a genuinely observed native Blob URL.');
    return [...new Uint8Array(await blob.arrayBuffer())];
  }));
  const rawCaption = 'Exact 8 MiB / 16,000,000 pixel low-complexity source; normalized unverified copy.';
  await owner.locator('#evidence-form [name=text]').fill(rawCaption);
  const before = await snapshot();
  const started = performance.now();
  await owner.getByLabel('Choose evidence image', { exact: true }).setInputFiles(resolve(output, 'source-exact-8MiB.png'));
  await expect(owner.locator('#evidence-image-status')).toContainText(/Ready to review/, { timeout: 20000 });
  const normalizeWallMs = performance.now() - started;
  const preview = await previewBytes();
  assert.ok(preview.length > 0 && preview.length <= oracle.normalized.maxBytes);
  // Independent JPEG marker walk, including entropy escape/restart framing.
  const markers = []; let at = 2, entropy = false;
  assert.equal(preview.readUInt16BE(0), 0xffd8);
  while (at < preview.length) {
    if (entropy) {
      for (;;) {
        assert.ok(at < preview.length);
        if (preview[at++] !== 255) continue;
        const start = at - 1;
        while (preview[at] === 255) at++;
        const code = preview[at++];
        if (code === 0 || code >= 208 && code <= 215) continue;
        at = start; entropy = false; break;
      }
    }
    assert.equal(preview[at++], 255); while (preview[at] === 255) at++;
    const marker = preview[at++]; markers.push(marker);
    assert.ok(!(marker >= 225 && marker <= 239) && marker !== 254, 'No APP1..APP15/COM metadata in reviewed JPEG');
    if (marker === 217) { assert.equal(at, preview.length); break; }
    const length = preview.readUInt16BE(at); assert.ok(length >= 2 && at + length <= preview.length); at += length;
    if (marker === 218) entropy = true;
  }
  const pixels = await owner.evaluate(async ({ raw, samples }) => {
    const bitmap = await globalThis.createImageBitmap(new globalThis.Blob([Uint8Array.from(raw)], { type: 'image/jpeg' }));
    try {
      const canvas = new globalThis.OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d', { colorSpace: 'srgb' });
      context.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, height: bitmap.height, samples: samples.map(point => ({ xy: point.xy, rgba: [...context.getImageData(point.xy[0], point.xy[1], 1, 1).data] })) };
    } finally { bitmap.close(); }
  }, { raw: [...preview], samples: oracle.normalized.interiorSamples });
  assert.equal(pixels.width, 1024); assert.equal(pixels.height, 1024);
  pixels.samples.forEach((point, index) => {
    for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(point.rgba[channel] - oracle.normalized.interiorSamples[index].rgb[channel]) <= oracle.normalized.channelAbsoluteTolerance);
    assert.equal(point.rgba[3], 255);
  });
  assert.deepEqual((await snapshot()).events, before.events);
  await owner.getByLabel('Choose evidence image', { exact: true }).setInputFiles(resolve(output, 'source-plus-one.png'));
  await expect(owner.locator('#evidence-image-status')).toContainText(/8 MiB/);
  await expect(owner.locator('#evidence-image-status')).toContainText(/previous reviewed image.*kept/i);
  assert.deepEqual(await previewBytes(), preview);
  await expect(owner.locator('#evidence-form [name=text]')).toHaveValue(rawCaption);
  assert.deepEqual((await snapshot()).events, before.events);
  await owner.getByRole('button', { name: 'Add evidence with image', exact: true }).click();
  await expect(owner.locator('#message')).toContainText('Image evidence added');
  const state = await snapshot(), entry = state.evidence.at(-1);
  assert.equal(state.evidence.length, 1); assert.equal(entry.text, rawCaption);
  assert.deepEqual(entry.image, { mime: 'image/jpeg', width: 1024, height: 1024, bytes: preview.length, sha256: hash(preview) });
  const retainedResponse = await owner.request.get(`/api/challenges/${credential.id}/evidence/${entry.id}/image`, { headers: { Authorization: `Bearer ${credential.token}` } });
  assert.equal(retainedResponse.status(), 200); const retained = await retainedResponse.body(); assert.deepEqual(retained, preview);
  // Chromium omits Blob POST bytes from Playwright postDataBuffer; observe the
  // exact Blob supplied to the unchanged actual fetch instead, never its result.
  const uploadBody = Buffer.from(await owner.evaluate(async () => {
    const observed = globalThis.__friendlySourceUploads;
    if (observed.length !== 1) throw new Error('Exactly one genuine native Blob upload is required.');
    return [...new Uint8Array(await observed[0].arrayBuffer())];
  }));
  assert.equal(uploadBody.subarray(0, 8).toString('ascii'), 'FCEVID01');
  const metadataBytes = uploadBody.readUInt32LE(8), uploadedBytes = uploadBody.readUInt32LE(12);
  assert.equal(uploadedBytes, preview.length); assert.equal(uploadBody.length, 16 + metadataBytes + uploadedBytes);
  assert.deepEqual(uploadBody.subarray(16 + metadataBytes), preview);
  assert.equal(uploadBody.includes(Buffer.from(credential.token)), false);
  await writeFile(resolve(output, 'normalized-reviewed.jpg'), preview);
  await writeFile(resolve(output, 'retained-exact.jpg'), retained);
  const closeLink = owner.getByRole('button', { name: 'Close link', exact: true });
  if (await closeLink.isVisible()) await closeLink.click();
  await expect(owner.locator('#shared-link')).toBeHidden();
  await owner.screenshot({ path: resolve(output, 'source-maximum-desktop.png'), fullPage: true });
  await owner.setViewportSize({ width: 390, height: 844 });
  assert.equal(await owner.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
  await owner.screenshot({ path: resolve(output, 'source-maximum-390px.png'), fullPage: true });
  assert.deepEqual(errors, []);
  const verification = {
    status: 'passed', source: oracle.source, rejectedSourceBytes: oracle.rejectedBytes, fixtureOracleSha256: hash(await readFile(resolve(output, 'fixture-oracle.json'))),
    normalized: { ...entry.image, pixelSamples: pixels.samples, markerHex: markers.map(marker => marker.toString(16)), nativeNormalizeWallMs: normalizeWallMs },
    actualUpload: { bytes: uploadBody.length, metadataBytes, jpegBytes: uploadedBytes, jpegSha256: hash(uploadBody.subarray(16 + metadataBytes)) },
    claims: { choosePreviewUploadActualNative: true, exactRetainedPreviewBytes: true, plusOneKeepsPriorReadyDraft: true, noAppendDuringReviewOrRejectedReplacement: true, metadataFreeGeneratedPreview: true, physicalAuthenticityVerified: false, worstCaseDecodeOrMemoryProof: false },
    limitations: oracle.claims,
    artifacts: ['source-exact-8MiB.png', 'source-plus-one.png', 'fixture-oracle.json', 'normalized-reviewed.jpg', 'retained-exact.jpg', 'source-maximum-desktop.png', 'source-maximum-390px.png']
  };
  verification.generator = oracle.generator || { formatVersion: 1, language: 'Python', compressionLevel: 9, note: 'Original fixture frozen before browser; exact original generation runtime was not recorded.' };
  verification.runnerSha256 = hash(await readFile(new URL(import.meta.url)));
  const verificationPath = process.env.FRIENDLY_SOURCE_VERIFICATION || resolve(output, 'verification.json');
  await writeFile(verificationPath, JSON.stringify(verification, null, 2) + '\n');
  console.log(JSON.stringify({ status: verification.status, sourceBytes: source.length, sourcePixels: oracle.source.pixels, normalizedBytes: preview.length, normalizedSha256: hash(preview), nativeNormalizeWallMs: normalizeWallMs }));
} finally { for (const context of contexts) await context.close(); await browser.close(); }
