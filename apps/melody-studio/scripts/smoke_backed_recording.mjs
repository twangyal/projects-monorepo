/**
 * Original maximum backed-recording oracle; no producer imports or fake results.
 * Requires MELODY_BACKED_BASE_URL (owned production loopback preview).
 * Optional MELODY_BACKED_FIXTURE_DIR and MELODY_BACKED_OUTPUT_DIR.
 * Run only after root releases the production build/browser slot.
 */
/* global process, Buffer, URL, AudioContext, AudioBufferSourceNode, navigator,
   document, MutationObserver, innerWidth, console */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { chromium, expect } from '@playwright/test';

const RATE = 22050;
const FIXTURE_HASH = '45befaebf0cb4f2ebafb004036d7b3e41b6782290f59144c614bb359c3cafa69';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const button = (page, name) => page.getByRole('button', { name, exact: true });
function assetPcm(asset) {
  const bytes = Buffer.from(asset.pcmBase64, 'base64');
  assert.equal(bytes.length, asset.frameCount * 2); assert.equal(hash(bytes), asset.sha256);
  return { bytes, samples: Float32Array.from({ length: asset.frameCount }, (_, i) => {
    const sample = bytes.readInt16LE(i * 2); return sample / (sample < 0 ? 32768 : 32767);
  }) };
}
function rms(samples) { return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length); }
function frequency(samples, rate) {
  const crossings = [];
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] <= 0 && samples[i] > 0)
    crossings.push(i - 1 - samples[i - 1] / (samples[i] - samples[i - 1]));
  assert.ok(crossings.length > 20, 'Original tone has enough independent zero crossings.');
  return (crossings.length - 1) * rate / (crossings.at(-1) - crossings[0]);
}
function interval(samples, start, end, rate = RATE) { return samples.subarray(Math.ceil(start * rate), Math.floor(end * rate)); }
// Scalar reference from the frozen existing oscillator contract, not a producer helper.
function scalarSines(composition, frames) {
  const samples = new Float64Array(frames);
  for (const track of composition.tracks) {
    if (track.muted || track.volume === 0) continue;
    assert.equal(track.instrument, 'sine', 'The authored audible fixture uses sine voices only.');
    for (const note of track.notes) {
      if (note.velocity === 0) continue;
      const first = Math.round(note.start * 60 / composition.tempo * RATE);
      const duration = note.duration * 60 / composition.tempo, hz = 440 * 2 ** ((note.pitch - 69) / 12);
      for (let index = 0; index < Math.ceil((duration + .08) * RATE) && first + index < frames; index++) {
        const time = index / RATE;
        const envelope = time < .01 ? time / .01 : time <= duration ? 1 : Math.max(0, 1 - (time - duration) / .08);
        samples[first + index] += .4 * track.volume * note.velocity * envelope * Math.sin(2 * Math.PI * hz * time);
      }
    }
  }
  let peak = 0; for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const gain = peak > .95 ? .95 / peak : 1;
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return { samples, peak, gain };
}
function wavDecode(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length);
  let at = 12, format, pcm;
  while (at + 8 <= bytes.length) {
    const name = bytes.toString('ascii', at, at + 4), size = bytes.readUInt32LE(at + 4);
    assert.ok(at + 8 + size <= bytes.length);
    if (name === 'fmt ') format = { encoding: bytes.readUInt16LE(at + 8), channels: bytes.readUInt16LE(at + 10),
      rate: bytes.readUInt32LE(at + 12), bits: bytes.readUInt16LE(at + 22) };
    if (name === 'data') { assert.equal(pcm, undefined); pcm = bytes.subarray(at + 8, at + 8 + size); }
    at += 8 + size + (size & 1);
  }
  assert.equal(at, bytes.length); assert.deepEqual(format, { encoding: 1, channels: 1, rate: RATE, bits: 16 });
  assert.ok(pcm && pcm.length % 2 === 0);
  return Float32Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2) / 32768);
}
function midiDecode(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'MThd'); assert.equal(bytes.readUInt32BE(4), 6);
  const result = { format: bytes.readUInt16BE(8), division: bytes.readUInt16BE(12), tracks: [] };
  const count = bytes.readUInt16BE(10); let at = 14;
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.toString('ascii', at, at + 4), 'MTrk');
    const end = at + 8 + bytes.readUInt32BE(at + 4); assert.ok(end <= bytes.length); at += 8;
    const track = { index, names: [], tempos: [], controls: [], notes: [], noteOffs: [], endTick: null };
    let tick = 0, running;
    const vlq = () => { let value = 0, byte, size = 0;
      do { assert.ok(at < end && size++ < 4); byte = bytes[at++]; value = value * 128 + (byte & 127); } while (byte & 128);
      return value; };
    while (at < end) {
      tick += vlq(); let status = bytes[at];
      if (status & 128) { at++; if (status < 240) running = status; } else { assert.ok(running); status = running; }
      if (status === 255) {
        const type = bytes[at++], length = vlq(); assert.ok(at + length <= end);
        if (type === 3) track.names.push(bytes.toString('utf8', at, at + length));
        if (type === 81) { assert.equal(length, 3); track.tempos.push(bytes.readUIntBE(at, 3)); }
        if (type === 47) { assert.equal(length, 0); track.endTick = tick; }
        at += length; running = undefined; continue;
      }
      if (status === 240 || status === 247) { const length = vlq(); at += length; assert.ok(at <= end); running = undefined; continue; }
      const kind = status >> 4, channel = status & 15;
      assert.ok(kind >= 8 && kind <= 14); const first = bytes[at++], second = kind === 12 || kind === 13 ? 0 : bytes[at++];
      assert.ok(first < 128 && second < 128 && at <= end);
      if (kind === 9 && second) track.notes.push({ tick, pitch: first, velocity: second, channel });
      if (kind === 8 || (kind === 9 && second === 0)) track.noteOffs.push({ tick, pitch: first, channel });
      if (kind === 11) track.controls.push({ controller: first, value: second, channel });
    }
    assert.equal(at, end); assert.notEqual(track.endTick, null); result.tracks.push(track);
  }
  assert.equal(at, bytes.length); return result;
}
async function browserPids(context) {
  const session = await context.browser().newBrowserCDPSession();
  try { return (await session.send('SystemInfo.getProcessInfo')).processInfo.filter(p => p.type === 'browser').map(p => p.id); }
  finally { await session.detach(); }
}
function processReceipt(pid) {
  try { process.kill(pid, 0); return { pid, exists: true }; }
  catch (error) { return { pid, exists: error.code !== 'ESRCH', code: error.code }; }
}
async function main() {
  const base = process.env.MELODY_BACKED_BASE_URL; assert.ok(base, 'Supply the explicitly owned normal production preview.');
  const url = new URL(base); assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  const fixtureDir = resolve(process.env.MELODY_BACKED_FIXTURE_DIR || '/workspace/melody113-maximum-fixtures');
  const out = process.env.MELODY_BACKED_OUTPUT_DIR ? resolve(process.env.MELODY_BACKED_OUTPUT_DIR) : await mkdtemp(join(tmpdir(), 'melody-backed-maximum-'));
  if (process.env.MELODY_BACKED_OUTPUT_DIR) await mkdir(out, { recursive: false });
  const originalBytes = await readFile(join(fixtureDir, 'original.melody.json'));
  const expectationsBytes = await readFile(join(fixtureDir, 'expectations.json'));
  await writeFile(join(out, 'original.melody.json'), originalBytes); await writeFile(join(out, 'expectations.json'), expectationsBytes);
  const original = JSON.parse(originalBytes), expected = JSON.parse(expectationsBytes);
  const evidence = { schemaVersion: 1, issue: 113, status: 'running', output: out, origin: url.origin,
    startedAtUtc: new Date().toISOString(), original: { bytes: originalBytes.length, sha256: hash(originalBytes) },
    expectationsSha256: hash(expectationsBytes), artifacts: [], checks: [], measured: {}, processes: [],
    limits: ['Original synthetic microphone is a real native AudioBufferSource → MediaStreamDestination → actual production AudioWorklet.',
      'Only getUserMedia supplies a synthetic stream; backing starts and AudioContext construction are observed and forwarded unchanged.',
      'Native MediaStream buffering and graph resampling are retained. No delay compensation, reference trimming or shifted expected PCM.',
      'This is software graph timing, not physical latency, acoustic isolation or microphone recognition quality.',
      'Exact worklet frame selection is gated separately by the production-worklet peer harness.',
      'The runner owns only its persistent Chromium processes, profile and new output directory; it does not stop the supplied preview.'] };
  const save = () => writeFile(join(out, 'verification.json'), JSON.stringify(evidence, null, 2) + '\n');
  const artifact = async (name, bytes) => { await writeFile(join(out, name), bytes); evidence.artifacts.push({ name, bytes: bytes.length, sha256: hash(bytes) }); return bytes; };
  await save();
  assert.equal(originalBytes.length, 9562719); assert.equal(hash(originalBytes), FIXTURE_HASH);
  assert.equal(original.document.composition.tracks.length, 8);
  assert.equal(original.document.composition.tracks.reduce((n, track) => n + track.notes.length, 0), 2048);
  assert.equal(original.assets.length, 8);
  for (let i = 0; i < 8; i++) { const pcm = assetPcm(original.assets[i]); await artifact('original-reference-' + i + '.pcm', pcm.bytes); assert.equal(hash(pcm.bytes), expected.original.assetSha256[i]); }
  const errors = [], external = []; let context, page; const begun = performance.now();
  const launch = async () => {
    context = await chromium.launchPersistentContext(join(out, 'profile'), { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      headless: true, acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    evidence.processes.push({ phase: evidence.processes.length ? 'restarted' : 'initial', pids: await browserPids(context) });
    await context.addInitScript(({ input }) => {
      const NativeContext = AudioContext, nativeStart = AudioBufferSourceNode.prototype.start;
      const observation = { context: null, starts: [], labels: [], backing: null, stream: null, inputSource: null, inputWhen: null, inputSettings: null, zero: null };
      Object.defineProperty(globalThis, '__backedMaximum', { value: observation });
      globalThis.AudioContext = class extends NativeContext { constructor(...options) { super(...options); observation.context = this; } };
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
        const graph = observation.context; if (!graph) throw new Error('Actual shared AudioContext was not observed.');
        const destination = graph.createMediaStreamDestination(); destination.channelCount = 1;
        const zero = graph.createConstantSource(); zero.offset.value = 0; zero.connect(destination); zero.start(); observation.zero = zero;
        const buffer = graph.createBuffer(1, input.rate * input.durationSeconds, input.rate), samples = buffer.getChannelData(0);
        for (const segment of input.segments) for (let i = Math.round(segment.startSeconds * input.rate); i < Math.round(segment.endSeconds * input.rate); i++)
          samples[i] = input.amplitude * Math.sin(2 * Math.PI * segment.hz * i / input.rate);
        const microphone = graph.createBufferSource(); microphone.buffer = buffer; microphone.connect(destination);
        const settings = destination.stream.getAudioTracks()[0].getSettings();
        observation.inputSettings = { channelCount: settings.channelCount, sampleRate: settings.sampleRate };
        observation.inputSource = microphone; observation.stream = destination.stream; return destination.stream;
      } });
      AudioBufferSourceNode.prototype.start = function (...args) {
        const buffer = this.buffer;
        if (this !== observation.inputSource && this.context === observation.context && buffer) {
          observation.starts.push({ when: args[0] ?? 0, rate: buffer.sampleRate, frames: buffer.length, channels: buffer.numberOfChannels,
            nonzero: buffer.getChannelData(0).some(sample => sample !== 0), graphTimeAtCall: this.context.currentTime });
          if (buffer.sampleRate === 22050 && buffer.length === 441000) observation.backing = { rate: buffer.sampleRate, samples: buffer.getChannelData(0).slice() };
        }
        const result = nativeStart.apply(this, args);
        if (buffer?.sampleRate === 22050 && buffer.length === 441000 && this !== observation.inputSource && observation.inputWhen === null) {
          observation.inputWhen = args[0] ?? 0; nativeStart.call(observation.inputSource, observation.inputWhen);
        }
        return result;
      };
      const observe = () => new MutationObserver(() => {
        const text = document.querySelector('#capture-state')?.textContent?.trim();
        if (text && observation.labels.at(-1)?.text !== text) { observation.labels.push({ text, milliseconds: performance.now() }); if (observation.labels.length > 500) observation.labels.shift(); }
      }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
      if (document.documentElement) observe(); else document.addEventListener('DOMContentLoaded', observe, { once: true });
    }, { input: expected.input });
    page = context.pages()[0]; page.on('dialog', dialog => dialog.accept()); page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { const target = new URL(request.url()); if (/^https?:$/.test(target.protocol) && target.origin !== url.origin) external.push(target.origin); });
    await page.goto(base); await expect(button(page, 'Save project file')).toBeEnabled({ timeout: 30000 });
    evidence.browserVersion = context.browser().version(); evidence.scripts = await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => new URL(node.src).pathname));
  };
  const download = async (label, name) => {
    const ready = page.waitForEvent('download', { timeout: 60000 }); await button(page, label).click();
    const file = await ready; await file.saveAs(join(out, name)); const bytes = await readFile(join(out, name));
    evidence.artifacts.push({ name, bytes: bytes.length, sha256: hash(bytes) }); return bytes;
  };
  const close = async () => { if (!context) return; const pids = await browserPids(context); await context.close(); context = null; evidence.processes.at(-1).afterClose = pids.map(processReceipt); };
  try {
    await launch();
    await page.getByLabel('Open project file', { exact: true }).setInputFiles(join(out, 'original.melody.json'));
    await expect(page.getByLabel('Project title')).toHaveValue(original.document.composition.title);
    await expect(page.locator('#save-status')).toHaveText('Saved in this browser', { timeout: 30000 });
    const before = await download('Save project file', 'before-recording.melody.json');
    assert.deepEqual(JSON.parse(before), original); assert.deepEqual(before, originalBytes); evidence.checks.push('Original maximum graph and all eight PCM assets imported and durably saved.');
    await page.locator('[data-track="' + expected.backing.target + '"]').click();
    const captureStarted = performance.now(); await button(page, 'Record with backing').click();
    await expect(page.locator('#capture-state')).toContainText(/Recording .*20 seconds with backing/, { timeout: 30000 });
    await expect(page.locator('[role="status"]')).toContainText('Detected', { timeout: 60000 });
    await expect(button(page, 'Record with backing')).toBeEnabled({ timeout: 30000 });
    await expect(page.locator('#save-status')).toHaveText('Saved in this browser', { timeout: 30000 });
    evidence.measured.captureToSavedMilliseconds = performance.now() - captureStarted;
    // Preserve all native outputs before any result-dependent numerical assertion.
    const capturedBytes = await download('Save project file', 'captured.melody.json');
    const midiBytes = await download('Export MIDI', 'captured.mid');
    const wavBytes = await download('Export WAV', 'captured.wav');
    const captured = JSON.parse(capturedBytes), target = captured.document.composition.tracks.find(track => track.id === expected.backing.target);
    const targetRef = captured.document.references.find(reference => reference.trackId === target.id), targetAsset = captured.assets.find(asset => asset.id === targetRef.assetId);
    const pcmBytes = Buffer.from(targetAsset.pcmBase64, 'base64'); await artifact('captured-reference.pcm', pcmBytes);
    const observation = await page.evaluate(() => { const value = globalThis.__backedMaximum; return {
      starts: value.starts, labels: value.labels, inputWhen: value.inputWhen, inputSettings: value.inputSettings, contextRate: value.context.sampleRate,
      streamEnded: value.stream.getTracks().every(track => track.readyState === 'ended'),
      backingRate: value.backing.rate, backingSamples: Array.from(value.backing.samples),
    }; });
    await artifact('observed-backing.f32', Buffer.from(Float32Array.from(observation.backingSamples).buffer));
    await artifact('graph-observation.json', Buffer.from(JSON.stringify({ ...observation, backingSamples: undefined }, null, 2)));
    assert.equal(captured.document.composition.tracks.length, 8); assert.equal(captured.assets.length, 8);
    assert.equal(target.notes.length, 3);
    for (let i = 0; i < 3; i++) {
      assert.equal(target.notes[i].pitch, expected.expectedNotes[i].pitch);
      assert.ok(Math.abs(target.notes[i].start - expected.expectedNotes[i].start) <= expected.limits.quarterBeatBoundaryTolerance);
      assert.ok(Math.abs(target.notes[i].duration - expected.expectedNotes[i].duration) <= expected.limits.quarterBeatBoundaryTolerance);
    }
    assert.deepEqual({ ...target, notes: [] }, { ...original.document.composition.tracks[0], notes: [] });
    for (const part of original.document.composition.tracks.slice(1)) {
      assert.deepEqual(captured.document.composition.tracks.find(track => track.id === part.id), part);
      const reference = original.document.references.find(ref => ref.trackId === part.id);
      assert.deepEqual(captured.document.references.find(ref => ref.trackId === part.id), reference);
      assert.deepEqual(captured.assets.find(asset => asset.id === reference.assetId), original.assets.find(asset => asset.id === reference.assetId));
    }
    const normalized = assetPcm(targetAsset); assert.equal(targetAsset.kind, 'microphone'); assert.equal(targetAsset.captureTempo, 120);
    assert.equal(targetAsset.frameCount, 441000); assert.equal(targetAsset.decodedSampleRate, observation.contextRate);
    // Chromium's native WebAudio MediaStream is stereo even when fed a mono buffer.
    assert.equal(observation.inputSettings.channelCount, 2);
    assert.equal(targetAsset.decodedChannels, observation.inputSettings.channelCount);
    assert.equal(observation.inputSettings.sampleRate, observation.contextRate);
    assert.equal(targetAsset.decodedFrames, observation.contextRate * 20);
    assert.equal(targetAsset.analyzedFrames, targetAsset.decodedFrames); assert.equal(observation.streamEnded, true);
    const microphoneMeasurements = expected.input.segments.map(segment => {
      const samples = interval(normalized.samples, segment.startSeconds + .2, segment.endSeconds - .2);
      const hz = frequency(samples, RATE), measuredRms = rms(samples);
      assert.ok(Math.abs(hz - segment.hz) <= expected.limits.editorToneHzTolerance);
      assert.ok(Math.abs(measuredRms / (expected.input.amplitude / Math.sqrt(2)) - 1) <= expected.limits.editorInteriorRmsRelativeTolerance);
      return { hz, rms: measuredRms };
    });
    for (const [a, b] of [[.1,.35],[1.75,1.9],[3.35,18.7]]) assert.ok(rms(interval(normalized.samples,a,b)) <= 2 / 32768);
    const backing = Float32Array.from(observation.backingSamples);
    assert.equal(backing.length, 441000); assert.equal(observation.backingRate, RATE);
    const expectedBacking = scalarSines({ ...original.document.composition,
      tracks: original.document.composition.tracks.filter(track => track.id !== expected.backing.target) }, 441000);
    let backingErrorUnits = 0;
    for (let i = 0; i < backing.length; i++) backingErrorUnits = Math.max(backingErrorUnits, Math.abs(backing[i] - expectedBacking.samples[i]) * 32768);
    assert.ok(backingErrorUnits <= 2, 'Native backing matches the independently limited sine mix within two signed16 units.');
    const backingHz = frequency(interval(backing,.08,.4), RATE); assert.ok(Math.abs(backingHz - 261.6255653005986) <= 1);
    assert.ok(backing.subarray(Math.ceil(.58 * RATE)).every(value => value === 0), 'Short backing becomes exact silence; references and old target are excluded.');
    const nativeBacking = observation.starts.find(source => source.frames === 441000 && source.rate === RATE);
    const clicks = observation.starts.filter(source => source !== nativeBacking && source.frames / source.rate <= .2);
    assert.equal(clicks.length, 4); assert.ok(clicks.every(click => click.nonzero));
    for (let i = 0; i < 4; i++) assert.ok(Math.abs(clicks[i].when - (nativeBacking.when - 2 + i * .5)) <= 1 / observation.contextRate);
    assert.equal(observation.inputWhen, nativeBacking.when);
    assert.deepEqual([...new Set(observation.labels.map(label => label.text.match(/Count-in beat ([1-4])/)?.[1]).filter(Boolean))], ['1','2','3','4']);
    const midi = midiDecode(midiBytes); assert.equal(midi.format, 1); assert.equal(midi.division, 480); assert.equal(midi.tracks.length, 9);
    assert.deepEqual(midi.tracks[0].tempos, [500000]);
    assert.deepEqual(midi.tracks[1].notes, target.notes.map(note => ({ tick: Math.round(note.start * 480), pitch: note.pitch, velocity: Math.max(1,Math.round(note.velocity * 127)), channel: 0 })));
    assert.deepEqual(midi.tracks[1].noteOffs, target.notes.map(note => ({ tick: Math.round((note.start + note.duration) * 480), pitch: note.pitch, channel: 0 })));
    assert.deepEqual(midi.tracks[2].notes, [{ tick: 0, pitch: 60, velocity: 102, channel: 1 }]);
    assert.equal(midi.tracks[3].controls.find(control => control.controller === 7).value, 0);
    assert.ok(midi.tracks.slice(4).every(track => track.notes.length === 0));
    const wav = wavDecode(wavBytes);
    const latest = Math.max(4, ...captured.document.composition.tracks.flatMap(track => track.notes.map(note => note.start + note.duration)));
    assert.equal(wav.length, Math.ceil((latest / 2 + .08) * RATE));
    const expectedWave = scalarSines(captured.document.composition, wav.length); let wavErrorUnits = 0;
    for (let i = 0; i < wav.length; i++) {
      const sample = expectedWave.samples[i], wanted = Math.round(sample * (sample < 0 ? 32768 : 32767));
      wavErrorUnits = Math.max(wavErrorUnits, Math.abs(Math.round(wav[i] * 32768) - wanted));
    }
    assert.ok(wavErrorUnits <= 2, 'Actual PCM16 WAV matches independent whole-mix gain/envelope within two signed16 units.');
    const wavFrequencies = expected.input.segments.map(segment => {
      const hz = frequency(interval(wav, segment.startSeconds + .3, segment.endSeconds - .3), RATE);
      assert.ok(Math.abs(hz - segment.hz) <= 3); return hz;
    });
    assert.ok(interval(wav,3.35,18.7).every(sample => sample === 0), 'WAV never mixes retained reference recordings.');
    evidence.measured = { ...evidence.measured, notes: target.notes, reference: { frames: targetAsset.frameCount,
      inputGraphRate: observation.contextRate, inputGraphChannels: targetAsset.decodedChannels, sha256: targetAsset.sha256,
      microphoneMeasurements }, backingHz, clickFrames: clicks.map(click => Math.round(click.when * observation.contextRate)),
      backingStartFrame: Math.round(nativeBacking.when * observation.contextRate),
      backing: { preLimitPeak: expectedBacking.peak, gain: expectedBacking.gain, maximumErrorSigned16Units: backingErrorUnits },
      wav: { frames: wav.length, frequencies: wavFrequencies, preLimitPeak: expectedWave.peak,
        gain: expectedWave.gain, maximumErrorSigned16Units: wavErrorUnits }, midi };
    evidence.checks.push('Automatic complete 20-second take, three authored tones, four scheduled clicks, dry backing and untouched seven parts/references.');
    await button(page, 'Undo').click(); await expect(page.locator('#save-status')).toHaveText('Saved in this browser', { timeout: 30000 });
    const undone = await download('Save project file', 'undo.melody.json'); assert.deepEqual(undone, originalBytes);
    await button(page, 'Redo').click(); await expect(page.locator('#save-status')).toHaveText('Saved in this browser', { timeout: 30000 });
    const redone = await download('Save project file', 'redo.melody.json'); assert.deepEqual(redone, capturedBytes);
    evidence.checks.push('Exactly one Undo restores original graph and all bytes; Redo restores exact captured backup.');
    await close(); await launch();
    await expect(page.getByLabel('Project title')).toHaveValue(original.document.composition.title);
    await expect(page.locator('#save-status')).toHaveText('Restored from this browser', { timeout: 30000 });
    const restarted = await download('Save project file', 'after-process-restart.melody.json'); assert.deepEqual(restarted, capturedBytes);
    assert.notDeepEqual(evidence.processes[0].pids, evidence.processes[1].pids); evidence.checks.push('Genuine Chromium process restart restores exact saved complete backup.');
    await page.screenshot({ path: join(out, 'desktop.png') }); await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.screenshot({ path: join(out, '390px.png') });
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    assert.deepEqual(await readFile(join(fixtureDir,'original.melody.json')), originalBytes);
    evidence.status = 'passed'; evidence.milliseconds = performance.now() - begun; evidence.errors = errors; evidence.externalRequests = external;
  } catch (error) {
    evidence.status = 'failed'; evidence.failure = { message: String(error.message).slice(0,3000), stack: String(error.stack).slice(0,6000) };
    if (page && !page.isClosed()) { try { await page.screenshot({ path: join(out,'failure.png') }); } catch { /* Preserve primary failure. */ } }
    throw error;
  } finally { await close(); evidence.milliseconds ??= performance.now() - begun; await save(); }
  console.log(JSON.stringify({ status:evidence.status, output:out, milliseconds:evidence.milliseconds, browser:evidence.browserVersion }));
}
main().catch(error => { console.error(String(error.message).slice(0,3000)); process.exitCode=1; });
