/** Original native artifact probe. No producer imports, serializers or storage injection.
 * Run only against an explicitly supplied fresh production preview.
 */
/* global process, Buffer, URL, AudioBufferSourceNode, AudioContext, navigator, document, innerWidth, console */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.env.MELODY_REFERENCE_BASE_URL;
assert.ok(base, 'Set MELODY_REFERENCE_BASE_URL to the owned production preview.');
const url = new URL(base);
assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Use only an owned loopback preview.');
const output = process.env.MELODY_REFERENCE_OUTPUT_DIR
  ? resolve(process.env.MELODY_REFERENCE_OUTPUT_DIR)
  : await mkdtemp(join(tmpdir(), 'melody-reference-native-'));
if (process.env.MELODY_REFERENCE_OUTPUT_DIR) await mkdir(output, { recursive: false });
const profile = join(output, 'persistent-profile');
const executablePath = process.env.MELODY_REFERENCE_CHROMIUM || process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const RATE = 22050;
const startedAt = performance.now();
const report = { schemaVersion: 1, baseOrigin: url.origin, output, thresholds: {
  frequencyErrorHz: 3, relativeRmsError: .02, dcLsbError: 3, impulseFrameError: 2,
  interiorEdgeFrames: 512, auditionSampleError: 2e-6,
}, measured: {}, limitations: [
  'Synthetic fixtures validate software behavior, not physical microphone quality.',
  'AudioBufferSourceNode.start is observed while forwarding to the real native method; storage, decoder, workers and audio rendering are not replaced.',
  'Reported decoded sample rates describe native AudioContext output, not original WAV rates; resampling is not claimed bit-exact across browsers.',
] };
const hash = data => createHash('sha256').update(data).digest('hex');
const uuid = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const button = (page, name) => page.getByRole('button', { name, exact: true });
const errors = [], external = [];
let context;

function canonicalAsset(n, frames = 441000) {
  const pcm = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) pcm.writeInt16LE(((i * 97 + n * 503) % 65536) - 32768, i * 2);
  return { id: uuid(n), kind: 'audio-file', captureTempo: 40, decodedSampleRate: 44100,
    decodedChannels: 2, decodedFrames: frames * 2, analyzedFrames: frames * 2,
    frameCount: frames, sha256: hash(pcm), pcmBase64: pcm.toString('base64') };
}
function complete(assets, maximum = false) {
  const tracks = Array.from({ length: assets.length || 1 }, (_, i) => ({ id: `original-track-${i}`,
    name: `Original voice ${i + 1}`, instrument: 'sine', volume: 1, muted: false,
    notes: maximum && i === 0 ? [
      { id: 'early-a4', pitch: 69, start: 0, duration: 16, velocity: 1 },
      ...Array.from({ length: 8 }, (_, n) => ({ id: `late-a4-${n}`, pitch: 69, start: 112, duration: 16, velocity: 1 })),
    ] : [] }));
  return { format: 'melody-studio-project', version: 1,
    document: { schemaVersion: 1, composition: { version: 1,
      title: maximum ? 'Original maximum retained takes' : 'Original native normalization', tempo: 120, tracks },
    references: assets.map((asset, i) => ({ trackId: tracks[i].id, assetId: asset.id })) }, assets };
}
function decodeAsset(asset) {
  const bytes = Buffer.from(asset.pcmBase64, 'base64');
  assert.equal(bytes.length, asset.frameCount * 2); assert.equal(hash(bytes), asset.sha256);
  const samples = Float32Array.from({ length: asset.frameCount }, (_, i) => {
    const value = bytes.readInt16LE(i * 2); return value / (value < 0 ? 32768 : 32767);
  });
  return { bytes, samples };
}
function inputWav(rate, kind, frequency = 440) {
  const seconds = kind === 'tone' ? 1 : 2;
  const frames = rate * seconds;
  const bytes = Buffer.alloc(44 + frames * 4);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 4, 28);
  bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    let sample = 0;
    if (kind === 'tone' || i < .4 * rate) sample = .3 * Math.sin(2 * Math.PI * frequency * i / rate);
    else if (kind === 'dc' && i >= .6 * rate && i < 1.6 * rate) sample = .25;
    else if (kind === 'impulse' && i === Math.round(1.1 * rate)) sample = .9;
    const pcm = Math.round(sample * (sample < 0 ? 32768 : 32767));
    bytes.writeInt16LE(pcm, 44 + i * 4); bytes.writeInt16LE(pcm, 46 + i * 4);
  }
  return bytes;
}
function rms(samples) { return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length); }
function measuredFrequency(samples) {
  const crossings = [];
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] <= 0 && samples[i] > 0) {
    crossings.push(i - 1 - samples[i - 1] / (samples[i] - samples[i - 1]));
  }
  assert.ok(crossings.length > 30);
  return (crossings.length - 1) * RATE / (crossings.at(-1) - crossings[0]);
}
function decodedWav(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  let at = 12, format, data;
  while (at + 8 <= bytes.length) {
    const name = bytes.toString('ascii', at, at + 4), size = bytes.readUInt32LE(at + 4);
    assert.ok(at + 8 + size <= bytes.length);
    if (name === 'fmt ') format = { type: bytes.readUInt16LE(at + 8), channels: bytes.readUInt16LE(at + 10),
      rate: bytes.readUInt32LE(at + 12), bits: bytes.readUInt16LE(at + 22) };
    if (name === 'data') data = bytes.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size & 1);
  }
  assert.deepEqual(format, { type: 1, channels: 1, rate: RATE, bits: 16 }); assert.ok(data);
  return Float32Array.from({ length: data.length / 2 }, (_, i) => data.readInt16LE(i * 2) / 32768);
}
function decodedMidi(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'MThd');
  const division = bytes.readUInt16BE(12); assert.equal(division, 480);
  const notes = [], noteOffs = [], tempos = []; let at = 8 + bytes.readUInt32BE(4);
  while (at < bytes.length) {
    assert.equal(bytes.toString('ascii', at, at + 4), 'MTrk');
    const end = at + 8 + bytes.readUInt32BE(at + 4); at += 8; let tick = 0, running;
    const vlq = () => { let value = 0, count = 0, byte;
      do { assert.ok(at < end && count++ < 4); byte = bytes[at++]; value = value * 128 + (byte & 127); } while (byte & 128);
      return value; };
    while (at < end) {
      tick += vlq(); let status = bytes[at];
      if (status & 128) { at++; running = status; } else { status = running; }
      if (status === 255) { const type = bytes[at++], length = vlq();
        if (type === 81) tempos.push(bytes.readUIntBE(at, length)); at += length; continue; }
      if (status === 240 || status === 247) { at += vlq(); continue; }
      const code = status >> 4, first = bytes[at++], second = code === 12 || code === 13 ? 0 : bytes[at++];
      if (code === 9 && second > 0) notes.push({ tick, pitch: first, velocity: second });
      if (code === 8 || (code === 9 && second === 0)) noteOffs.push({ tick, pitch: first });
    }
    assert.equal(at, end);
  }
  return { division, tempos, notes, noteOffs };
}
async function launch() {
  context = await chromium.launchPersistentContext(profile, { executablePath, headless: true,
    viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(() => {
    const realStart = AudioBufferSourceNode.prototype.start;
    const observation = { buffers: [] };
    Object.defineProperty(globalThis, '__referenceArtifactObservation', { value: observation });
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.context instanceof AudioContext && this.buffer) {
        observation.buffers.push({ rate: this.buffer.sampleRate, channels: this.buffer.numberOfChannels,
          samples: this.buffer.getChannelData(0).slice() });
        if (observation.buffers.length > 4) observation.buffers.shift();
      }
      return realStart.apply(this, args);
    };
  });
  const page = context.pages()[0] || await context.newPage();
  page.on('dialog', dialog => { void dialog.accept(); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const target = new URL(request.url());
    if (target.protocol.startsWith('http') && target.origin !== url.origin) external.push(target.origin); });
  await page.goto(base); await expect(button(page, 'Save project file')).toBeEnabled({ timeout: 15000 });
  report.appScripts = await page.locator('script[src]').evaluateAll(scripts => scripts.map(script => new URL(script.src).pathname));
  return page;
}
async function importProject(page, file, title) {
  await page.getByLabel('Open project file', { exact: true }).setInputFiles(file);
  await expect(page.getByLabel('Project title')).toHaveValue(title);
  await expect(page.getByRole('status')).toContainText('Project opened');
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser', { timeout: 15000 });
}
async function download(page, name, fileName) {
  const awaiting = page.waitForEvent('download', { timeout: 30000 });
  await button(page, name).click(); const item = await awaiting;
  const path = join(output, fileName); await item.saveAs(path); return readFile(path);
}
async function audition(page, selector) {
  const count = await page.evaluate(() => globalThis.__referenceArtifactObservation.buffers.length);
  await page.locator(selector).click();
  await expect.poll(() => page.evaluate(() => globalThis.__referenceArtifactObservation.buffers.length), { timeout: 30000 }).toBeGreaterThan(count);
  const value = await page.evaluate(() => { const value = globalThis.__referenceArtifactObservation.buffers.at(-1);
    return { rate: value.rate, channels: value.channels, samples: Array.from(value.samples) }; });
  await expect(button(page, 'Stop playback')).toBeDisabled({ timeout: 5000 }); return value;
}
async function windowFields(page, start, end) {
  await page.locator('#reference-start').fill(String(start));
  await page.locator('#reference-end').fill(String(end));
}
try {
  const original = complete(Array.from({ length: 8 }, (_, i) => canonicalAsset(i + 1)), true);
  const fixture = Buffer.from(JSON.stringify(original)); const fixturePath = join(output, 'original-maximum.melody.json');
  await writeFile(fixturePath, fixture);
  let page = await launch();
  report.chromium = context.browser()?.version() || await page.evaluate(() => navigator.userAgent);
  await importProject(page, fixturePath, original.document.composition.title);
  const first = await download(page, 'Save project file', 'maximum-downloaded.melody.json');
  assert.ok(first.equals(fixture));
  await importProject(page, join(output, 'maximum-downloaded.melody.json'), original.document.composition.title);
  await context.close(); context = null;
  page = await launch();
  await expect(page.getByLabel('Project title')).toHaveValue(original.document.composition.title);
  await expect(page.locator('#save-status')).toHaveText('Restored from this browser');
  const afterRestart = await download(page, 'Save project file', 'maximum-after-process-restart.melody.json');
  assert.ok(afterRestart.equals(fixture));
  const reopened = JSON.parse(afterRestart);
  for (let i = 0; i < 8; i++) assert.ok(decodeAsset(reopened.assets[i]).bytes.equals(decodeAsset(original.assets[i]).bytes));
  report.measured.maximum = { assets: 8, framesPerAsset: 441000, totalPcmBytes: 7056000,
    backupBytes: fixture.length, sha256: hash(fixture), completeProcessRestartByteExact: true };
  await windowFields(page, 19.9, 20);
  const reference = await audition(page, '#play-reference');
  const expectedReference = decodeAsset(original.assets[0]).samples.subarray(438795, 441000);
  assert.equal(reference.rate, RATE); assert.equal(reference.samples.length, 2205);
  assert.deepEqual(Float32Array.from(reference.samples), expectedReference);
  const notes = await audition(page, '#play-reference-notes');
  assert.equal(notes.rate, RATE); assert.equal(notes.samples.length, 2205);
  const gain = .4 * .95 / (3.2 * Math.cos(Math.PI / 4410)); let maximumError = 0;
  for (let i = 0; i < notes.samples.length; i++) {
    const expected = gain * Math.sin(2 * Math.PI * 440 * (438795 + i) / RATE);
    maximumError = Math.max(maximumError, Math.abs(notes.samples[i] - expected));
  }
  assert.ok(maximumError <= 2e-6);
  await writeFile(join(output, 'actual-reference-window.f32le'), Buffer.from(Float32Array.from(reference.samples).buffer));
  await writeFile(join(output, 'actual-edited-window.f32le'), Buffer.from(Float32Array.from(notes.samples).buffer));
  report.measured.audition = { captureTempo: 40, projectTempo: 120, windowFrames: [438795, 441000],
    frames: 2205, fullSoloExpectedFrames: 4235364, maximumAnalyticError: maximumError,
    referencePcmExact: true, outsideWindowLoudNotes: 8 };
  const midi = decodedMidi(await download(page, 'Export MIDI', 'ordinary-notes-only.mid'));
  // Legacy MIDI merges same-pitch overlaps to avoid ambiguous note-off events;
  // synthesis still sums all eight late voices for the peak-limiting oracle.
  assert.deepEqual(midi.tempos, [500000]); assert.equal(midi.notes.length, 2);
  assert.ok(midi.notes.every(note => note.pitch === 69 && note.velocity === 127));
  assert.deepEqual(midi.notes.map(note => note.tick), [0, 53760]);
  assert.deepEqual(midi.noteOffs, [{ tick: 7680, pitch: 69 }, { tick: 61440, pitch: 69 }]);
  const wav = decodedWav(await download(page, 'Export WAV', 'ordinary-notes-only.wav'));
  assert.equal(wav.length, 1412964);
  const ordinaryFrequency = measuredFrequency(wav.subarray(512, RATE - 512));
  assert.ok(Math.abs(ordinaryFrequency - 440) <= 3);
  assert.ok(Math.abs(rms(wav.subarray(512, RATE - 512)) - .11875 / Math.SQRT2) < .002);
  report.measured.ordinaryExports = { midi, wavFrames: wav.length, wavRate: RATE,
    frequencyHz: ordinaryFrequency, referenceNotMixed: true };
  await page.screenshot({ path: join(output, 'maximum-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(output, 'reference-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const short = complete([canonicalAsset(20, RATE)]);
  short.document.composition.title = 'Original zero-pad comparison';
  short.document.composition.tracks[0].notes = [{ id: 'short-note', pitch: 69, start: 0, duration: .25, velocity: 1 }];
  const shortPath = join(output, 'original-zero-pad.melody.json');
  await writeFile(shortPath, JSON.stringify(short)); await importProject(page, shortPath, short.document.composition.title);
  // At capture40, this note ends at.375s and its80ms release at.455s.
  // The later.6–.7s window must remain exactly2205 zero samples.
  await windowFields(page, .6, .7);
  const padded = await audition(page, '#play-reference-notes');
  assert.equal(padded.samples.length, 2205); assert.ok(padded.samples.every(sample => sample === 0));
  report.measured.zeroPadding = { captureTempo: 40, noteEndSeconds: .375, releaseEndSeconds: .455,
    windowFrames: [13230, 15435], outputFrames: 2205, allSamplesZero: true };

  const empty = complete([]); const emptyPath = join(output, 'original-empty.melody.json');
  await writeFile(emptyPath, JSON.stringify(empty)); await importProject(page, emptyPath, empty.document.composition.title);
  const measurements = [];
  for (const sourceRate of [44100, 48000]) for (const [kind, frequency] of [['tone', 440], ['tone', 1000], ['dc', 440], ['impulse', 440]]) {
    const name = `original-${kind}-${frequency}-${sourceRate}`;
    const input = inputWav(sourceRate, kind, frequency); const inputPath = join(output, `${name}.wav`);
    await writeFile(inputPath, input);
    await page.getByLabel('Import audio file', { exact: true }).setInputFiles(inputPath);
    await expect(page.getByRole('status')).toContainText(/Detected.*retained a normalized reference take/, { timeout: 30000 });
    await expect(page.locator('#save-status')).toHaveText('Saved in this browser', { timeout: 15000 });
    const actual = JSON.parse(await download(page, 'Save project file', `${name}.melody.json`));
    assert.equal(actual.assets.length, 1); const asset = actual.assets[0], samples = decodeAsset(asset).samples;
    assert.equal(asset.kind, 'audio-file'); assert.equal(asset.captureTempo, 120);
    assert.equal(asset.analyzedFrames, Math.min(asset.decodedFrames, Math.floor(asset.decodedSampleRate * 20)));
    assert.equal(asset.frameCount, Math.floor(asset.analyzedFrames * RATE / asset.decodedSampleRate));
    const result = { kind, sourceRate, decodedRate: asset.decodedSampleRate, decodedChannels: asset.decodedChannels,
      decodedFrames: asset.decodedFrames, retainedFrames: asset.frameCount, sha256: asset.sha256 };
    if (kind === 'tone') {
      const interior = samples.subarray(512, samples.length - 512);
      result.frequencyHz = measuredFrequency(interior); result.rms = rms(interior);
      result.frequencyErrorHz = Math.abs(result.frequencyHz - frequency);
      result.relativeRmsError = Math.abs(result.rms / (.3 / Math.SQRT2) - 1);
      assert.ok(result.frequencyErrorHz <= 3); assert.ok(result.relativeRmsError <= .02);
    } else if (kind === 'dc') {
      const interior = samples.subarray(Math.round(.6 * RATE) + 512, Math.round(1.6 * RATE) - 512);
      result.maximumLsbError = Math.max(...interior.map(sample => Math.abs(sample - .25) * 32767));
      assert.ok(result.maximumLsbError <= 3);
    } else {
      let peak = 0, index = 0;
      for (let i = Math.round(.7 * RATE); i < samples.length - 512; i++) {
        assert.ok(Number.isFinite(samples[i])); if (Math.abs(samples[i]) > peak) { peak = Math.abs(samples[i]); index = i; }
      }
      assert.ok(peak > .01); result.peakFrame = index; result.expectedFrame = 24255;
      result.frameError = Math.abs(index - 24255); assert.ok(result.frameError <= 2);
    }
    measurements.push(result);
  }
  report.measured.nativeNormalization = measurements;
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  report.success = true;
} catch (error) {
  report.success = false; report.failure = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  if (context) await context.close();
  report.durationSeconds = (performance.now() - startedAt) / 1000;
  report.pageErrors = errors; report.externalRequests = external;
  await writeFile(join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ success: report.success, output, verification: join(output, 'verification.json') }));
}
