/* global Buffer, console, document, process, window */
/** Independent #125 capacity acceptance. Root owns builds and services.
 * Author this runner and freeze expectations before reading product practice
 * source or observing its runtime. No producer parser/controller is imported.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, open, readFile, stat, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, URL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {performance} from 'node:perf_hooks';
import {chromium, expect} from '@playwright/test';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = fileURLToPath(import.meta.url);
const PYTHON = process.env.KARAOKE_PYTHON || 'python3';
const runFile = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = ms => `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
const escaped = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const srtBytes = cues => Buffer.from(cues.map((cue, i) => `${i + 1}\n${stamp(Math.floor(cue.start * 1000 + .5))} --> ${stamp(Math.floor(cue.end * 1000 + .5))}\n${escaped(cue.text)}\n`).join('\n'));

function fixtureDefinition() {
  const cues = Array.from({length: 200}, (_, index) => {
    let text = `  Practice ${String(index + 1).padStart(3, '0')} café 🦉\n<literal> &amp;\nOriginal words retained\nFinal singing line  `;
    assert([...text].length <= 100);
    text += ' '.repeat(100 - [...text].length);
    return {start: index * 1.5, end: index * 1.5 + 1.5, text};
  });
  return {
    schemaVersion: 1, status: 'frozen-before-execution',
    projects: [{schemaVersion: 1, id: '7'.repeat(32), title: 'Original practice capacity',
      duration: 300, revision: 7, cues}],
    range: {first: 198, last: 199, start: 297, end: 300, duration: 3},
    expected: {cues: 200, lyricCodePoints: 20000, duration: 300, sampleRate: 44100,
      channels: 2, pcmFramesEach: 13230000, wavBytesEach: 52920044, repeatBoundaries: 2},
    tolerances: {boundarySeconds: .150, boundaryObservationGapMs: 150,
      repeatPeriodMs: 150, stoppedDriftSeconds: .001, durationSeconds: 1 / 44100},
    scope: [
      'Full capacity: three original five-minute stereo PCM WAV files and 200 literal cues totaling 20,000 Unicode code points.',
      'Only the final 297..300-second range is played; this is not a second full-song listening or export run.',
      'Two actual end-of-song repeat boundaries at native playbackRate 1, plus Play once, Pause/Resume, Stop and track switching.',
      'Read-only requestAnimationFrame and native media event observations; no currentTime, playbackRate, play, pause or media-clock replacement by the runner.',
      '150 ms boundary, observation-gap and repeat-period limits are frozen, with no fitted offsets or post-observation widening.',
      'Exact saved metadata, all original WAV bytes, complete SRT and complete archive remain unchanged; reopening uses a fresh browser process.',
      'No inference, separation-quality, physical-device, audible-output, worst-case memory, full 300-second playback or new video-export claim.',
      'Builds, library service startup and shutdown belong to root; this runner never starts, stops or signals a service.',
    ],
  };
}

async function fileFacts(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return {bytes: (await stat(path)).size, sha256: digest.digest('hex')};
}

async function exactFiles(left, right) {
  assert.equal((await stat(left)).size, (await stat(right)).size);
  const a = await open(left, 'r'), b = await open(right, 'r');
  try {
    const first = Buffer.alloc(1024 * 1024), second = Buffer.alloc(first.length);
    let position = 0;
    while (true) {
      const x = await a.read(first, 0, first.length, position);
      const y = await b.read(second, 0, second.length, position);
      assert.equal(x.bytesRead, y.bytesRead);
      assert(first.subarray(0, x.bytesRead).equals(second.subarray(0, y.bytesRead)),
        `Original file bytes changed at or after byte ${position}.`);
      if (!x.bytesRead) break;
      position += x.bytesRead;
    }
  } finally { await a.close(); await b.close(); }
}

async function prepare(root) {
  await mkdir(root, {recursive: false});
  const frozen = fixtureDefinition(), project = frozen.projects[0];
  assert.equal(project.cues.length, frozen.expected.cues);
  assert.equal(project.cues.reduce((n, cue) => n + [...cue.text].length, 0), 20000);
  assert.equal(project.cues.at(-1).end, 300);
  const bytes = Buffer.from(JSON.stringify(frozen, null, 2) + '\n');
  await writeFile(join(root, 'frozen-expectations.json'), bytes, {flag: 'wx'});
  await runFile(PYTHON, ['tests/srt_smoke_server.py', '--seed', root],
    {cwd: APP, timeout: 60000, maxBuffer: 65536});
  const audio = JSON.parse(await readFile(join(root, 'audio-facts.json'), 'utf8'));
  for (const facts of Object.values(audio[project.id])) {
    assert.equal(facts.bytes, frozen.expected.wavBytesEach);
    assert.equal(facts.frames, frozen.expected.pcmFramesEach);
  }
  const metadata = await fileFacts(join(root, 'library', 'projects', project.id, 'project.json'));
  const receipt = {status: 'fixtures-frozen-not-run', fixtureSha256: hash(bytes),
    runnerSha256: hash(await readFile(SCRIPT)),
    seedHelperSha256: hash(await readFile(join(APP, 'tests/srt_smoke_server.py'))),
    originalAudio: audio, originalMetadata: metadata, expected: frozen.expected,
    tolerances: frozen.tolerances, scope: frozen.scope};
  await writeFile(join(root, 'fixture-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({status: receipt.status, root, fixtureSha256: receipt.fixtureSha256,
    runnerSha256: receipt.runnerSha256, expected: receipt.expected}));
}

async function readFixture(root) {
  const bytes = await readFile(join(root, 'frozen-expectations.json'));
  const receipt = JSON.parse(await readFile(join(root, 'fixture-receipt.json'), 'utf8'));
  assert.equal(hash(bytes), receipt.fixtureSha256);
  const frozen = JSON.parse(bytes);
  assert.deepEqual(frozen, fixtureDefinition(), 'Frozen independent expectations changed.');
  assert.equal(hash(await readFile(SCRIPT)), receipt.runnerSha256,
    'Runner changed after fixture freeze. Preserve prior attempt and prepare a new fixture explicitly.');
  assert.equal(hash(await readFile(join(APP, 'tests/srt_smoke_server.py'))), receipt.seedHelperSha256);
  return {frozen, receipt};
}

function originValue() {
  assert(process.env.KARAOKE_PRACTICE_ORIGIN, 'Set KARAOKE_PRACTICE_ORIGIN to the root-owned production service.');
  const url = new URL(process.env.KARAOKE_PRACTICE_ORIGIN);
  assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.href, url.origin + '/'); assert(url.port);
  return url.origin;
}

async function launch(report, origin, observe = false) {
  const browser = await chromium.launch({headless: true,
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  try {
    report.browserVersion = browser.version();
    const cdp = await browser.newBrowserCDPSession();
    report.browserProcesses.push(...(await cdp.send('SystemInfo.getProcessInfo')).processInfo
      .filter(item => item.type === 'browser').map(item => item.id));
    await cdp.detach();
    const context = await browser.newContext({acceptDownloads: true, viewport: {width: 1280, height: 960}});
    if (observe) await context.addInitScript(() => {
      const receipt = window.practiceMaximum = {phase: 'opening', samples: [], events: [], actions: [], overflow: false};
      const snapshot = kind => {
        const audio = document.querySelector('#audio');
        if (!audio) return null;
        return {kind, phase: receipt.phase, wall: performance.now(), time: audio.currentTime,
          paused: audio.paused, ended: audio.ended, seeking: audio.seeking,
          rate: audio.playbackRate, loop: audio.loop, ready: audio.readyState,
          source: audio.currentSrc, error: audio.error?.code ?? null};
      };
      const add = (target, item) => {
        if (!item) return;
        if (target.length >= 20000) receipt.overflow = true;
        else target.push(item);
      };
      const tick = () => {
        if (receipt.phase !== 'opening' && receipt.phase !== 'idle') add(receipt.samples, snapshot('raf'));
        window.requestAnimationFrame(tick);
      };
      window.requestAnimationFrame(tick);
      for (const kind of ['play', 'playing', 'pause', 'ended', 'seeking', 'seeked', 'timeupdate', 'ratechange', 'error']) {
        document.addEventListener(kind, event => {
          if (event.target.id === 'audio') add(receipt.events, snapshot(kind));
        }, true);
      }
      document.addEventListener('click', event => {
        const control = event.target.closest?.('[id^="practice-"], [data-track]');
        if (control) add(receipt.actions, {...snapshot('click'), id: control.id,
          track: control.dataset.track ?? null, trusted: event.isTrusted,
          disabled: Boolean(control.disabled), label: control.textContent.trim()});
      }, true);
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('request', request => {
      if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin)
        report.externalRequests.push(request.url());
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
        report.mutatingRequests.push({method: request.method(), pathname: new URL(request.url()).pathname});
    });
    return {browser, page};
  } catch (error) { await browser.close(); throw error; }
}

async function openProject(page, origin, project) {
  await page.goto(`${origin}/?project=${project.id}`);
  await expect(page.getByLabel('Clip title', {exact: true})).toHaveValue(project.title);
  await expect(page.getByLabel('Lyric line 200', {exact: true})).toHaveValue(project.cues[199].text);
  await page.waitForFunction(() => {
    const audio = document.querySelector('#audio');
    return audio && audio.readyState >= 2 && !audio.error && !audio.seeking &&
      audio.currentSrc && Math.abs(audio.duration - 300) <= 1 / 44100;
  }, undefined, {timeout: 30000});
  await expect(page.locator('#practice-first')).toHaveValue('0');
  await expect(page.locator('#practice-last')).toHaveValue('0');
  const cues = await page.locator('#cue-list .cue').evaluateAll(rows => rows.map(row => ({
    text: row.querySelector('textarea').value,
    start: Number(row.querySelector('input[data-boundary="start"]').value),
    end: Number(row.querySelector('input[data-boundary="end"]').value),
  })));
  assert.deepEqual(cues, project.cues, 'Reopened editor omitted or changed a capacity cue.');
}

const media = page => page.locator('#audio').evaluate(audio => ({time: audio.currentTime,
  paused: audio.paused, ended: audio.ended, rate: audio.playbackRate, source: audio.currentSrc}));
async function editor(page) {
  return {title: await page.getByLabel('Clip title', {exact: true}).inputValue(),
    paste: await page.getByLabel('Paste lyrics, one line per cue', {exact: true}).inputValue(),
    fields: await page.locator('#cue-list .cue input, #cue-list .cue textarea').evaluateAll(inputs => inputs.map(input => ({
      tag: input.tagName, label: input.getAttribute('aria-label'), boundary: input.dataset.boundary ?? null, value: input.value}))),
    undoDisabled: await page.getByRole('button', {name: 'Undo lyric edit', exact: true}).isDisabled(),
    redoDisabled: await page.getByRole('button', {name: 'Redo lyric edit', exact: true}).isDisabled()};
}
const phase = (page, value) => page.evaluate(value => { window.practiceMaximum.phase = value; }, value);
const observation = page => page.evaluate(() => window.practiceMaximum);

async function keyboardClick(page, id) {
  const button = page.locator(`#${id}`);
  await expect(button).toBeVisible(); await expect(button).toBeEnabled();
  await button.focus(); await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
}

async function range(page, first, last) {
  await page.locator('#practice-first').selectOption(String(first));
  await page.locator('#practice-last').selectOption(String(last));
  await expect(page.locator('#practice-first')).toHaveValue(String(first));
  await expect(page.locator('#practice-last')).toHaveValue(String(last));
}

async function stablePaused(page, tolerance) {
  await page.waitForFunction(() => document.querySelector('#audio').paused);
  const before = await media(page);
  await page.waitForTimeout(250);
  const after = await media(page);
  assert(after.paused && before.paused); assert.equal(after.rate, 1);
  assert(Math.abs(after.time - before.time) <= tolerance, 'Paused native media time drifted.');
  return {before, after};
}

function boundaries(observed, label) {
  const samples = observed.samples.filter(item => item.phase === label), result = [];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1].time - samples[i].time > 1)
      result.push({before: samples[i - 1], after: samples[i]});
  }
  return result;
}

async function inspectPlayback(page, frozen, report) {
  const {range: target, tolerances: limit} = frozen;
  const beforeEditor = await editor(page);
  assert.equal(beforeEditor.fields.length, 600);
  await range(page, target.last, target.first);
  await expect(page.locator('#practice-once')).toBeDisabled();
  await expect(page.locator('#practice-repeat')).toBeDisabled();
  const invalid = await stablePaused(page, limit.stoppedDriftSeconds);
  assert((await page.locator('#practice-status').textContent()).trim().length > 0);
  report.invalidRange = {first: target.last, last: target.first, refused: true, ...invalid};
  await range(page, target.first, target.last);
  await expect(page.locator('#practice-once')).toBeEnabled();
  await expect(page.locator('#practice-repeat')).toBeEnabled();
  assert((await page.locator('#practice-range-summary').textContent()).trim().length > 0);
  assert((await media(page)).paused, 'Selection change started playback.');

  await phase(page, 'two-end-boundaries');
  await keyboardClick(page, 'practice-repeat');
  await page.waitForFunction(() => {
    const audio = document.querySelector('#audio');
    return !audio.paused && audio.currentTime >= 297 && audio.currentTime < 298;
  });
  await page.waitForFunction(() => {
    const samples = window.practiceMaximum.samples.filter(item => item.phase === 'two-end-boundaries');
    let count = 0;
    for (let i = 1; i < samples.length; i++) if (samples[i - 1].time - samples[i].time > 1) count++;
    return count >= 2;
  }, undefined, {polling: 'raf', timeout: 12000});
  await keyboardClick(page, 'practice-stop');
  report.repeatStop = await stablePaused(page, limit.stoppedDriftSeconds);
  const repeated = await observation(page), loops = boundaries(repeated, 'two-end-boundaries');
  report.repeatBoundaries = loops;
  assert(loops.length >= frozen.expected.repeatBoundaries);
  for (const loop of loops) {
    assert(loop.before.time >= target.end - limit.boundarySeconds && loop.before.time <= target.end);
    assert(loop.after.time >= target.start && loop.after.time <= target.start + limit.boundarySeconds);
    assert(loop.after.wall - loop.before.wall <= limit.boundaryObservationGapMs);
  }
  const repeatPeriod = loops[1].after.wall - loops[0].after.wall;
  report.repeatPeriodMs = repeatPeriod;
  assert(Math.abs(repeatPeriod - target.duration * 1000) <= limit.repeatPeriodMs,
    `Native repeat period ${repeatPeriod} ms exceeded frozen 3000 ± 150 ms.`);
  const active = repeated.samples.filter(item => item.phase === 'two-end-boundaries' && !item.paused);
  assert(active.length >= 30);
  assert(active.at(-1).wall - active[0].wall >= target.duration * 2000 - 2 * limit.repeatPeriodMs,
    'Two actual normal-speed final-range traversals were not observed.');

  await phase(page, 'pause-resume');
  await keyboardClick(page, 'practice-repeat');
  await page.waitForFunction(() => {
    const audio = document.querySelector('#audio');
    return !audio.paused && audio.currentTime >= 297.4 && audio.currentTime < 298.5;
  });
  await expect(page.locator('#practice-pause')).toHaveText('Pause practice');
  await keyboardClick(page, 'practice-pause');
  await expect(page.locator('#practice-pause')).toHaveText('Resume practice');
  report.pause = await stablePaused(page, limit.stoppedDriftSeconds);
  await keyboardClick(page, 'practice-pause');
  await page.waitForFunction(time => {
    const audio = document.querySelector('#audio');
    return !audio.paused && audio.currentTime >= time + .2;
  }, report.pause.after.time);
  report.resumed = await media(page);
  assert(report.resumed.time < target.end);
  await keyboardClick(page, 'practice-stop');
  report.explicitStop = await stablePaused(page, limit.stoppedDriftSeconds);
  assert(report.explicitStop.after.time >= report.resumed.time && report.explicitStop.after.time < target.end);
  const stopAction = (await observation(page)).actions.filter(item => item.id === 'practice-stop').at(-1);
  assert(Math.abs(report.explicitStop.after.time - stopAction.time) <= limit.boundarySeconds,
    'Stop changed the native position instead of retaining it.');

  report.trackSwitches = [];
  for (const role of ['vocals', 'backing', 'original']) {
    await phase(page, `switch-to-${role}`);
    await keyboardClick(page, 'practice-repeat');
    await page.waitForFunction(() => !document.querySelector('#audio').paused);
    const button = page.locator(`[data-track="${role}"]`);
    await expect(button).toBeEnabled(); await button.click();
    await page.waitForFunction(role => {
      const audio = document.querySelector('#audio');
      return audio.currentSrc.endsWith(`/audio/${role}`) && audio.readyState >= 2 &&
        !audio.seeking && !audio.error;
    }, role, {timeout: 30000});
    report.trackSwitches.push({role, ...await stablePaused(page, limit.stoppedDriftSeconds)});
  }

  await page.setViewportSize({width: 390, height: 844});
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    '390 px viewport has horizontal overflow.');
  await phase(page, 'mobile-once');
  await range(page, target.first, target.last);
  await keyboardClick(page, 'practice-once');
  await page.waitForFunction(() => !document.querySelector('#audio').paused);
  await page.waitForFunction(() => {
    const audio = document.querySelector('#audio');
    return audio.paused && audio.currentTime >= 299.85;
  }, undefined, {polling: 'raf', timeout: 6000});
  report.once = await stablePaused(page, limit.stoppedDriftSeconds);
  assert(Math.abs(report.once.after.time - target.end) <= limit.boundarySeconds);
  await phase(page, 'idle');
  report.observations = await observation(page);
  assert.equal(report.observations.overflow, false);
  const onceSamples = report.observations.samples.filter(item => item.phase === 'mobile-once');
  const onceActive = onceSamples.filter(item => !item.paused);
  assert(onceActive.length >= 20);
  assert(onceActive.at(-1).time >= target.end - limit.boundarySeconds);
  assert.equal(boundaries(report.observations, 'mobile-once').length, 0);
  for (const item of [...report.observations.samples, ...report.observations.events]) {
    assert.equal(item.rate, 1); assert.equal(item.loop, false); assert.equal(item.error, null);
  }
  for (const action of report.observations.actions) assert(action.trusted && !action.disabled);
  assert.deepEqual(await editor(page), beforeEditor, 'Practice changed editor raw values.');
  report.editorUnchanged = true;
  report.savedMutationRequestsDuringPractice = report.mutatingRequests.slice();
  assert.deepEqual(report.savedMutationRequestsDuringPractice, [], 'Practice issued a mutating request.');
}

async function artifact(report, out, name) {
  const facts = await fileFacts(join(out, name));
  report.artifacts.push({name, ...facts}); return facts;
}

async function download(page, locator, path) {
  await expect(locator).toBeVisible(); await expect(locator).toBeEnabled();
  const pending = page.waitForEvent('download', {timeout: 120000});
  await locator.click();
  const item = await pending; await item.saveAs(path); assert.equal(await item.failure(), null);
}

async function exportsAt(page, out, prefix, project, report) {
  await download(page, page.getByRole('button', {name: 'Export timed lyrics', exact: true}), join(out, `${prefix}.srt`));
  assert((await readFile(join(out, `${prefix}.srt`))).equals(srtBytes(project.cues)));
  await artifact(report, out, `${prefix}.srt`);
  await page.locator('#archive-backup').click();
  const link = page.getByRole('link', {name: 'Download saved archive', exact: true});
  await expect(link).toBeVisible({timeout: 60000});
  await download(page, link, join(out, `${prefix}.karaoke.zip`));
  await artifact(report, out, `${prefix}.karaoke.zip`);
}

async function savedFacts(page, origin, project, library, expectedAudio, report, label) {
  const response = await page.request.get(`${origin}/api/projects/${project.id}`);
  assert.equal(response.status(), 200);
  const metadata = await response.body(); assert.deepEqual(JSON.parse(metadata), project);
  await response.dispose();
  const directory = join(library, 'projects', project.id);
  const disk = await readFile(join(directory, 'project.json'));
  assert.deepEqual(JSON.parse(disk), project);
  const facts = {label, response: {bytes: metadata.length, sha256: hash(metadata)},
    disk: {bytes: disk.length, sha256: hash(disk)}, audio: {}};
  for (const [role, name] of [['original', 'source.wav'], ['vocals', 'vocals.wav'], ['backing', 'backing.wav']]) {
    const expected = expectedAudio[project.id][name];
    const local = await fileFacts(join(directory, name));
    assert.deepEqual(local, {bytes: expected.bytes, sha256: expected.sha256});
    const served = await page.request.get(`${origin}/api/projects/${project.id}/audio/${role}`, {timeout: 60000});
    assert.equal(served.status(), 200);
    const bytes = await served.body();
    assert.equal(bytes.length, expected.bytes); assert.equal(hash(bytes), expected.sha256);
    await served.dispose(); facts.audio[name] = local;
  }
  report.savedChecks.push(facts); return facts;
}

async function capture(root, out) {
  const {frozen, receipt} = await readFixture(root), project = frozen.projects[0], origin = originValue();
  assert(process.env.KARAOKE_PRACTICE_LIBRARY, 'Set KARAOKE_PRACTICE_LIBRARY to the actual root-owned served library.');
  const library = resolve(process.env.KARAOKE_PRACTICE_LIBRARY);
  assert((await stat(library)).isDirectory());
  assert.deepEqual(await fileFacts(join(root, 'library', 'projects', project.id, 'project.json')), receipt.originalMetadata);
  await mkdir(out, {recursive: false});
  const report = {schemaVersion: 1, status: 'running', startedAt: new Date().toISOString(), origin, library,
    fixtureSha256: receipt.fixtureSha256, runnerSha256: receipt.runnerSha256,
    expected: frozen.expected, tolerances: frozen.tolerances, scope: frozen.scope,
    browserProcesses: [], pageErrors: [], externalRequests: [], mutatingRequests: [],
    artifacts: [], savedChecks: []};
  const save = () => writeFile(join(out, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  const started = performance.now(); let browser, page;
  try {
    ({browser, page} = await launch(report, origin, true));
    await openProject(page, origin, project);
    await page.locator('[data-track="original"]').click();
    await page.waitForFunction(() => {
      const audio = document.querySelector('#audio');
      return audio.currentSrc.endsWith('/audio/original') && audio.readyState >= 2 && !audio.seeking;
    });
    const before = await savedFacts(page, origin, project, library, receipt.originalAudio, report, 'before');
    assert.deepEqual(before.disk, receipt.originalMetadata);
    await exportsAt(page, out, 'before', project, report);
    await writeFile(join(out, 'archive-expectations.json'), JSON.stringify({expected: [project]}) + '\n');
    const archive = await runFile(PYTHON, ['tests/srt_smoke_server.py', '--inspect-archive',
      join(out, 'before.karaoke.zip'), '--expectations', join(out, 'archive-expectations.json'),
      '--audio-facts', join(root, 'audio-facts.json')], {cwd: APP, timeout: 60000, maxBuffer: 1048576});
    report.archive = JSON.parse(archive.stdout);
    // Archive creation is intentionally outside the no-mutation playback phase.
    report.exportRequestsBeforePractice = report.mutatingRequests.splice(0);
    await inspectPlayback(page, frozen, report);
    await page.locator('#practice-once').scrollIntoViewIfNeeded();
    await page.screenshot({path: join(out, 'mobile-390.png'), fullPage: false});
    await artifact(report, out, 'mobile-390.png');
    await page.setViewportSize({width: 1280, height: 960});
    await page.locator('#practice-once').scrollIntoViewIfNeeded();
    await page.screenshot({path: join(out, 'desktop.png'), fullPage: false});
    await artifact(report, out, 'desktop.png');
    const after = await savedFacts(page, origin, project, library, receipt.originalAudio, report, 'after');
    assert.deepEqual({...after, label: 'before'}, before);
    await save();
    await browser.close(); browser = undefined;
    report.firstBrowserClosed = true;

    ({browser, page} = await launch(report, origin));
    assert(new Set(report.browserProcesses).size >= 2, 'Fresh process was not observed.');
    await openProject(page, origin, project);
    assert((await media(page)).paused, 'Fresh browser unexpectedly resumed transient practice.');
    const reopened = await savedFacts(page, origin, project, library, receipt.originalAudio, report, 'fresh-browser');
    assert.deepEqual({...reopened, label: 'before'}, before);
    await exportsAt(page, out, 'after', project, report);
    await exactFiles(join(out, 'before.srt'), join(out, 'after.srt'));
    await exactFiles(join(out, 'before.karaoke.zip'), join(out, 'after.karaoke.zip'));
    // Byte-for-byte archive equality extends the independent first-archive
    // member/CRC/project/audio validation to the fresh-browser download.
    report.archiveAndSrtByteExact = true;
    for (const [name, expected] of Object.entries(receipt.originalAudio[project.id])) {
      assert.deepEqual(await fileFacts(join(root, 'library', 'projects', project.id, name)),
        {bytes: expected.bytes, sha256: expected.sha256});
    }
    try { await stat(join(library, 'INFERENCE-WAS-CALLED')); assert.fail('Unexpected inference attempt.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
    report.status = 'passed'; report.wallMs = performance.now() - started;
  } catch (error) {
    report.status = 'failed'; report.failure = {message: error.message, stack: error.stack};
    if (page && !page.isClosed()) {
      try { report.failureObservations = await observation(page); } catch { /* Keep the original failure. */ }
    }
    throw error;
  } finally {
    await browser?.close(); report.browserClosed = true; await save();
  }
  console.log(JSON.stringify({status: report.status, out, wallMs: report.wallMs,
    repeatBoundaries: report.repeatBoundaries.length, repeatPeriodMs: report.repeatPeriodMs,
    archiveAndSrtByteExact: report.archiveAndSrtByteExact}));
}

async function main() {
  assert(process.env.KARAOKE_PRACTICE_FIXTURES, 'Set KARAOKE_PRACTICE_FIXTURES to a new isolated directory.');
  const root = resolve(process.env.KARAOKE_PRACTICE_FIXTURES);
  if (process.argv.includes('--prepare')) return prepare(root);
  assert(process.argv.includes('--capture'), 'Choose --prepare or --capture.');
  assert(process.env.KARAOKE_PRACTICE_OUTPUT, 'Set KARAOKE_PRACTICE_OUTPUT to a new isolated directory.');
  return capture(root, resolve(process.env.KARAOKE_PRACTICE_OUTPUT));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
