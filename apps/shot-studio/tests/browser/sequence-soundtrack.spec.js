import {observeNativeExport} from './native-export-observer.js';
import { test, expect, chromium } from '@playwright/test';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { originalWave, originalSoundSequence, literalDescriptor, literalDocument, literalArchive, readLiteralArchive, soundtrackSha } from './sequence-soundtrack-fixtures.js';

const WAV = originalWave(), DOCUMENT = literalDocument(WAV), ARCHIVE = literalArchive(DOCUMENT, WAV), LEGACY = 'shot-studio-sequence-v1';
async function downloaded(page, selector = '#sequence-save') { const ready = page.waitForEvent('download'); await page.locator(selector).click(); const result = await ready, path = await result.path(); if (!path) throw Error('Native soundtrack download absent'); return { bytes: await readFile(path), name: result.suggestedFilename() }; }
async function backup(page) { const result = await downloaded(page); if (result.bytes.subarray(0, 8).toString() === 'SHOTSEQ1') return readLiteralArchive(result.bytes); return { document: { schemaVersion: 1, kind: 'shot-studio-sequence-document', sequence: JSON.parse(result.bytes.toString()), soundtrack: null }, wav: Buffer.alloc(0) }; }
async function stored(page) { return page.evaluate(() => new Promise((resolve, reject) => {
  let absent = false; const opened = indexedDB.open('shot-studio-sequence-documents', 1);
  opened.onupgradeneeded = () => { absent = true; opened.transaction.abort(); };
  opened.onerror = () => reject(absent ? Error('Document database missing; readback refused to create it') : opened.error);
  opened.onsuccess = () => { const db = opened.result; if (!db.objectStoreNames.contains('state')) { db.close(); reject(Error('Document state store missing')); return; } const tx = db.transaction('state'), request = tx.objectStore('state').get('sequence'), key = tx.objectStore('state').getKey('sequence');
    tx.oncomplete = () => { const value = request.result; db.close(); resolve(key.result === undefined ? { present: false } : { present: true, revision: value.revision, legacyRaw: value.legacyRaw, archive: value.archive instanceof ArrayBuffer ? Array.from(new Uint8Array(value.archive)) : null }); }; tx.onabort = () => { db.close(); reject(tx.error); };
  };
})); }
async function storedSummary(page) { return page.evaluate(() => new Promise((resolve, reject) => {
  let absent = false; const opened = indexedDB.open('shot-studio-sequence-documents', 1);
  opened.onupgradeneeded = () => { absent = true; opened.transaction.abort(); };
  opened.onerror = () => reject(absent ? Error('Document database missing; readback refused to create it') : opened.error);
  opened.onsuccess = () => {
    const db = opened.result; if (!db.objectStoreNames.contains('state')) { db.close(); reject(Error('Document state store missing')); return; }
    const tx = db.transaction('state'), request = tx.objectStore('state').get('sequence'), key = tx.objectStore('state').getKey('sequence');
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.oncomplete = async () => {
      db.close();
      try {
        if (key.result === undefined) { resolve({ present: false }); return; }
        const row = request.result;
        if (!(row.archive instanceof ArrayBuffer)) throw Error('Saved complete archive is not native bytes');
        const bytes = new Uint8Array(row.archive), view = new DataView(row.archive), decoder = new TextDecoder('utf-8', { fatal: true });
        if (bytes.length < 16 || decoder.decode(bytes.subarray(0, 8)) !== 'SHOTSEQ1') throw Error('Saved complete archive framing differs');
        const metadataBytes = view.getUint32(8, true), wavBytes = view.getUint32(12, true);
        if (16 + metadataBytes + wavBytes !== bytes.length) throw Error('Saved complete archive extent differs');
        const document = JSON.parse(decoder.decode(bytes.subarray(16, 16 + metadataBytes)));
        const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        // Hash real bytes within the browser. Returning hundreds of thousands of
        // JSON numbers for every poll makes tracing dominate the five-second gate.
        resolve({ present: true, revision: row.revision, document, archiveSha256: await hash(bytes), wavBytes, wavSha256: wavBytes ? await hash(bytes.subarray(16 + metadataBytes)) : null });
      } catch (error) { reject(error); }
    };
  };
})); }
async function durable(page, expected) {
  await expect.poll(async () => { const row = await storedSummary(page); return row.present ? { document: row.document, wavBytes: row.wavBytes, wavSha256: row.wavSha256 } : null; }).toEqual({ document: expected, wavBytes: expected.soundtrack?.asset.bytes ?? 0, wavSha256: expected.soundtrack?.asset.sha256 ?? null });
  await expect(page.locator('#sequence-save-status')).toHaveText('Sequence saved in this browser');
}
async function begin(page, complete = true) {
  await page.goto('/'); await expect(page.locator('#sequence-open')).toBeEnabled();
  // These scenarios start after ordinary storage admission. Importing while the
  // deliberately editable startup is pending correctly protects the saved copy.
  await expect(page.locator('#sequence-save-status')).toHaveText('Sequence saved in this browser');
  const accept = dialog => dialog.accept(); page.on('dialog', accept);
  try { await page.locator('#sequence-open').setInputFiles({ name: complete ? 'original.shot-sequence' : 'original.shot-sequence.json', mimeType: 'application/octet-stream', buffer: complete ? ARCHIVE : Buffer.from(JSON.stringify(originalSoundSequence())) }); await expect(page.locator('#sequence-title')).toHaveValue(DOCUMENT.sequence.title); await durable(page, complete ? DOCUMENT : literalDocument()); }
  finally { page.off('dialog', accept); }
}
async function settings(page, { label = 'Original stereo tones Ω', start = '0.75', input = '0.25', output = '3.25', gain = '0.5' } = {}) {
  for (const [id, value] of [['label', label], ['in', input], ['out', output], ['start', start], ['gain', gain]]) await page.locator(`#sequence-audio-${id}`).fill(value);
  await page.locator('#sequence-audio-apply').click();
}
const adjusted = () => literalDocument(WAV, { inFrame: 12000, outFrame: 156000, startTime: 0.75, gain: 0.5 });
async function audioObservation(page) { await page.addInitScript(() => {
  const Native = window.AudioContext; window.soundOracle = { contexts: [], starts: [], stops: 0 };
  window.AudioContext = class extends Native { constructor(...args) { super(...args); window.soundOracle.contexts.push(this); } };
  const start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.start = function (...args) { window.soundOracle.starts.push({ args, channels: this.buffer?.numberOfChannels, frames: this.buffer?.length, rate: this.buffer?.sampleRate }); return start.apply(this, args); };
  AudioBufferSourceNode.prototype.stop = function (...args) { window.soundOracle.stops++; return stop.apply(this, args); };
}); }
async function holdAudioFile(page) { await page.evaluate(({ expectedBytes, expectedHash }) => {
  const native = Blob.prototype.arrayBuffer;
  const gate = { armed: false, entered: false, delivered: false, release: () => {} }; window.soundFileGate = gate;
  Blob.prototype.arrayBuffer = async function () {
    const bytes = await native.call(this);
    // Admission deliberately copies File to an immutable Blob. Gate exact original
    // bytes only after the real native read, never fabricate decoded/read output.
    if (gate.armed && this.type === 'audio/wav' && bytes.byteLength === expectedBytes) {
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (gate.armed && digest === expectedHash) {
        gate.armed = false; gate.entered = true;
        await new Promise(resolve => { gate.release = resolve; }); gate.delivered = true;
      }
    }
    return bytes;
  };
}, { expectedBytes: WAV.length, expectedHash: soundtrackSha(WAV) }); }

const pageErrors = new WeakMap();
test.beforeEach(({ page }) => { const errors = []; pageErrors.set(page, errors); page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(({ page }) => { expect(pageErrors.get(page)).toEqual([]); });

test('native WAV selection requires explicit import; trim gain offset and remove each retain complete original audio and Undo', async ({ page }) => {
  await audioObservation(page); await begin(page, false); const ordinary = await page.evaluate(() => localStorage.getItem('shot-studio-v1'));
  await page.locator('#sequence-audio-file').setInputFiles({ name: 'original-stereo.wav', mimeType: 'audio/wav', buffer: WAV }); expect((await backup(page)).document).toEqual(literalDocument());
  await page.locator('#sequence-audio-import').click(); await expect(page.locator('#sequence-audio-out')).toHaveValue('4');
  const initial = await backup(page); expect(initial.document.soundtrack.asset).toEqual(DOCUMENT.soundtrack.asset); expect(initial.document.soundtrack).toMatchObject({ inFrame: 0, outFrame: 192000, startTime: 0, gain: 1 }); expect(initial.wav).toEqual(WAV); expect(await page.evaluate(() => window.soundOracle.starts)).toEqual([]);
  await settings(page); const changed = await backup(page); expect(changed.document).toEqual(adjusted()); expect(changed.wav).toEqual(WAV); await durable(page, adjusted());
  await page.locator('#sequence-undo').click(); expect((await backup(page)).document).toEqual(initial.document); await page.locator('#sequence-redo').click(); expect((await backup(page)).document).toEqual(adjusted());
  await page.locator('#sequence-audio-remove').click(); expect((await backup(page)).document).toEqual(literalDocument()); await page.locator('#sequence-undo').click(); expect((await backup(page)).wav).toEqual(WAV); expect((await backup(page)).document).toEqual(adjusted());
  expect(await page.evaluate(() => localStorage.getItem('shot-studio-v1'))).toBe(ordinary);
});

test('one-time frame rounding, invalid raw input and same-value Apply preserve exact complete bundle and Redo', async ({ page }) => {
  await begin(page); await settings(page); await page.locator('#sequence-undo').click(); await expect(page.locator('#sequence-redo')).toBeEnabled();
  const input = page.locator('#sequence-audio-in'); await input.fill(''); await input.focus(); await input.evaluate(node => node.dataset.oracleInput = 'same');
  await page.locator('#sequence-audio-apply').evaluate(button => button.click()); await expect(input).toHaveValue(''); await expect(input).toBeFocused(); await expect(input).toHaveAttribute('data-oracle-input', 'same'); expect((await backup(page)).document).toEqual(DOCUMENT); await expect(page.locator('#sequence-redo')).toBeEnabled();
  await settings(page, { input: '0.0000', output: '4.0000', start: '0', gain: '1' }); expect((await backup(page)).document).toEqual(DOCUMENT); await expect(page.locator('#sequence-redo')).toBeEnabled();
  await page.locator('#sequence-redo').click(); expect((await backup(page)).document).toEqual(adjusted());
  await settings(page, { input: '0.25001', output: '3.24999' }); expect((await backup(page)).document).toEqual(adjusted());
});

test('rehearsal is explicit, seek and raw intent stop its owned native graph and endpoint preview stays silent', async ({ page }) => {
  await audioObservation(page); await begin(page); expect(await page.evaluate(() => window.soundOracle.starts)).toEqual([]);
  await page.locator('#sequence-play').click(); await expect.poll(() => page.evaluate(() => window.soundOracle.starts.length)).toBe(1);
  await page.locator('#sequence-scrub').evaluate(node => { node.value = '2'; node.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(() => page.evaluate(() => window.soundOracle.contexts.every(context => context.state === 'closed'))).toBe(true);
  const count = await page.evaluate(() => window.soundOracle.starts.length); await page.locator('#sequence-clips [data-sequence-clip-id]').first().click(); await page.locator('#sequence-preview-end').click(); expect(await page.evaluate(() => window.soundOracle.starts.length)).toBe(count);
  await page.locator('#sequence-scrub').evaluate(node => { node.value = '0'; node.dispatchEvent(new Event('input', { bubbles: true })); }); await page.locator('#sequence-play').click(); await expect.poll(() => page.evaluate(() => window.soundOracle.starts.length)).toBe(count + 1);
  const label = page.locator('#sequence-audio-label'); await label.fill('New uncommitted label'); await label.focus(); await label.evaluate(node => node.setSelectionRange(4, 8));
  await expect.poll(() => page.evaluate(() => window.soundOracle.contexts.every(context => context.state === 'closed'))).toBe(true); await expect(label).toHaveValue('New uncommitted label'); await expect(label).toBeFocused(); expect(await label.evaluate(node => [node.selectionStart, node.selectionEnd])).toEqual([4, 8]);
  expect(readLiteralArchive((await stored(page)).archive).document).toEqual(DOCUMENT);
});

test('held genuine WAV read cannot overwrite newer changed-back label intent and Cancel permits same-file retry', async ({ page }) => {
  await begin(page); await holdAudioFile(page);
  await page.locator('#sequence-audio-file').setInputFiles({ name: 'held-original.wav', mimeType: 'audio/wav', buffer: WAV }); await page.evaluate(() => { window.soundFileGate.armed = true; }); await page.locator('#sequence-audio-import').click(); await expect.poll(() => page.evaluate(() => window.soundFileGate.entered)).toBe(true);
  const label = page.locator('#sequence-audio-label'); await label.fill('changed'); await label.fill('Original stereo tones Ω'); await label.focus(); await label.evaluate(node => { node.dataset.oracleLabel = 'same'; node.setSelectionRange(2, 5); });
  await page.evaluate(() => window.soundFileGate.release()); await expect.poll(() => page.evaluate(() => window.soundFileGate.delivered)).toBe(true);
  await expect(label).toHaveValue('Original stereo tones Ω'); await expect(label).toHaveAttribute('data-oracle-label', 'same'); await expect(label).toBeFocused(); expect(await label.evaluate(node => [node.selectionStart, node.selectionEnd])).toEqual([2, 5]); expect((await backup(page)).document).toEqual(DOCUMENT);
  // Explicit same-value Apply clears the deliberate raw draft before a fresh action.
  await page.locator('#sequence-audio-apply').click(); await page.evaluate(() => { window.soundFileGate.entered = false; window.soundFileGate.delivered = false; window.soundFileGate.armed = true; }); await page.locator('#sequence-audio-file').setInputFiles({ name: 'held-original.wav', mimeType: 'audio/wav', buffer: WAV }); await page.locator('#sequence-audio-import').click();
  await expect.poll(() => page.evaluate(() => window.soundFileGate.entered)).toBe(true); await expect(page.locator('#sequence-cancel')).toBeVisible(); await page.locator('#sequence-cancel').click(); await page.evaluate(() => window.soundFileGate.release()); await expect.poll(() => page.evaluate(() => window.soundFileGate.delivered)).toBe(true);
  await page.locator('#sequence-audio-file').setInputFiles({ name: 'original-stereo.wav', mimeType: 'audio/wav', buffer: WAV }); await page.locator('#sequence-audio-import').click(); await expect(page.locator('#sequence-audio-out')).toHaveValue('4'); expect((await backup(page)).wav).toEqual(WAV);
});

test('complete archive roundtrip rejects tampered bytes and preserves original sequence source, PCM and normal scene', async ({ page }) => {
  await begin(page); const before = await backup(page), row = await stored(page), ordinary = await page.evaluate(() => localStorage.getItem('shot-studio-v1'));
  const bad = Buffer.from(ARCHIVE); bad[bad.length - 1] ^= 1; const accept = dialog => dialog.accept(); page.on('dialog', accept);
  try { await page.locator('#sequence-open').setInputFiles({ name: 'tampered.shot-sequence', mimeType: 'application/octet-stream', buffer: bad }); await expect(page.locator('#sequence-status')).toContainText(/hash|SHA|match|invalid|changed/i); }
  finally { page.off('dialog', accept); }
  const after = await backup(page); expect(after.document).toEqual(before.document); expect(after.wav).toEqual(before.wav); expect(await stored(page)).toEqual(row); expect(await page.evaluate(() => localStorage.getItem('shot-studio-v1'))).toBe(ordinary);
  const bytes = (await downloaded(page)).bytes; expect(readLiteralArchive(bytes).wav).toEqual(WAV);
});

test('two real tabs protect the whole saved archive and reviewed replacement refuses a third writer', async ({ page, context }) => {
  await begin(page); const other = await context.newPage(); await other.goto('/'); await expect(other.locator('#sequence-title')).toHaveValue(DOCUMENT.sequence.title); await expect(other.locator('#sequence-open')).toBeEnabled();
  await settings(other, { label: 'Second tab committed', gain: '0.25' }); const second = { ...adjusted(), soundtrack: { ...adjusted().soundtrack, label: 'Second tab committed', gain: 0.25 } }; await durable(other, second);
  await page.locator('#sequence-title').fill('First tab memory only'); await page.locator('#sequence-title-apply').click(); await expect(page.locator('#sequence-save-status')).toContainText(/protected|conflict|changed/i);
  expect(readLiteralArchive((await stored(page)).archive).document).toEqual(second); expect((await backup(page)).document.sequence.title).toBe('First tab memory only');
  let confirmSeen = false, thirdSaved = false; page.once('dialog', async dialog => { confirmSeen = true; await settings(other, { label: 'Third writer committed', gain: '0.75' }); await durable(other, { ...adjusted(), soundtrack: { ...adjusted().soundtrack, label: 'Third writer committed', gain: 0.75 } }); thirdSaved = true; await dialog.accept(); });
  await page.locator('#sequence-replace-saved').click(); await expect.poll(() => confirmSeen && thirdSaved).toBe(true); await expect(page.locator('#sequence-save-status')).toContainText(/protected|conflict|changed/i);
  expect(readLiteralArchive((await stored(page)).archive).document.soundtrack.label).toBe('Third writer committed'); expect((await backup(page)).document.sequence.title).toBe('First tab memory only'); await other.close();
});

test('actual legacy load performs no rewrite and foreign legacy bytes protect later complete saves', async ({ page, context }) => {
  const legacy = JSON.stringify(originalSoundSequence(), null, 3); await page.addInitScript(({ key, value }) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, value); }, { key: LEGACY, value: legacy });
  await page.goto('/'); await expect(page.locator('#sequence-title')).toHaveValue(DOCUMENT.sequence.title); await expect(page.locator('#sequence-open')).toBeEnabled(); expect(await page.evaluate(key => localStorage.getItem(key), LEGACY)).toBe(legacy); expect(await stored(page)).toEqual({ present: false });
  await page.locator('#sequence-audio-file').setInputFiles({ name: 'original-stereo.wav', mimeType: 'audio/wav', buffer: WAV }); await page.locator('#sequence-audio-import').click(); await expect(page.locator('#sequence-audio-out')).toHaveValue('4'); await settings(page); await durable(page, adjusted()); expect((await stored(page)).legacyRaw).toBe(legacy);
  const before = await stored(page), other = await context.newPage(); await other.goto('/'); const foreign = JSON.stringify({ ...originalSoundSequence(), title: 'Foreign legacy writer' }); await other.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: LEGACY, value: foreign });
  await page.locator('#sequence-title').fill('Protected retained memory'); await page.locator('#sequence-title-apply').click(); await expect(page.locator('#sequence-save-status')).toContainText(/protected|changed/i); expect(await stored(page)).toEqual(before); expect(await page.evaluate(key => localStorage.getItem(key), LEGACY)).toBe(foreign); expect((await backup(page)).wav).toEqual(WAV); await other.close();
});

test('390px keyboard settings and confirmed Clear sequence Undo keep exact committed audio', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await begin(page); await settings(page); await page.locator('#sequence-audio-label').focus(); await page.locator('#sequence-audio-label').fill('Keyboard original Ω'); await page.locator('#sequence-audio-apply').press('Enter');
  const expected = { ...adjusted(), soundtrack: { ...adjusted().soundtrack, label: 'Keyboard original Ω' } }; expect((await backup(page)).document).toEqual(expected);
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('#sequence-clear-history').click(); await expect(page.locator('#sequence-undo')).toBeEnabled();
  page.once('dialog', dialog => dialog.accept()); await page.locator('#sequence-clear-history').click(); await expect(page.locator('#sequence-undo')).toBeDisabled(); await expect(page.locator('#sequence-redo')).toBeDisabled(); expect((await backup(page)).document).toEqual(expected); expect((await backup(page)).wav).toEqual(WAV);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.locator('#sequence-audio-label').scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('soundtrack-mobile.png'), fullPage: false });
});

test('actual six-second audiovisual WebM retains both streams, original stereo tone plateaus and complete backup', async ({ page }, info) => {
  await begin(page); await settings(page); await durable(page, adjusted()); const before = await backup(page); const result = await downloaded(page, '#sequence-export'); const path = info.outputPath('original-soundtrack.webm'); await writeFile(path, result.bytes);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', path], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 }));
  expect(probe.streams).toHaveLength(2); const video = probe.streams.find(stream => stream.codec_type === 'video'), audio = probe.streams.find(stream => stream.codec_type === 'audio'); expect(['vp8', 'vp9']).toContain(video.codec_name); expect([video.width, video.height]).toEqual([960, 540]); expect(audio.codec_name).toBe('opus'); expect(audio.channels).toBe(2);
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-threads', '1', '-i', path, '-map', '0:a:0', '-ar', '48000', '-ac', '2', '-f', 'f32le', 'pipe:1'], { timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
  // Interior plateau only: no independently shifted A/V alignment claim. Full shared-origin gate belongs to maximum runner.
  for (const [channel, frequency, amplitude] of [[0, 440, 8192], [1, 880, 16384]]) { let squared = 0, crossings = 0, previous = 0; const start = 57600, end = 129600; expect(pcm.length).toBeGreaterThan(end * 8);
    for (let frame = start; frame < end; frame++) { const value = pcm.readFloatLE(frame * 8 + channel * 4); squared += value * value; if (frame > start && previous <= 0 && value > 0) crossings++; previous = value; }
    const rms = Math.sqrt(squared / (end - start)), expected = amplitude / 32768 * 0.5 / Math.sqrt(2); expect(Math.abs(rms / expected - 1)).toBeLessThan(0.05); expect(Math.abs(crossings / ((end - start) / 48000) - frequency)).toBeLessThan(2);
  }
  const after = await backup(page); expect(after.document).toEqual(before.document); expect(after.wav).toEqual(before.wav); expect(await page.locator('#take-list [data-take-id]').count()).toBe(0);
  await writeFile(info.outputPath('soundtrack-native-media.json'), JSON.stringify({ bytes: result.bytes.length, sha256: soundtrackSha(result.bytes), wavSha256: soundtrackSha(WAV), scope: 'Actual codec/stereo interior pitch and RMS; maximum runner owns shared-origin A/V alignment', streams: probe.streams.map(stream => ({ codec: stream.codec_name, type: stream.codec_type, channels: stream.channels, width: stream.width, height: stream.height })) }, null, 2));
});

test('actual mono 44.1 kHz WAV keeps original frames and pitch through native Opus resampling', async ({ page }, info) => {
  const mono = originalWave({ sampleRate: 44100, channels: 1, seconds: 1 });
  const expected = literalDocument(mono, { label: 'Original mono 330 Hz', asset: literalDescriptor(mono, 44100, 1, 44100), inFrame: 0, outFrame: 44100, startTime: 1, gain: 0.5 });
  expect(mono.length).toBe(88244); expect(mono.readUInt32LE(40) / 2).toBe(44100);
  await audioObservation(page); await begin(page, false);
  await page.locator('#sequence-audio-file').setInputFiles({ name: 'original-mono-44100.wav', mimeType: 'audio/wav', buffer: mono }); await page.locator('#sequence-audio-import').click(); await expect(page.locator('#sequence-audio-out')).toHaveValue('1');
  await settings(page, { label: expected.soundtrack.label, input: '0', output: '1', start: '1', gain: '0.5' }); await durable(page, expected);
  const before = await downloaded(page), row = await stored(page), ordinary = await page.evaluate(() => localStorage.getItem('shot-studio-v1'));
  expect(readLiteralArchive(before.bytes).document).toEqual(expected); expect(readLiteralArchive(before.bytes).wav).toEqual(mono);
  const result = await downloaded(page, '#sequence-export'), path = info.outputPath('original-mono-44100.webm'); await writeFile(path, result.bytes);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', path], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 }));
  expect(probe.streams).toHaveLength(2); const video = probe.streams.find(stream => stream.codec_type === 'video'), audio = probe.streams.find(stream => stream.codec_type === 'audio');
  expect(['vp8', 'vp9']).toContain(video.codec_name); expect([video.width, video.height]).toEqual([960, 540]); expect(audio.codec_name).toBe('opus'); expect(audio.channels).toBe(1); expect(Number(audio.sample_rate)).toBe(48000);
  const decoded = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_frames', '-show_entries', 'frame=pts_time,nb_samples', '-of', 'json', path], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })).frames;
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-threads', '1', '-i', path, '-map', '0:a:0', '-ar', '48000', '-ac', '1', '-f', 'f32le', 'pipe:1'], { timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
  expect(pcm.length % 4).toBe(0); expect(decoded.length).toBeGreaterThan(1);
  let decodedFrames = 0, previousPts = -Infinity;
  for (const frame of decoded) { const pts = Number(frame.pts_time); expect(Number.isFinite(pts)).toBe(true); expect(pts).toBeGreaterThan(previousPts); expect(Number.isInteger(frame.nb_samples) && frame.nb_samples > 0).toBe(true); decodedFrames += frame.nb_samples; previousPts = pts; }
  expect(pcm.length / 4).toBe(decodedFrames);
  // The literal source is 330 Hz at amplitude4096 for exactly44100 frames.
  // Inspect fixed timeline1.2..1.8 seconds, without searching or fitting an offset.
  const start = 57600, end = 86400; expect(decodedFrames).toBeGreaterThan(end);
  let squared = 0, crossings = 0, previous = 0, allFinite = true;
  for (let frame = 0; frame < decodedFrames; frame++) {
    const value = pcm.readFloatLE(frame * 4); if (!Number.isFinite(value)) allFinite = false;
    if (frame >= start && frame < end) { squared += value * value; if (frame > start && previous <= 0 && value > 0) crossings++; previous = value; }
  }
  expect(allFinite).toBe(true);
  const rms = Math.sqrt(squared / (end - start)), expectedRms = 4096 / 32768 * 0.5 / Math.sqrt(2), frequency = crossings / ((end - start) / 48000);
  expect(Math.abs(rms / expectedRms - 1)).toBeLessThan(0.05); expect(Math.abs(frequency - 330)).toBeLessThan(2);
  // Timestamped export reads original PCM directly, without live playback.
  expect(await page.evaluate(() => window.soundOracle.starts)).toEqual([]);
  expect(await page.evaluate(() => window.soundOracle.contexts.length)).toBe(0);
  // A one-second soundtrack must leave a real silent audio tail through the
  // six-second film, rather than truncate the audio stream at its two-second cut.
  expect(decodedFrames).toBeGreaterThanOrEqual(283200); expect(decodedFrames).toBeLessThanOrEqual(297600);
  const quietStart = 103200, quietEnd = 278400; let quietSquared = 0;
  for (let frame = quietStart; frame < quietEnd; frame++) { const value = pcm.readFloatLE(frame * 4); quietSquared += value * value; }
  const quietRms = Math.sqrt(quietSquared / (quietEnd - quietStart)); expect(quietRms).toBeLessThanOrEqual(0.001);
  expect((await downloaded(page)).bytes).toEqual(before.bytes); expect(await stored(page)).toEqual(row); expect(await page.evaluate(() => localStorage.getItem('shot-studio-v1'))).toBe(ordinary); expect(await page.locator('#take-list [data-take-id]').count()).toBe(0);
  await writeFile(info.outputPath('soundtrack-native-mono.json'), JSON.stringify({ inputBytes: mono.length, inputSha256: soundtrackSha(mono), inputFrames: 44100, inputRate: 44100, outputBytes: result.bytes.length, outputSha256: soundtrackSha(result.bytes), outputRate: 48000, decodedFrames, plateau: { start, end, frequency, rms, expectedRms }, silentTail: { start: quietStart, end: quietEnd, rms: quietRms }, scope: 'Actual mono44.1k original source frames and native Opus48k resampling; fixed interior plateau and2.15..5.8s silent tail across six-second audio extent, no fitted timeline offset' }, null, 2));
});

test('Cancel during genuine audiovisual encoding drains native codecs without live playback or changing the complete sequence', async ({ page }, info) => {
  await audioObservation(page);await observeNativeExport(page);
  await begin(page);await settings(page);await durable(page,adjusted());const before=await downloaded(page),row=await stored(page),ordinary=await page.evaluate(()=>localStorage.getItem('shot-studio-v1'));
  const downloads=[];page.on('download',file=>downloads.push(file.suggestedFilename()));await page.locator('#sequence-export').click();
  await expect.poll(()=>page.evaluate(()=>window.exportOracle.video.some(e=>e.state==='configured')&&window.exportOracle.audio.some(e=>e.state==='configured'))).toBe(true);
  await expect.poll(()=>page.locator('#sequence-export-progress').evaluate(node=>node.value)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>window.soundOracle.starts.length)).toBe(0);expect(await page.evaluate(()=>window.soundOracle.contexts.length)).toBe(0);
  await page.locator('#sequence-cancel').click();await expect(page.locator('#sequence-status')).toContainText('export cancelled');
  await expect.poll(()=>page.evaluate(()=>[...window.exportOracle.video,...window.exportOracle.audio].every(e=>e.state==='closed'))).toBe(true);
  await expect(page.locator('#sequence-export')).toBeEnabled();expect(downloads).toEqual([]);
  expect((await downloaded(page)).bytes).toEqual(before.bytes);expect(await stored(page)).toEqual(row);expect(await page.evaluate(()=>localStorage.getItem('shot-studio-v1'))).toBe(ordinary);expect(await page.locator('#take-list [data-take-id]').count()).toBe(0);
  await writeFile(info.outputPath('soundtrack-native-cancel.json'),JSON.stringify({nativeEncoders:'Actual configured VideoEncoder and AudioEncoder both closed; controlled250ms task-yield delay permits UI cancellation',ownedAudioContexts:0,livePlaybackStarts:0,downloadCount:downloads.length,completeBackupSha256:soundtrackSha(before.bytes),completeStoredArchiveSha256:soundtrackSha(Buffer.from(row.archive)),savedRevision:row.revision},null,2));
});

test('full persistent Chromium restart restores exact complete sequence metadata and original WAV bytes', async ({ baseURL }, info) => {
  const directory = await mkdtemp(join(tmpdir(), 'shot124-persistent-')); let browser;
  const options = { ...info.project.use.launchOptions, baseURL };
  try {
    browser = await chromium.launchPersistentContext(directory, options); let page = await browser.newPage(); await begin(page); await settings(page); await durable(page, adjusted()); const original = (await downloaded(page)).bytes; const raw = await stored(page); await browser.close(); browser = null;
    browser = await chromium.launchPersistentContext(directory, options); page = await browser.newPage(); await page.goto('/'); await expect(page.locator('#sequence-title')).toHaveValue(DOCUMENT.sequence.title); await expect(page.locator('#sequence-open')).toBeEnabled(); expect((await downloaded(page)).bytes).toEqual(original); expect(await stored(page)).toEqual(raw); expect(readLiteralArchive(original).wav).toEqual(WAV);
  } finally { if (browser) await browser.close(); await rm(directory, { recursive: true, force: true }); }
});
