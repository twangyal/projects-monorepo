import { expect, test } from '@playwright/test';

test('the editor exposes retained reference takes and bounded comparison controls', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Reference take', exact: true })).toBeVisible();
  await expect(page.locator('#reference-empty')).toBeVisible();
});

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page, type Download } from '@playwright/test';
import { decodeMidi, decodeWav } from './continuation-fixtures.ts';
import type { Composition } from '../../src/types.ts';

const DB = 'melody-studio.projects';
const LEGACY = 'melody-studio.project.v1';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
interface Asset {
  id: string; kind: string; captureTempo: number; decodedSampleRate: number; decodedChannels: number;
  decodedFrames: number; analyzedFrames: number; frameCount: number; sha256: string; pcmBase64: string;
}
interface Backup { format: string; version: number; document: { schemaVersion: number; composition: Composition; references: { trackId: string; assetId: string }[] }; assets: Asset[] }
interface SourceProbe { sampleRate: number; samples: number[] }
interface Probe {
  sources: SourceProbe[]; starts: number; stops: number; resumes: number; held: string | null;
  gate: string | null; release: (() => void) | null; abortSave: boolean; aborted: number;
  endCallbacks: Array<() => void>; projectPuts: string[];
}
type ProbeWindow = Window & { __referenceAcceptance: Probe };

// These are original RIFF bytes, independent of the app's WAV/backup encoders.
function tone(rate: number, frequency: number, seconds = 1.5, channels = 1, opposite = false, silent = false) {
  const frames = Math.round(rate * seconds), bytes = Buffer.alloc(44 + frames * channels * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let frame = 0; frame < frames; frame++) {
    const time = frame / rate;
    const value = silent || time < .125 || time >= seconds - .25 ? 0 : Math.round(.25 * 32767 * Math.sin(2 * Math.PI * frequency * time));
    for (let channel = 0; channel < channels; channel++) bytes.writeInt16LE(opposite && channel === 1 ? -value : value, 44 + (frame * channels + channel) * 2);
  }
  return bytes;
}
function literalProject(generation = 1, count = 1, seconds = 1.5): Backup {
  const assets: Asset[] = [], tracks: Composition['tracks'] = [], references: Backup['document']['references'] = [];
  for (let i = 0; i < count; i++) {
    const id = `${generation.toString(16).padStart(8, '0')}-0000-4000-8000-${(i + 1).toString(16).padStart(12, '0')}`;
    const frameCount = Math.round(seconds * 22050), pcm = Buffer.alloc(frameCount * 2);
    for (let frame = 0; frame < frameCount; frame++) pcm.writeInt16LE(Math.round(6000 * Math.sin(2 * Math.PI * 440 * frame / 22050)), frame * 2);
    const trackId = `authored-track-${i}`;
    assets.push({ id, kind: 'audio-file', captureTempo: 120, decodedSampleRate: 22050, decodedChannels: 1,
      decodedFrames: frameCount, analyzedFrames: frameCount, frameCount, sha256: hash(pcm), pcmBase64: pcm.toString('base64') });
    tracks.push({ id: trackId, name: `Authored voice ${i + 1}`, instrument: 'sine', volume: .5, muted: false,
      notes: [{ id: `authored-note-${i}`, pitch: 69, start: .25, duration: 1, velocity: .5 }] });
    references.push({ trackId, assetId: id });
  }
  return { format: 'melody-studio-project', version: 1,
    document: { schemaVersion: 1, composition: { version: 1, title: `Original reference ${generation}`, tempo: 120, tracks }, references }, assets };
}
async function bytes(download: Download) { const path = await download.path(); if (!path) throw new Error('Expected an actual native download.'); return readFile(path); }
async function backup(page: Page): Promise<Backup> {
  const downloading = page.waitForEvent('download', { timeout: 10000 }); await page.getByRole('button', { name: 'Save project file', exact: true }).click();
  const result = JSON.parse((await bytes(await downloading)).toString('utf8')) as Backup;
  expect(result.format).toBe('melody-studio-project'); expect(result.version).toBe(1);
  for (const asset of result.assets) { const pcm = Buffer.from(asset.pcmBase64, 'base64'); expect(pcm.length).toBe(asset.frameCount * 2); expect(hash(pcm)).toBe(asset.sha256); }
  expect(result.assets.map(a => a.id).sort()).toEqual(result.document.references.map(r => r.assetId).filter((id, i, all) => all.indexOf(id) === i).sort());
  return result;
}
async function open(page: Page, project = literalProject()) {
  await expect(page.getByLabel('Open project file', { exact: true })).toBeEnabled();
  await page.getByLabel('Open project file', { exact: true }).setInputFiles({ name: 'authored-complete.melody.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.getByLabel('Project title')).toHaveValue(project.document.composition.title);
  await expect(page.locator('#reference-summary')).toContainText('120');
}
async function saved(page: Page) { await expect(page.locator('#save-status')).toContainText(/Saved|Restored/i); }
async function importTone(page: Page, rate = 44100, frequency = 440, channels = 1, opposite = false, silent = false) {
  await expect(page.getByLabel('Import audio file')).toBeEnabled();
  await page.getByLabel('Import audio file').setInputFiles({ name: `original-${rate}-${frequency}.wav`, mimeType: 'audio/wav', buffer: tone(rate, frequency, 1.5, channels, opposite, silent) });
}
async function installProbe(page: Page, initialGate: string | null = null) {
  await page.addInitScript(initialGate => {
    const probe: Probe = { sources: [], starts: 0, stops: 0, resumes: 0, held: null, gate: initialGate, release: null, abortSave: false, aborted: 0, endCallbacks: [], projectPuts: [] };
    (window as unknown as ProbeWindow).__referenceAcceptance = probe;
    const hold = async <T>(name: string, value: T): Promise<T> => {
      if (probe.gate !== name) return value;
      probe.held = name;
      await new Promise<void>(resolve => { probe.release = () => { probe.gate = null; probe.held = null; probe.release = null; resolve(); }; });
      return value;
    };
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function (data: ArrayBuffer) { return decode.call(this, data).then(value => hold('decode', value)); };
    const render = OfflineAudioContext.prototype.startRendering;
    OfflineAudioContext.prototype.startRendering = function () { return render.call(this).then(value => hold('normalize', value)); };
    const resume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () { probe.resumes++; return resume.call(this).then(value => hold('resume', value)); };
    const arrayBuffer = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () { return arrayBuffer.call(this).then(value => hold(this.name === 'held-complete.json' ? 'file' : 'unused', value)); };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', event => {
          if (probe.gate !== 'worker') return;
          event.stopImmediatePropagation(); probe.held = 'worker';
          probe.release = () => {
            probe.gate = null; probe.held = null; probe.release = null;
            this.dispatchEvent(new MessageEvent('message', { data: event.data }));
          };
        });
      }
    };
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = create.call(this), start = source.start.bind(source), stop = source.stop.bind(source);
      source.stop = (...args: Parameters<AudioBufferSourceNode['stop']>) => { probe.stops++; stop(...args); };
      source.start = (...args: Parameters<AudioBufferSourceNode['start']>) => {
        probe.starts++;
        if (source.buffer) probe.sources.push({ sampleRate: source.buffer.sampleRate, samples: Array.from(source.buffer.getChannelData(0)) });
        if (source.onended) { const callback = source.onended; probe.endCallbacks.push(() => callback.call(source, new Event('ended'))); }
        start(...args);
      };
      return source;
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      const request = key === undefined ? put.call(this, value) : put.call(this, value, key);
      if (this.transaction.db.name === 'melody-studio.projects' && this.name === 'projects') {
        probe.projectPuts.push((value as { document: { composition: { title: string } } }).document.composition.title);
      }
      if (probe.abortSave && this.transaction.db.name === 'melody-studio.projects' && this.name === 'projects') {
        probe.abortSave = false;
        request.addEventListener('success', () => { probe.aborted++; this.transaction.abort(); }, { once: true });
      }
      return request;
    };
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (names: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions) {
      const tx = transaction.call(this, names, mode, options);
      if (this.name === 'melody-studio.projects' && mode === 'readwrite' && (probe.gate === 'save' || probe.gate === 'save-next')) {
        const heldGate = probe.gate;
        probe.held = heldGate;
        probe.release = () => { probe.gate = heldGate === 'save' ? 'save-next' : null; probe.held = null; probe.release = null; };
        const keepAlive = () => {
          if (probe.gate !== heldGate) return;
          const request = tx.objectStore('projects').get('current');
          request.addEventListener('success', keepAlive, { once: true });
        };
        keepAlive();
      }
      if (this.name === 'melody-studio.projects' && mode === 'readonly' && probe.gate === 'load') {
        probe.held = 'load';
        probe.release = () => { probe.gate = null; probe.held = null; probe.release = null; };
        const keepAlive = () => {
          if (probe.gate !== 'load') return;
          const request = tx.objectStore('projects').get('current');
          request.addEventListener('success', keepAlive, { once: true });
        };
        keepAlive();
      }
      return tx;
    };
  }, initialGate);
}
async function gate(page: Page, name: string) { await page.evaluate(value => { (window as unknown as ProbeWindow).__referenceAcceptance.gate = value; }, name); }
async function held(page: Page, name: string) { await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__referenceAcceptance.held)).toBe(name); }
async function release(page: Page) { await page.evaluate(() => { (window as unknown as ProbeWindow).__referenceAcceptance.release?.(); }); }
async function sources(page: Page) { return page.evaluate(() => (window as unknown as ProbeWindow).__referenceAcceptance.sources); }
function pcmFloats(asset: Asset) { const pcm = Buffer.from(asset.pcmBase64, 'base64'); return Array.from({ length: asset.frameCount }, (_, i) => { const value = pcm.readInt16LE(i * 2); return Math.fround(value / (value < 0 ? 32768 : 32767)); }); }
async function idb(page: Page) {
  return page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open(name, 1); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    try {
      const tx = db.transaction(['projects', 'assets'], 'readonly');
      const completed = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
      const descriptor = await new Promise<{ document: { references: { assetId: string }[] } } | undefined>((resolve, reject) => { const req = tx.objectStore('projects').get('current'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      const assets = await Promise.all((descriptor?.document.references ?? []).map(({ assetId }) => new Promise<{ id: string; sha256: string; pcm: Blob }>((resolve, reject) => { const req = tx.objectStore('assets').get(assetId); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); })));
      await completed;
      return { descriptor, assets: await Promise.all(assets.map(async item => ({ id: item.id, declared: item.sha256, bytes: item.pcm.size,
        digest: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await item.pcm.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('') }))) };
    } finally { db.close(); }
  }, DB);
}

for (const [rate, frequency, expectedPitch] of [[44100, 440, 69], [48000, 1000, 83]]) {
  test(`native ${rate} Hz import retains a ${frequency} Hz reference with original silence and notes-only exports`, async ({ page }) => {
    await installProbe(page); await page.goto('/'); await importTone(page, rate, frequency);
    await expect(page.getByRole('status')).toContainText('Detected', { timeout: 20000 });
    await expect(page.getByLabel('Pitch (MIDI)')).toHaveValue(String(expectedPitch));
    const project = await backup(page), asset = project.assets[0]; expect(project.assets).toHaveLength(1);
    expect(asset.kind).toBe('audio-file'); expect(asset.captureTempo).toBe(120); expect(asset.frameCount).toBe(33075);
    expect(asset.analyzedFrames).toBe(Math.min(asset.decodedFrames, asset.decodedSampleRate * 20));
    const pcm = pcmFloats(asset), from = Math.round(.3 * 22050), to = Math.round(1 * 22050);
    let energy = 0, analyticEnergy = 0, crossings = 0;
    for (let i = from; i < to; i++) { energy += pcm[i] ** 2; analyticEnergy += (.25 * Math.sin(2 * Math.PI * frequency * i / 22050)) ** 2; if (i > from && pcm[i - 1] < 0 && pcm[i] >= 0) crossings++; }
    expect(Math.abs(crossings / ((to - from) / 22050) - frequency)).toBeLessThanOrEqual(3);
    expect(Math.abs(Math.sqrt(energy / analyticEnergy) - 1)).toBeLessThanOrEqual(.02);
    expect(Math.max(...pcm.slice(0, 1500).map(Math.abs))).toBe(0);
    expect(Math.max(...pcm.slice(-3000).map(Math.abs))).toBe(0);
    const midiEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export MIDI', exact: true }).click();
    const midi = decodeMidi(await bytes(await midiEvent)); expect(midi.tracks.flatMap(t => t.notes).map(n => n.pitch)).toEqual(project.document.composition.tracks.flatMap(t => t.notes).map(n => n.pitch));
    const wavEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export WAV', exact: true }).click();
    const wav = decodeWav(await bytes(await wavEvent)); expect(wav.sampleRate).toBe(22050);
    expect(wav.samples.length).not.toBe(asset.frameCount); // ordinary synthesized note tail, not reference bytes
    await saved(page); const stored = await idb(page); expect(stored.assets[0].digest).toBe(asset.sha256);
    await page.reload(); expect((await backup(page)).assets).toEqual(project.assets);
  });
}

test('fixed-speed reference and capture-tempo notes audition exact windows after current tempo changes', async ({ page }) => {
  await installProbe(page); page.on('dialog', dialog => dialog.accept()); await page.goto('/'); await open(page);
  const original = await backup(page), asset = original.assets[0];
  await page.locator('#tempo').fill('60'); await page.locator('#tempo').press('Tab');
  await expect(page.locator('#reference-summary')).toContainText('120'); await expect(page.locator('#reference-summary')).toContainText('60');
  await page.locator('#reference-start').fill('0.333'); await page.locator('#reference-end').fill('0.8123');
  await page.locator('#play-reference').click(); await expect.poll(async () => (await sources(page)).length).toBe(1);
  const played = (await sources(page))[0], start = Math.round(.333 * 22050), end = Math.round(.8123 * 22050);
  expect(played.sampleRate).toBe(22050); expect(played.samples).toEqual(pcmFloats(asset).slice(start, end));
  // This exact crop is shorter than half a second; sample inspection may outlast it.
  await expect(page.getByRole('button', { name: 'Stop playback' })).toBeDisabled();
  await page.locator('#play-reference-notes').click(); await expect.poll(async () => (await sources(page)).length).toBe(2);
  const notes = (await sources(page))[1]; expect(notes.samples.length).toBe(end - start);
  // The authored note starts at .125 s, ends at .625 s with .08 s release at captured120BPM.
  // At current60 BPM it would still sound until1.33 s; this exact late-window silence proves capture tempo.
  expect(notes.samples.slice(Math.ceil((.71 * 22050) - start)).every(value => value === 0)).toBe(true);
  expect(notes.samples.slice(0, 1000).some(value => Math.abs(value) > .01)).toBe(true);
  await expect(page.getByRole('button', { name: 'Stop playback' })).toBeDisabled();
  const after = await backup(page); expect(after.assets).toEqual(original.assets); expect(after.document.composition.tempo).toBe(60);
  const windowHistory = await idb(page); await page.locator('#reference-start').fill(''); await expect(page.locator('#reference-start')).toHaveValue('');
  if (await page.locator('#play-reference').isEnabled()) await page.locator('#play-reference').click();
  await expect(page.locator('#reference-start')).toHaveValue('');
  expect(await idb(page)).toEqual(windowHistory); expect((await sources(page)).length).toBe(2);
  await page.locator('#muted').check(); await expect(page.locator('#play-reference-notes')).toBeDisabled();
  await expect(page.locator('#play-reference')).toBeEnabled();
});

test('reference duplication shares exact audio and remove/delete/history operations are complete reversible edits', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept()); await page.goto('/'); await open(page);
  const original = await backup(page); await page.getByRole('button', { name: 'Duplicate track', exact: true }).click();
  const shared = await backup(page); expect(shared.document.references).toHaveLength(2); expect(shared.assets).toEqual(original.assets);
  await page.locator('#remove-reference').click(); const removed = await backup(page); expect(removed.document.references).toHaveLength(1); expect(removed.document.composition).toEqual(shared.document.composition);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect((await backup(page)).document.references).toEqual(shared.document.references);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect((await backup(page)).document.references).toEqual(removed.document.references);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await page.getByRole('button', { name: 'Delete track', exact: true }).click();
  expect((await backup(page)).document.references).toHaveLength(1); await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect((await backup(page)).assets).toEqual(original.assets);
  await saved(page);
  const beforeClear = await backup(page), beforeStore = await idb(page); await page.locator('#clear-history').click();
  expect(await backup(page)).toEqual(beforeClear); expect(await idb(page)).toEqual(beforeStore);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
});

test('native opposite-phase and silent captures fail atomically without discarding the existing reference or raw note spelling', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept()); await page.goto('/'); await open(page);
  await page.locator('.note-event').first().click(); await page.getByLabel('Duration (beats)').fill('1.000');
  const before = await backup(page); await importTone(page, 48000, 440, 2, true);
  await expect(page.getByRole('status')).toContainText(/No clear notes/i, { timeout: 20000 });
  expect(await backup(page)).toEqual(before); await expect(page.getByLabel('Duration (beats)')).toHaveValue('1.000');
  await importTone(page, 44100, 440, 1, false, true); await expect(page.getByRole('status')).toContainText(/No clear notes/i);
  expect(await backup(page)).toEqual(before); await expect(page.getByLabel('Duration (beats)')).toHaveValue('1.000');
});

for (const phase of ['decode', 'normalize']) {
  test(`cancelled native ${phase} drain cannot publish a late take or erase raw fields`, async ({ page }) => {
    await installProbe(page); page.on('dialog', dialog => dialog.accept()); await page.goto('/'); await open(page);
    await page.locator('.note-event').first().click(); await page.getByLabel('Duration (beats)').fill('');
    const before = await backup(page); await gate(page, phase); await importTone(page); await held(page, phase);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(page.getByLabel('Duration (beats)')).toHaveValue('');
    await importTone(page); await expect(page.getByRole('status')).toContainText(/drain|finishing|retry|previous|running/i);
    await release(page); await expect(page.getByRole('button', { name: 'Try demo melody', exact: true })).toBeEnabled();
    expect(await backup(page)).toEqual(before); await expect(page.getByLabel('Duration (beats)')).toHaveValue('');
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.locator('#reference-empty')).toBeVisible();
  });
}

test('late audio resume and old source completion cannot start or stop a newer reference audition', async ({ page }) => {
  await installProbe(page); page.on('dialog', dialog => dialog.accept()); await page.goto('/'); await open(page);
  await gate(page, 'resume'); await page.locator('#play-reference').click(); await held(page, 'resume');
  await page.getByRole('button', { name: 'Stop playback' }).click(); await release(page);
  expect((await sources(page)).length).toBe(0);
  await page.locator('#play-reference').click(); await expect.poll(async () => (await sources(page)).length).toBe(1);
  await page.getByRole('button', { name: 'Stop playback' }).click(); await page.locator('#play-reference').click();
  await expect.poll(async () => (await sources(page)).length).toBe(2);
  await page.evaluate(() => (window as unknown as ProbeWindow).__referenceAcceptance.endCallbacks[0]?.());
  await expect(page.getByRole('button', { name: 'Stop playback' })).toBeEnabled();
  await page.getByRole('button', { name: 'Stop playback' }).click();
});

test('complete-file read staging preserves invalid note drafts, input-only intent and exact prior history', async ({ page }) => {
  await installProbe(page); page.on('dialog', dialog => dialog.accept()); await page.goto('/'); await open(page);
  await page.locator('.note-event').first().click(); await expect(page.getByLabel('Pitch (MIDI)')).toBeFocused();
  await page.getByLabel('Duration (beats)').fill('');
  const prior = await backup(page); await gate(page, 'file');
  await page.getByLabel('Open project file').setInputFiles({ name: 'held-complete.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(literalProject(2))) });
  await held(page, 'file'); await page.getByLabel('Track name').fill('Unsent title while reading');
  await release(page); await expect(page.getByLabel('Project title')).toHaveValue(prior.document.composition.title);
  await expect(page.getByLabel('Track name')).toHaveValue('Unsent title while reading'); await expect(page.getByLabel('Duration (beats)')).toHaveValue('');
  expect((await backup(page)).assets).toEqual(prior.assets);
  await page.getByLabel('Open project file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"melody-studio-project","version":7}') });
  await expect(page.getByRole('status')).toContainText(/Could not open|invalid|unsupported/i);
  await expect(page.getByLabel('Duration (beats)')).toHaveValue(''); await expect(page.getByLabel('Track name')).toHaveValue('Unsent title while reading');
  const beforeHide = await backup(page); await saved(page); const stored = await idb(page);
  await gate(page, 'file');
  await page.getByLabel('Open project file').setInputFiles({ name: 'held-complete.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(literalProject(3))) });
  await held(page, 'file'); await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await release(page); await expect(page.getByLabel('Project title')).toHaveValue(beforeHide.document.composition.title);
  await expect(page.getByLabel('Duration (beats)')).toHaveValue('');
  expect(await backup(page)).toEqual(beforeHide); expect(await idb(page)).toEqual(stored);
});

test('a genuine request-success transaction abort preserves the last complete saved project until Retry save', async ({ page }) => {
  await installProbe(page); page.on('dialog', dialog => dialog.accept()); await page.goto('/'); await open(page); await saved(page);
  const old = await idb(page), original = await backup(page);
  await page.locator('.note-event').first().click();
  await page.evaluate(() => { (window as unknown as ProbeWindow).__referenceAcceptance.abortSave = true; });
  await page.getByLabel('Pitch (MIDI)').fill('67'); await page.getByRole('button', { name: 'Apply note', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__referenceAcceptance.aborted)).toBe(1);
  await expect(page.locator('#save-status')).toContainText(/not saved/i); expect(await idb(page)).toEqual(old);
  const unsaved = await backup(page); expect(unsaved.assets).toEqual(original.assets); expect(unsaved.document.composition.tracks[0].notes[0].pitch).toBe(67);
  await page.locator('#retry-save').click(); await saved(page); expect((await idb(page)).assets).toEqual(old.assets);
  await page.reload(); expect((await backup(page)).document.composition.tracks[0].notes[0].pitch).toBe(67);
});

test('corrupt existing native PCM fails closed, preserves stored bytes and supports explicit repair Retry load', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept()); await page.goto('/'); await open(page); await saved(page); const original = await backup(page);
  await page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open(name); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const tx = db.transaction('assets', 'readwrite'), store = tx.objectStore('assets');
    const get = store.getAll(); get.onsuccess = () => { const value = get.result[0]; value.pcm = new Blob([new Uint8Array(value.frameCount * 2)]); store.put(value, value.id); };
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
  }, DB);
  const damaged = await idb(page); expect(damaged.assets[0].digest).not.toBe(damaged.assets[0].declared);
  await page.reload(); await expect(page.locator('#retry-load')).toBeVisible(); expect(await idb(page)).toEqual(damaged);
  await page.getByRole('button', { name: 'Add note', exact: true }).click(); expect(await idb(page)).toEqual(damaged);
  await page.evaluate(async ({ name, asset }) => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open(name); req.onsuccess = () => resolve(req.result); });
    const tx = db.transaction('assets', 'readwrite'); const { pcmBase64, ...metadata } = asset;
    const pcm = Uint8Array.from(atob(pcmBase64), char => char.charCodeAt(0)); tx.objectStore('assets').put({ ...metadata, pcm: new Blob([pcm]) }, asset.id);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
  }, { name: DB, asset: original.assets[0] });
  await page.locator('#retry-load').click(); await expect(page.getByLabel('Project title')).toHaveValue(original.document.composition.title);
  expect((await backup(page)).assets).toEqual(original.assets);
});

test('absent-only legacy migration preserves original raw text and a complete IDB project wins over stale legacy', async ({ page }) => {
  const legacy = literalProject().document.composition; legacy.title = 'Legacy before complete references';
  const raw = JSON.stringify(legacy, null, 2);
  await page.addInitScript(({ key, raw }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, raw); }, { key: LEGACY, raw });
  page.on('dialog', dialog => dialog.accept()); await page.goto('/'); await expect(page.getByLabel('Project title')).toHaveValue(legacy.title);
  expect((await idb(page)).descriptor).toBeUndefined(); expect(await page.evaluate(key => localStorage.getItem(key), LEGACY)).toBe(raw);
  await open(page); await saved(page); const complete = await backup(page); await page.reload();
  expect(await backup(page)).toEqual(complete); expect(await page.evaluate(key => localStorage.getItem(key), LEGACY)).toBe(raw);
});

test('references survive closing and relaunching a real persistent Chromium process', async ({ baseURL }) => {
  if (!baseURL) throw new Error('Reference native tests require a production origin.');
  const profile = await mkdtemp(join(tmpdir(), 'melody66-persistent-'));
  const launchOptions = { headless: true, executablePath: process.env.CHROMIUM_PATH || undefined };
  let context = await chromium.launchPersistentContext(profile, launchOptions);
  try {
    let page = await context.newPage(); page.on('dialog', dialog => dialog.accept()); await page.goto(baseURL); await open(page); await saved(page);
    const original = await backup(page); await context.close(); context = await chromium.launchPersistentContext(profile, launchOptions);
    page = await context.newPage(); await page.goto(baseURL); await expect(page.locator('#reference-summary')).toContainText('120');
    expect(await backup(page)).toEqual(original); const actual = await idb(page); expect(actual.assets[0].digest).toBe(original.assets[0].sha256);
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('bounded audio history rejects a tenth eight-take document without losing current state; explicit clear frees room', async ({ page }) => {
  test.setTimeout(180000); page.on('dialog', dialog => dialog.accept()); await page.goto('/');
  for (let generation = 1; generation <= 9; generation++) await open(page, literalProject(generation, 8, 20));
  const before = await backup(page); expect(before.assets).toHaveLength(8);
  await page.getByLabel('Open project file').setInputFiles({ name: 'overflow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(literalProject(10, 8, 20))) });
  await expect(page.getByRole('status')).toContainText(/history|64 MiB|capacity|budget/i); expect(await backup(page)).toEqual(before);
  await page.locator('#clear-history').click(); await open(page, literalProject(10, 8, 20)); expect((await backup(page)).document.composition.title).toBe('Original reference 10');
});

test('mobile keyboard reference controls retain invalid window and note focus through save completion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); page.on('dialog', dialog => dialog.accept()); await page.goto('/'); await open(page);
  await page.locator('#reference-start').fill(''); await page.locator('#reference-start').focus(); await page.keyboard.press('Tab');
  await expect(page.locator('#reference-end')).toBeFocused(); await page.locator('#reference-end').fill('0.00001');
  if (await page.locator('#play-reference').isEnabled()) await page.locator('#play-reference').press('Enter');
  await expect(page.locator('#reference-start')).toHaveValue('');
  await page.locator('.note-event').first().click(); await page.getByLabel('Duration (beats)').fill('0.7500');
  await page.getByRole('button', { name: 'Apply note', exact: true }).press('Enter'); await saved(page);
  await expect(page.locator('#reference-start')).toHaveValue(''); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('demo and an actual MediaRecorder tone each retain their own audible take in the complete project', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const context = new AudioContext(), oscillator = context.createOscillator(), gain = context.createGain();
      const destination = context.createMediaStreamDestination(); oscillator.frequency.value = 440; gain.gain.value = .25;
      oscillator.connect(gain).connect(destination); oscillator.start(); await context.resume();
      for (const track of destination.stream.getTracks()) {
        const stop = track.stop.bind(track); track.stop = () => { stop(); oscillator.stop(); void context.close().catch(() => {}); };
      }
      return destination.stream;
    } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Try demo melody', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Detected', { timeout: 20000 });
  const demo = await backup(page); expect(demo.assets).toHaveLength(1); expect(demo.assets[0].kind).toBe('demo');
  await page.getByRole('button', { name: 'Record melody', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Finish recording', exact: true })).toBeVisible();
  await page.waitForTimeout(1300); await page.getByRole('button', { name: 'Finish recording', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Detected', { timeout: 20000 });
  const recorded = await backup(page); expect(recorded.assets[0].kind).toBe('microphone');
  expect(recorded.assets[0].frameCount).toBeGreaterThan(22050); expect(recorded.assets[0].sha256).not.toBe(demo.assets[0].sha256);
  expect(pcmFloats(recorded.assets[0]).some(value => Math.abs(value) > .1)).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect((await backup(page)).assets).toEqual(demo.assets);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect((await backup(page)).assets).toEqual(recorded.assets);
});

test('Stop terminates a real held render-worker response without later audio or a document change', async ({ page }) => {
  await installProbe(page); page.on('dialog', dialog => dialog.accept()); await page.goto('/'); await open(page);
  const before = await backup(page); await gate(page, 'worker'); await page.locator('#play-reference-notes').click(); await held(page, 'worker');
  await page.getByRole('button', { name: 'Stop playback' }).click(); await release(page);
  expect((await sources(page)).length).toBe(0); expect(await backup(page)).toEqual(before);
  await page.locator('#play-reference').click(); await expect.poll(async () => (await sources(page)).length).toBe(1);
  await page.getByRole('button', { name: 'Stop playback' }).click();
});

test('declined replacement and failed capture preserve the visible learned proposal and unapplied note spelling', async ({ page }) => {
  await page.goto('/'); const original = literalProject();
  original.document.composition.tracks[0].notes = Array.from({ length: 8 }, (_, index) => ({ id: `proposal-source-${index}`, pitch: [60, 62, 64, 62][index % 4], start: index * .25, duration: .25, velocity: .5 }));
  page.on('dialog', dialog => dialog.accept()); await open(page, original);
  await page.getByRole('button', { name: 'Suggest continuation', exact: true }).click();
  await expect(page.locator('#continuation-proposal')).toBeVisible();
  const proposed = await page.locator('#proposal-notes').textContent(), before = await backup(page);
  await page.locator('.note-event').first().click(); await page.getByLabel('Duration (beats)').fill('0.2500');
  // Note selection itself must not discard an existing proposal; typed scratch is kept.
  const proposalBeforeCapture = await page.locator('#proposal-notes').textContent();
  await importTone(page, 48000, 440, 2, true); await expect(page.getByRole('status')).toContainText(/No clear notes/i);
  await expect(page.getByLabel('Duration (beats)')).toHaveValue('0.2500');
  expect(await page.locator('#proposal-notes').textContent()).toBe(proposalBeforeCapture);
  expect(await backup(page)).toEqual(before); expect(proposed).toBeTruthy();
  page.removeAllListeners('dialog'); page.once('dialog', dialog => dialog.dismiss());
  await page.getByLabel('Open project file').setInputFiles({ name: 'declined.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(literalProject(2))) });
  await expect(page.getByLabel('Project title')).toHaveValue(original.document.composition.title);
  expect(await backup(page)).toEqual(before); await expect(page.getByLabel('Duration (beats)')).toHaveValue('0.2500');
});

test('fifty prior edits trim oldest history while every remaining state retains exact shared reference PCM', async ({ page }) => {
  test.setTimeout(120000); page.on('dialog', dialog => dialog.accept()); await page.goto('/'); await open(page);
  const original = await backup(page);
  for (let i = 1; i <= 51; i++) { await page.getByLabel('Project title').fill(`Authored history edit ${i}`); await page.getByLabel('Project title').press('Tab'); }
  for (let i = 0; i < 50; i++) await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Project title')).toHaveValue('Authored history edit 1'); expect((await backup(page)).assets).toEqual(original.assets);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(page.getByLabel('Project title')).toHaveValue('Authored history edit 2');
});

test('track selection stops only its owning comparison audition and preserves unrelated ordinary playback', async ({ page }) => {
  await installProbe(page); page.on('dialog', dialog => dialog.accept()); await page.goto('/'); await importTone(page);
  await expect(page.getByRole('status')).toContainText('Detected');
  await page.getByRole('button', { name: 'Duplicate track', exact: true }).click();
  await page.locator('#play-reference').click(); await expect.poll(async () => (await sources(page)).length).toBe(1);
  const stops = await page.evaluate(() => (window as unknown as ProbeWindow).__referenceAcceptance.stops);
  await page.locator('[data-track]').first().click();
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__referenceAcceptance.stops)).toBe(stops + 1);
  await expect(page.getByRole('button', { name: 'Stop playback' })).toBeDisabled();
  await page.getByRole('button', { name: 'Play composition' }).click(); await expect.poll(async () => (await sources(page)).length).toBe(2);
  const ordinaryStops = await page.evaluate(() => (window as unknown as ProbeWindow).__referenceAcceptance.stops);
  await page.locator('[data-track]').last().click();
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__referenceAcceptance.stops)).toBe(ordinaryStops);
  await expect(page.getByRole('button', { name: 'Stop playback' })).toBeEnabled();
  await page.getByRole('button', { name: 'Stop playback' }).click();
});

test('Cancel and pagehide cannot unlock editing during a genuine held initial IndexedDB transaction', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept()); await page.goto('/'); await open(page); await saved(page);
  const original = await backup(page), stored = await idb(page);
  await installProbe(page, 'load'); await page.reload(); await held(page, 'load');
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  if (await cancel.isVisible() && await cancel.isEnabled()) await cancel.click();
  await expect(page.getByRole('button', { name: 'Add note', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add track', exact: true })).toBeDisabled();
  // Dispatch only the public lifecycle event; no app/module state is injected.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(page.getByRole('button', { name: 'Add note', exact: true })).toBeDisabled();
  await release(page); await expect(page.getByLabel('Project title')).toHaveValue(original.document.composition.title);
  expect(await backup(page)).toEqual(original); expect(await idb(page)).toEqual(stored);
});


test('genuine held write transactions coalesce later complete edits and never mark an older generation Saved', async ({ page }) => {
  await installProbe(page); page.on('dialog', dialog => dialog.accept()); await page.goto('/'); await open(page); await saved(page);
  const original = await backup(page);
  const priorPuts = await page.evaluate(() => (window as unknown as ProbeWindow).__referenceAcceptance.projectPuts.length);
  await gate(page, 'save');
  const rename = async (title: string) => { await page.getByLabel('Project title').fill(title); await page.getByLabel('Project title').press('Tab'); };
  await rename('Pending complete edit one'); await held(page, 'save');
  await rename('Pending complete edit two'); await rename('Pending complete edit three');
  expect((await backup(page)).document.composition.title).toBe('Pending complete edit three');
  await expect(page.locator('#save-status')).not.toHaveText('Saved in this browser');
  await release(page); await held(page, 'save-next');
  await expect(page.locator('#save-status')).not.toHaveText('Saved in this browser');
  expect(await page.evaluate(offset => (window as unknown as ProbeWindow).__referenceAcceptance.projectPuts.slice(offset), priorPuts))
    .toEqual(['Pending complete edit one', 'Pending complete edit three']);
  await release(page); await saved(page);
  const final = await backup(page), persisted = await idb(page);
  expect(final.assets).toEqual(original.assets); expect(final.document.composition.title).toBe('Pending complete edit three');
  expect(persisted.descriptor?.document).toEqual(final.document);
  expect(persisted.assets.map(asset => asset.digest)).toEqual(final.assets.map(asset => asset.sha256));
  await page.reload(); expect(await backup(page)).toEqual(final);
});
