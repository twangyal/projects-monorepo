/**
 * Independent original SMF/native artifact probe; no product parser/exporter imports.
 * Run against an already-built production server:
 *   MELODY_MIDI_BASE_URL=http://localhost:4238 node scripts/smoke_midi_import.mjs
 * MELODY_MIDI_BASE_URL is required for a native run and must be an HTTP(S) origin.
 * MELODY_MIDI_OUTPUT optionally names a NEW directory; existing paths are refused.
 * Without it, artifacts and the exclusively owned browser profile use a new OS
 * temporary directory. All artifacts/profile remain available after success/failure.
 * CHROMIUM_PATH optionally selects an executable; otherwise Playwright's installed
 * Chromium is used. This script never installs, starts or rebuilds the application.
 * --prepare-only writes the original 152-byte and exact 1 MiB SMF fixtures without
 * starting Chromium or requiring MELODY_MIDI_BASE_URL.
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import console from 'node:console';
import { performance } from 'node:perf_hooks';
import { TextEncoder } from 'node:util';
import { URL } from 'node:url';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.env.MELODY_MIDI_OUTPUT
  ? resolve(process.env.MELODY_MIDI_OUTPUT)
  : await mkdtemp(join(tmpdir(), 'melody-midi-native-'));
if (process.env.MELODY_MIDI_OUTPUT) await mkdir(root); // Refuse reused artifacts/profile.
const storageKey = 'melody-studio.project.v1';
const utf8 = text => [...new TextEncoder().encode(text)];
const u16 = value => [Math.floor(value / 256), value % 256];
const u32 = value => [Math.floor(value / 16777216), Math.floor(value / 65536) % 256, Math.floor(value / 256) % 256, value % 256];
function vlq(value) {
  const result = [value % 128];
  for (let rest = Math.floor(value / 128); rest; rest = Math.floor(rest / 128)) result.unshift(rest % 128 | 128);
  return result;
}
const event = (tick, bytes) => ({ tick, bytes });
const meta = (type, bytes) => [255, type, ...vlq(bytes.length), ...bytes];
function timed(rows, end) {
  let prior = 0;
  return [...rows, event(end, [255, 47, 0])].flatMap(row => {
    assert(row.tick >= prior);
    const bytes = [...vlq(row.tick - prior), ...row.bytes]; prior = row.tick; return bytes;
  });
}
function smf(tracks, ppqn = 100) {
  return Buffer.from([...utf8('MThd'), 0, 0, 0, 6, 0, 1, ...u16(tracks.length), ...u16(ppqn),
    ...tracks.flatMap(data => [...utf8('MTrk'), ...u32(data.length), ...data])]);
}
const phrase = smf([
  timed([event(0, meta(3, utf8('Literal <phrase> 🎵'))), event(0, [255, 81, 3, 7, 161, 32])], 800),
  timed([event(0, meta(3, utf8('Selected source'))), event(0, [194, 81]), event(0, [178, 7, 64]),
    event(0, [146, 68, 100]), event(50, [130, 68, 0]),
    event(213, [146, 69, 96]), event(313, [130, 69, 0]),
    event(413, [146, 72, 32]), event(513, [130, 72, 0]),
    event(600, [146, 76, 100]), event(700, [130, 76, 0])], 800),
  timed([event(215, [149, 60, 127]), event(315, [133, 60, 0])], 800),
]);
function maximumFixture() {
  const voices = Array.from({ length: 8 }, (_, channel) => timed(Array.from({ length: 256 }, (_, i) => [
    event(i * 50, [144 | channel, 60 + channel, 64]), event(i * 50 + 25, [128 | channel, 60 + channel, 0]),
  ]).flat(), 12800));
  const conductor = timed([event(0, [255, 81, 3, 7, 161, 32])], 12800);
  let remaining = 1048576 - smf([conductor, ...voices]).length;
  const padding = [];
  while (remaining) {
    let payload = Math.min(4096, remaining - 5);
    if (payload < 128) payload = remaining - 4;
    let bytes = 3 + vlq(payload).length + payload;
    if (remaining - bytes > 0 && remaining - bytes < 4) { payload -= 4 - (remaining - bytes); bytes = 3 + vlq(payload).length + payload; }
    assert(payload >= 0 && payload <= 4096);
    padding.push(0, 255, 1, ...vlq(payload), ...Array(payload).fill(65)); remaining -= bytes;
  }
  const result = smf([[...padding, ...conductor], ...voices]);
  assert.equal(result.length, 1048576); return result;
}
const maximum = maximumFixture();
await writeFile(root + '/off-grid-original.mid', phrase);
await writeFile(root + '/maximum-original.mid', maximum);
if (process.argv.includes('--prepare-only')) {
  console.log(JSON.stringify({ root, originalBytes: phrase.length, maximumBytes: maximum.length, tracks: 8, notesPerTrack: 256 }));
  process.exit(0);
}
const configuredURL = new URL(process.env.MELODY_MIDI_BASE_URL || 'missing:');
assert(['http:', 'https:'].includes(configuredURL.protocol) && !configuredURL.username && !configuredURL.password
  && configuredURL.pathname === '/' && !configuredURL.search && !configuredURL.hash,
'Set MELODY_MIDI_BASE_URL to the production server HTTP(S) origin.');
const baseURL = configuredURL.origin;
const isExternal = url => !url.startsWith('blob:') && !url.startsWith('data:') && new URL(url).origin !== baseURL;

function readMidi(bytes) {
  let offset = 0;
  const label = n => { const value = bytes.subarray(offset, offset + n).toString('ascii'); offset += n; return value; };
  assert.equal(label(4), 'MThd'); assert.equal(bytes.readUInt32BE(offset), 6); offset += 4;
  assert.equal(bytes.readUInt16BE(offset), 1); offset += 2;
  const count = bytes.readUInt16BE(offset); offset += 2;
  const ppqn = bytes.readUInt16BE(offset); offset += 2;
  const tracks = [];
  for (let index = 0; index < count; index++) {
    assert.equal(label(4), 'MTrk'); const end = offset + 4 + bytes.readUInt32BE(offset); offset += 4;
    let tick = 0, status = 0;
    const events = [], notes = [], active = new Map();
    const readVlq = () => { let value = 0; for (let i = 0; i < 4; i++) { assert(offset < end); const b = bytes[offset++]; value = value * 128 + (b & 127); if (!(b & 128)) return value; } throw Error('Malformed VLQ'); };
    while (offset < end) {
      tick += readVlq();
      if (bytes[offset] >= 128) status = bytes[offset++]; else assert(status >= 128 && status < 240);
      if (status === 255) {
        const type = bytes[offset++], size = readVlq(); assert(offset + size <= end);
        const data = [...bytes.subarray(offset, offset + size)]; offset += size; events.push({ tick, status, type, data });
        if (type === 47) { assert.equal(size, 0); assert.equal(offset, end); break; }
      } else {
        const kind = status & 240, channel = status & 15;
        const size = kind === 192 || kind === 208 ? 1 : 2;
        assert(offset + size <= end); const data = [...bytes.subarray(offset, offset + size)]; offset += size;
        assert(data.every(n => n < 128)); events.push({ tick, status, data });
        const key = channel + ':' + data[0];
        if (kind === 144 && data[1] > 0) { assert(!active.has(key)); active.set(key, { tick, velocity: data[1] }); }
        else if (kind === 128 || kind === 144 && data[1] === 0) {
          assert(active.has(key)); const on = active.get(key); active.delete(key);
          notes.push({ pitch: data[0], onTick: on.tick, offTick: tick, velocity: on.velocity, channel });
        }
      }
    }
    assert.equal(offset, end); assert.equal(active.size, 0); tracks.push({ events, notes });
  }
  assert.equal(offset, bytes.length); return { ppqn, tracks };
}
function readWav(bytes) {
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF'); assert.equal(bytes.readUInt32LE(4), bytes.length - 8);
  assert.equal(bytes.subarray(8, 16).toString(), 'WAVEfmt '); assert.equal(bytes.readUInt32LE(16), 16);
  assert.equal(bytes.readUInt16LE(20), 1); assert.equal(bytes.readUInt16LE(22), 1);
  assert.equal(bytes.readUInt32LE(24), 22050); assert.equal(bytes.readUInt32LE(28), 44100);
  assert.equal(bytes.readUInt16LE(32), 2); assert.equal(bytes.readUInt16LE(34), 16);
  assert.equal(bytes.subarray(36, 40).toString(), 'data'); assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
  assert.equal((bytes.length - 44) % 2, 0);
  const samples = Float64Array.from({ length: (bytes.length - 44) / 2 }, (_, i) => bytes.readInt16LE(44 + i * 2) / 32768);
  return { samples, frames: samples.length, sampleRate: 22050 };
}
function rms(samples, seconds, count = 4096) {
  const start = Math.round(seconds * 22050); assert(start + count <= samples.length);
  let energy = 0; for (const value of samples.subarray(start, start + count)) energy += value * value;
  return Math.sqrt(energy / count);
}
function peakFrequency(samples, seconds) {
  // Standalone radix-2 FFT with a Hann window; no product pitch detector/synth.
  const n = 4096, start = Math.round(seconds * 22050);
  const re = Float64Array.from({ length: n }, (_, i) => samples[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1))));
  const im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) [re[i], re[j]] = [re[j], re[i]]; }
  for (let size = 2; size <= n; size *= 2) {
    for (let block = 0; block < n; block += size) for (let j = 0; j < size / 2; j++) {
      const angle = -2 * Math.PI * j / size, a = block + j, b = a + size / 2;
      const tr = re[b] * Math.cos(angle) - im[b] * Math.sin(angle), ti = re[b] * Math.sin(angle) + im[b] * Math.cos(angle);
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
  let peak = 1; for (let i = 2; i < n / 2; i++) if (re[i] ** 2 + im[i] ** 2 > re[peak] ** 2 + im[peak] ** 2) peak = i;
  return peak * 22050 / n;
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { schemaVersion: 1, success: false, fixturesOriginal: true, noStorageInjection: true, noProductParserImports: true,
  thresholds: { fftWindow: 4096, frequencyToleranceHz: 22050 / 4096, rmsRelativeTolerance: .02, silence: 'Exactly zero PCM samples' },
  browser: null, fixtureBytes: { phrase: phrase.length, maximum: maximum.length }, timingsSeconds: {}, limitations: ['Synthetic MIDI validates interchange and synthesis, not General MIDI/DAW sound fidelity.', 'MIDI export 480-tick rounding and omitted trailing-window/EOT rest are intentional.', 'Browser audio playback controls are exercised; exported PCM is the independent audible-signal evidence.'] };
let browser;
const begun = performance.now(), errors = [], requests = [];
try {
  const profile = await mkdtemp(join(root, 'native-profile-'));
  const options = { ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: true, args: ['--no-sandbox'], acceptDownloads: true, viewport: { width: 1440, height: 1000 } };
  browser = await chromium.launchPersistentContext(profile, options);
  report.browser = browser.browser().version();
  let page = browser.pages()[0] || await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (isExternal(request.url())) requests.push(request.url()); });
  const confirmations = [];
  page.on('dialog', async dialog => { confirmations.push(dialog.message()); await dialog.accept(); });
  await page.goto(baseURL);
  const button = name => page.getByRole('button', { name, exact: true });
  const saved = () => page.evaluate(key => JSON.parse(globalThis.localStorage.getItem(key)), storageKey);
  async function download(name, file) {
    const pending = page.waitForEvent('download', { timeout: 90000 }); await button(name).click();
    const completed = await pending; await completed.saveAs(root + '/' + file); return readFile(root + '/' + file);
  }
  const baseline = JSON.parse((await download('Save project file', 'before.json')).toString('utf8'));
  async function importFixture(path, lanes, start, end, title, names) {
    await page.locator('#midi-file').setInputFiles(path);
    for (const channel of lanes) {
      const row = page.locator(`[data-midi-lane="channel-${channel}"]`);
      await expect(row).toBeVisible(); await row.locator('input[name="included"]').check();
      await row.locator('[name="name"]').fill(names(channel)); await row.locator('select[name="instrument"]').selectOption('sine');
    }
    await page.locator('#midi-start').fill(String(start)); await page.locator('#midi-end').fill(String(end));
    await page.locator('#midi-title').fill(title); await page.locator('#midi-review').click();
    await expect(page.locator('#midi-summary')).toBeVisible(); await expect(page.locator('#midi-apply')).toBeEnabled();
    await page.locator('#midi-apply').click();
    await expect.poll(async () => (await saved())?.title).toBe(title);
    return saved();
  }
  let start = performance.now();
  const project = await importFixture(root + '/off-grid-original.mid', [2], 3, 7, 'Off-grid imported phrase', () => 'Imported scalar sine');
  report.timingsSeconds.phraseImportApply = (performance.now() - start) / 1000;
  assert.equal(project.tempo, 120); assert.equal(project.tracks.length, 1);
  assert.deepEqual(project.tracks[0].notes.map(({ pitch, start, duration, velocity }) => ({ pitch, start, duration, velocity })),
    [{ pitch: 69, start: .13, duration: 1, velocity: 96 / 127 }, { pitch: 72, start: 2.13, duration: 1, velocity: 32 / 127 }]);
  assert.equal(project.tracks[0].volume, 64 / 127); assert.equal(project.tracks[0].instrument, 'sine');
  await button('Undo').click(); assert.deepEqual(JSON.parse((await download('Save project file', 'undone.json')).toString()), baseline);
  await expect(button('Undo')).toBeDisabled(); await button('Redo').click(); assert.deepEqual(await saved(), project);
  await button('Play composition').click(); await expect(button('Stop playback')).toBeEnabled(); await button('Stop playback').click();
  const json = await download('Save project file', 'phrase.json'); assert.deepEqual(JSON.parse(json.toString()), project);
  const midiBytes = await download('Export MIDI', 'phrase.mid'), midi = readMidi(midiBytes);
  assert.equal(midi.ppqn, 480); assert.equal(midi.tracks.length, 2);
  assert.deepEqual(midi.tracks[0].events.find(e => e.type === 81).data, [7, 161, 32]);
  assert.deepEqual(midi.tracks[1].events.find(e => e.status === 192).data, [73]);
  assert.deepEqual(midi.tracks[1].events.find(e => e.status === 176).data, [7, 64]);
  assert.deepEqual(midi.tracks[1].notes, [{ pitch: 69, onTick: 62, offTick: 542, velocity: 96, channel: 0 },
    { pitch: 72, onTick: 1022, offTick: 1502, velocity: 32, channel: 0 }]);
  const wavBytes = await download('Export WAV', 'phrase.wav'), wav = readWav(wavBytes);
  // Last note ends at 3.13 beats: ceil((3.13 * .5 + .08) * 22050).
  // The chosen window's trailing rest and source EOT are not Composition fields.
  assert.equal(wav.frames, 36273);
  for (const [a, b] of [[0, .05], [.70, 1]]) assert(wav.samples.subarray(Math.ceil(a * 22050), Math.floor(b * 22050)).every(value => value === 0));
  const metrics = [[.165, 440, 96], [1.165, 440 * 2 ** (3 / 12), 32]].map(([time, hz, velocity]) => {
    const measuredHz = peakFrequency(wav.samples, time), measuredRms = rms(wav.samples, time);
    const expectedRms = .4 * (64 / 127) * (velocity / 127) / Math.sqrt(2);
    assert(Math.abs(measuredHz - hz) <= 22050 / 4096);
    assert(Math.abs(measuredRms - expectedRms) / expectedRms <= .02);
    return { time, expectedHz: hz, measuredHz, expectedRms, measuredRms };
  });
  assert(Math.abs(metrics[1].measuredRms / metrics[0].measuredRms - 1 / 3) < .01);
  await page.reload(); assert.deepEqual(await saved(), project);
  await expect(button('Undo')).toBeDisabled();
  report.phrase = { frames: wav.frames, midiNotes: midi.tracks[1].notes, metrics, jsonSha256: sha256(json), midiSha256: sha256(midiBytes), wavSha256: sha256(wavBytes), nativeReloadExact: true };
  start = performance.now();
  const maximumProject = await importFixture(root + '/maximum-original.mid', [0,1,2,3,4,5,6,7], 1, 129, 'Maximum imported phrase', channel => 'Maximum channel ' + channel);
  assert.equal(maximumProject.tracks.length, 8);
  for (let channel = 0; channel < 8; channel++) {
    const track = maximumProject.tracks[channel]; assert.equal(track.notes.length, 256); assert.equal(track.volume, 100 / 127);
    assert(track.notes.every((note,i) => note.pitch === 60 + channel && note.start === i * .5 && note.duration === .25 && note.velocity === 64 / 127));
  }
  const ids = maximumProject.tracks.flatMap(track => [track.id,...track.notes.map(note => note.id)]); assert.equal(new Set(ids).size, 2056);
  const maxJson = await download('Save project file','maximum.json'); assert.deepEqual(JSON.parse(maxJson.toString()), maximumProject);
  const maxMidiBytes = await download('Export MIDI','maximum.mid'), maxMidi = readMidi(maxMidiBytes);
  assert.equal(maxMidi.tracks.length, 9);
  for (let channel = 0; channel < 8; channel++) {
    const track = maxMidi.tracks[channel + 1]; assert.equal(track.notes.length, 256);
    assert.deepEqual(track.events.find(e => e.status === (176 | channel)).data,[7,100]);
    assert(track.notes.every((note,i) => note.pitch === 60 + channel && note.channel === channel && note.onTick === i * 240 && note.offTick === i * 240 + 120 && note.velocity === 64));
  }
  const maxWavBytes = await download('Export WAV','maximum.wav'), maxWav = readWav(maxWavBytes);
  // Last end is 127.75 beats, with the existing 80 ms synthesis release.
  assert.equal(maxWav.frames, 1410208);
  const peak = maxWav.samples.reduce((v,n) => Math.max(v, Math.abs(n)),0); assert(peak > .01 && peak <= .951);
  assert(maxWav.samples.subarray(Math.ceil(.215 * 22050),Math.floor(.235 * 22050)).every(n => n === 0));
  await page.reload(); assert.deepEqual(await saved(),maximumProject);
  report.timingsSeconds.maximumImportArtifactsReload = (performance.now() - start) / 1000;
  await browser.close();
  browser = await chromium.launchPersistentContext(profile, options);
  page = browser.pages()[0] || await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (isExternal(request.url())) requests.push(request.url()); });
  await page.goto(baseURL);
  assert.deepEqual(await saved(), maximumProject);
  await expect(button('Undo')).toBeDisabled();
  const restartedJson = await download('Save project file', 'maximum-after-process-restart.json');
  assert.deepEqual(JSON.parse(restartedJson.toString()), maximumProject);
  report.nativeProcessRestart = { persistentProfile: profile, exactJsonBytes: restartedJson.equals(maxJson), sameProjectId: true, all2048NotesExact: true };
  assert(restartedJson.equals(maxJson));
  report.maximum = { bytes: maximum.length, tracks: 8, notes: 2048, jsonBytes: maxJson.length, midiBytes: maxMidiBytes.length, wavBytes: maxWavBytes.length, frames: maxWav.frames, peak, jsonSha256: sha256(maxJson), midiSha256: sha256(maxMidiBytes), wavSha256: sha256(maxWavBytes), nativeReloadExact: true };
  await page.evaluate(() => globalThis.scrollTo(0, 0));
  await page.screenshot({path:root+'/desktop.png',fullPage:false});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(() => globalThis.scrollTo(0, 0));
  assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth),true);
  await page.screenshot({path:root+'/mobile.png',fullPage:false});
  report.screenshots = { desktop: root + '/desktop.png', mobile: root + '/mobile.png', mobileWidth: 390, noHorizontalOverflow: true };
  report.confirmations = confirmations; assert.equal(confirmations.length,2);
  assert.equal(errors.length,0); assert.equal(requests.length,0); report.success=true;
} catch(error) { report.failure={name:error.name,message:error.message,stack:error.stack}; process.exitCode=1; }
finally {
  // Close the exclusively owned persistent Chromium even after a failed assertion.
  // Preserve a cleanup error as evidence while still writing the original failure.
  try { if (browser) await browser.close(); }
  catch (error) {
    report.cleanupFailure = { name: error.name, message: error.message };
    report.success = false;
    process.exitCode = 1;
  }
  report.pageErrors = errors;
  report.externalRequests = requests;
  report.timingsSeconds.total = (performance.now() - begun) / 1000;
  await writeFile(root + '/verification.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ report: root + '/verification.json', success: report.success }));
}
