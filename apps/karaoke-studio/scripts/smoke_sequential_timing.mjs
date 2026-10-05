/* global Buffer, console, process, document, window */
/** Independent #115 maximum fixture and actual-playback acceptance.
 * The root-controlled service is deliberately external: this runner never
 * starts, stops or kills a service, invokes separation, or builds the app.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile, stat} from 'node:fs/promises';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath, URL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {performance} from 'node:perf_hooks';
import {chromium, expect} from '@playwright/test';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PYTHON = process.env.KARAOKE_PYTHON || 'python3';
const runFile = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const FIXTURE_VERSION = 1;
const stamp = ms => `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
const escaped = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const expectedSrt = cues => Buffer.from(cues.map((cue, index) => `${index + 1}\n${stamp(Math.floor(cue.start * 1000 + .5))} --> ${stamp(Math.floor(cue.end * 1000 + .5))}\n${escaped(cue.text)}\n`).join('\n'));

function originalFixture() {
  const cues = Array.from({length: 200}, (_, index) => {
    // Five explicit short lines fit the independent 44 px glyph oracle.
    // Deliberate spaces, Unicode and literal markup remain editable source.
    let text = `  Line ${String(index + 1).padStart(3, '0')} café 🦉  \n<literal> &amp;\nSpacing retained\nFirst short stanza\nClosing words  `;
    assert([...text].length <= 100);
    text += ' '.repeat(100 - [...text].length);
    assert.equal([...text].length, 100);
    return {start: index * 1.5, end: index * 1.5 + 1, text};
  });
  const project = {
    schemaVersion: 1, id: '5'.repeat(32), title: 'Original sequential timing maximum',
    duration: 300, revision: 3, cues,
  };
  const targetMarks = cues.flatMap((_, index) => [
    {line: index + 1, action: 'start', target: index * 1.5 + .125},
    ...(index === 199 ? [] : [{line: index + 1, action: 'end', target: index * 1.5 + .875}]),
  ]);
  return {
    schemaVersion: FIXTURE_VERSION, status: 'fixtures-frozen', projects: [project],
    targetMarks, finalEnd: {line: 200, action: 'end-final', time: 300},
    tolerances: {markVsNativeEventSeconds: .020, schedulingLateSeconds: .150,
      projectDurationSeconds: 1 / 44100, videoPtsSeconds: .00001,
      videoDurationSeconds: 1 / 24 + .03, aacPaddingMaxFrames: 1024},
    expected: {cues: 200, lyricCodePoints: 20000, duration: 300, wavFrames: 13230000,
      wavBytesEach: 52920044, videoFrames: 7200, videoFps: 24,
      videoDimensions: [1280, 720], codecs: ['h264', 'aac']},
    scope: [
      'Actual five-minute 1x native audio playback, not an injected media clock or seek.',
      'Original periodic synthetic source/vocals/backing WAVs; no inference or separation-quality claim.',
      'Targets schedule deliberate actions; expected saved times come from read-only trusted-event media receipts.',
      '24 fps video and nearest-millisecond SRT export are distinct from unrounded native cue times.',
      'No physical-device, subjective vocal alignment, worst-case decode/RAM or human-perception claim.',
      'The service and its restart are owned by the operator, never this runner.',
    ],
  };
}

async function freezeFixtures(root) {
  await mkdir(root, {recursive: false});
  const frozen = originalFixture();
  assert.equal(frozen.projects[0].cues.reduce((n, cue) => n + [...cue.text].length, 0), 20000);
  const bytes = Buffer.from(JSON.stringify(frozen, null, 2) + '\n');
  await writeFile(join(root, 'frozen-expectations.json'), bytes, {flag: 'wx'});
  // This existing independent helper generates all three complete PCM files;
  // its service mode forbids inference, and is invoked separately by root.
  await runFile(PYTHON, ['tests/srt_smoke_server.py', '--seed', root],
    {cwd: APP, timeout: 60000, maxBuffer: 65536});
  const facts = JSON.parse(await readFile(join(root, 'audio-facts.json'), 'utf8'));
  for (const value of Object.values(facts[frozen.projects[0].id])) {
    assert.equal(value.bytes, frozen.expected.wavBytesEach);
    assert.equal(value.frames, frozen.expected.wavFrames);
  }
  const receipt = {status: 'fixtures-frozen-not-run', fixtureVersion: FIXTURE_VERSION,
    fixtureSha256: hash(bytes), source: 'original deterministic PCM and literal texts',
    originalAudio: facts, expected: frozen.expected, tolerances: frozen.tolerances,
    generatorSha256: hash(await readFile(fileURLToPath(import.meta.url))),
    seedHelperSha256: hash(await readFile(join(APP, 'tests/srt_smoke_server.py')))};
  await writeFile(join(root, 'fixture-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({status: receipt.status, root, fixtureSha256: receipt.fixtureSha256,
    expected: frozen.expected}));
}

async function readFixture(root) {
  const bytes = await readFile(join(root, 'frozen-expectations.json'));
  const receipt = JSON.parse(await readFile(join(root, 'fixture-receipt.json'), 'utf8'));
  assert.equal(hash(bytes), receipt.fixtureSha256, 'Frozen fixture bytes changed.');
  const frozen = JSON.parse(bytes);
  assert.deepEqual(frozen, originalFixture(), 'Original independent fixture expectations changed.');
  return {frozen, receipt};
}

const MEDIA_INSPECTOR = String.raw`
import array, hashlib, importlib.util, json, math, pathlib, subprocess, sys, threading, time
app, video_path, project_path = map(pathlib.Path, sys.argv[1:4])
project = json.loads(project_path.read_text(encoding='utf-8'))
spec = importlib.util.spec_from_file_location('independent_archive_oracle', app / 'scripts' / 'smoke_archive.py')
oracle = importlib.util.module_from_spec(spec); spec.loader.exec_module(oracle)
run = oracle.bounded_tool
started = time.monotonic()
metadata = json.loads(run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(video_path)],262144))
assert len(metadata['streams']) == 2
video = next(s for s in metadata['streams'] if s['codec_type']=='video')
audio = next(s for s in metadata['streams'] if s['codec_type']=='audio')
assert (video['codec_name'],video['width'],video['height'],video['r_frame_rate'],int(video['nb_frames'])) == ('h264',1280,720,'24/1',7200)
assert (audio['codec_name'],int(audio['sample_rate']),audio['channels']) == ('aac',44100,2)
assert abs(float(metadata['format']['duration'])-300) <= 1/24+.03
# ffprobe actually decodes every video frame; compare every represented PTS.
frames = json.loads(run(['ffprobe','-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',str(video_path)],1048576,timeout=240))['frames']
pts = [float(f['best_effort_timestamp_time']) for f in frames]
assert len(pts)==7200
assert all(abs(t-i/24)<.00001 for i,t in enumerate(pts))
# Independent complete video+audio decode to null, not header-only admission.
run(['ffmpeg','-v','error','-xerror','-err_detect','explode','-threads','1','-i',str(video_path),'-map','0:v:0','-map','0:a:0','-f','null','-'],65536,timeout=240)
# Stream the entire decoded PCM; never retain a five-minute decoded buffer.
command = ['ffmpeg','-v','error','-xerror','-err_detect','explode','-threads','1','-i',str(video_path),'-vn','-ac','2','-ar','44100','-f','s16le','pipe:1']
child = subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
timer=threading.Timer(240,child.kill); timer.daemon=True; timer.start()
count=0; peak=0; pcm_sha=hashlib.sha256()
try:
 while True:
  block=child.stdout.read(65536)
  if not block: break
  count+=len(block); assert count <= (13230000+1024)*4
  pcm_sha.update(block); values=array.array('h'); values.frombytes(block)
  if sys.byteorder!='little': values.byteswap()
  peak=max(peak,max((abs(v) for v in values),default=0))
 assert child.wait(timeout=10)==0
finally:
 timer.cancel()
 child.stdout.close()
 if child.poll() is None: child.kill(); child.wait()
assert count%4==0 and 13230000 <= count//4 <= 13230000+1024 and peak>500
cues=project['cues']; samples={0,7199}
for index in (0,99,199):
 cue=cues[index]
 samples.add(min(7199,math.ceil(cue['start']*24)))
 samples.add(max(0,math.ceil(cue['start']*24)-1))
 samples.add(min(7199,math.floor((cue['start']+cue['end'])*12)))
 if index<199:
  samples.add(min(7199,math.ceil(cue['end']*24)))
  samples.add(max(0,math.ceil(cue['end']*24)-1))
samples=sorted(samples)
select='select='+ '+'.join('eq(n\\,%s)'%i for i in samples)
raw=run(['ffmpeg','-v','error','-threads','1','-filter_threads','1','-i',str(video_path),'-vf',select,'-vsync','0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],len(samples)*1280*720*3,timeout=240)
assert len(raw)==len(samples)*1280*720*3
references={}; checked=[]
for position,index in enumerate(samples):
 time_at=index/24
 active=next((c for c in cues if c['start'] <= time_at < c['end']),None)
 text=active['text'] if active else 'Instrumental break'
 color=(228,183,125) if active else (247,245,237)
 key=(text,color)
 if key not in references: references[key]=oracle.glyph_reference(text,color)
 frame=memoryview(raw)[position*1280*720*3:(position+1)*1280*720*3]
 good=oracle.glyph_facts(frame,references[key]); assert good['passed'],(index,good)
 wrongkey=('Unrelated control text',color)
 if wrongkey not in references: references[wrongkey]=oracle.glyph_reference(*wrongkey)
 assert not oracle.glyph_facts(frame,references[wrongkey])['passed']
 checked.append({'frame':index,'time':time_at,'active':bool(active),'cue':cues.index(active)+1 if active else None,'glyphs':good,'wrongTextRejected':True})
tail=array.array('h'); tail.frombytes(run(['ffmpeg','-v','error','-threads','1','-ss','299.25','-i',str(video_path),'-t','0.5','-vn','-ac','2','-ar','44100','-f','s16le','pipe:1'],44100*4))
assert len(tail)>=40000 and max(abs(v) for v in tail)>500
print(json.dumps({'status':'passed','frames':7200,'fullDecodeCompleted':True,'pcmFrames':count//4,'pcmSha256':pcm_sha.hexdigest(),'pcmPeak':peak,'samples':checked,'lateAudioNonSilent':True,'wallSeconds':time.monotonic()-started,'fontSha256':oracle.digest(app/'assets'/'DejaVuSans.ttf')}))
`;

function originFromEnvironment() {
  assert(process.env.KARAOKE_TIMING_ORIGIN, 'Root must provide KARAOKE_TIMING_ORIGIN.');
  const url = new URL(process.env.KARAOKE_TIMING_ORIGIN);
  assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.href, url.origin + '/'); assert(url.port);
  return url.origin;
}

async function serviceIdentity() {
  assert(process.env.KARAOKE_TIMING_LIBRARY, 'Root must provide the actual served KARAOKE_TIMING_LIBRARY directory.');
  const library = resolve(process.env.KARAOKE_TIMING_LIBRARY);
  assert((await stat(library)).isDirectory());
  const pid = Number(process.env.KARAOKE_TIMING_SERVICE_PID);
  assert(Number.isSafeInteger(pid) && pid > 0, 'Provide the root-owned KARAOKE_TIMING_SERVICE_PID for restart evidence.');
  // Linux process observation only. No signal, child lifecycle or service
  // control occurs here. Omit argv from public receipts and logs.
  const command = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
  const serve = command.indexOf('--serve');
  assert(serve >= 0 && resolve(command[serve + 1]) === library,
    'The supplied PID must be the actual root-owned fixture service.');
  const value = await readFile(`/proc/${pid}/stat`, 'utf8');
  const startTicks = value.slice(value.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
  assert(/^\d+$/.test(startTicks));
  try { await stat(join(library, 'INFERENCE-WAS-CALLED')); assert.fail('Fixture service unexpectedly invoked inference.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return {pid, startTicks, library};
}

async function sourceHashes() {
  const result = {};
  for (const name of ['scripts/smoke_sequential_timing.mjs', 'tests/srt_smoke_server.py',
    'scripts/smoke_archive.py', 'assets/DejaVuSans.ttf']) result[name] = hash(await readFile(join(APP, name)));
  return result;
}

async function launchBrowser(out, report, origin, observeMarks) {
  const context = await chromium.launchPersistentContext(join(out, 'browser-profile'), {
    headless: true, acceptDownloads: true, viewport: {width: 1280, height: 960},
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}),
  });
  try {
    report.browserVersion = context.browser().version();
    const cdp = await context.browser().newBrowserCDPSession();
    report.browserProcesses.push(...(await cdp.send('SystemInfo.getProcessInfo')).processInfo
      .filter(item => item.type === 'browser').map(item => item.id));
    await cdp.detach();
    if (observeMarks) await context.addInitScript(() => {
      // Observation only: original handlers, media properties and clocks are
      // never replaced. Capturing and bubbling observations bracket a real
      // native event on the same JavaScript dispatch.
      window.timingMaximumReceipts = [];
      let pending;
      window.addEventListener('click', event => {
        const button = event.target.closest?.('#timing-mark, #timing-end-final');
        if (!button) return;
        const audio = document.querySelector('#audio');
        pending = {action: button.id === 'timing-end-final' ? 'end-final' : button.textContent.trim() === 'Mark line start' ? 'start' : 'end',
          label: button.textContent.trim(), enabled: !button.disabled,
          hidden: button.hidden, trusted: event.isTrusted,
          before: audio.currentTime, paused: audio.paused,
          ended: audio.ended, rate: audio.playbackRate, loop: audio.loop,
          source: audio.currentSrc, wall: performance.now()};
      }, true);
      window.addEventListener('click', () => {
        if (!pending) return;
        pending.after = document.querySelector('#audio').currentTime;
        window.timingMaximumReceipts.push(pending); pending = undefined;
      });
    });
    const page = context.pages()[0] || await context.newPage();
    page.on('dialog', dialog => dialog.accept());
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('request', request => {
      if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin)
        report.externalRequests.push(request.url());
    });
    return {context, page};
  } catch (error) { await context.close(); throw error; }
}

async function savedProject(page, origin, id) {
  const response = await page.request.get(`${origin}/api/projects/${id}`);
  assert.equal(response.status(), 200); return response.json();
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
}

async function cueDom(page) {
  return page.locator('#cue-list .cue').evaluateAll(rows => rows.map(row => ({
    text: row.querySelector('textarea').value,
    start: Number(row.querySelector('input[data-boundary="start"]').value),
    end: Number(row.querySelector('input[data-boundary="end"]').value),
  })));
}

async function artifact(report, out, name) {
  const bytes = await readFile(join(out, name));
  const item = {name, bytes: bytes.length, sha256: hash(bytes)};
  report.artifacts.push(item); return bytes;
}

async function nativeDownload(page, locator, path) {
  const pending = page.waitForEvent('download', {timeout: 300000});
  await locator.click(); const download = await pending; await download.saveAs(path);
  assert.equal(await download.failure(), null);
}

async function verifyAudio(page, origin, fixtureRoot, fixture, report) {
  const facts = JSON.parse(await readFile(join(fixtureRoot, 'audio-facts.json'), 'utf8'));
  const result = {};
  for (const [role, name] of [['original', 'source.wav'], ['vocals', 'vocals.wav'], ['backing', 'backing.wav']]) {
    // Both served bytes and original files must remain unchanged. Complete
    // response reads here are bounded by the frozen ~50.5 MiB WAV extent.
    const response = await page.request.get(`${origin}/api/projects/${fixture.id}/audio/${role}`, {timeout: 60000});
    assert.equal(response.status(), 200);
    const bytes = await response.body(), expected = facts[fixture.id][name];
    assert.equal(bytes.length, expected.bytes); assert.equal(hash(bytes), expected.sha256);
    const local = await readFile(join(fixtureRoot, 'library', 'projects', fixture.id, name));
    assert.equal(local.length, expected.bytes); assert.equal(hash(local), expected.sha256);
    const stored = await readFile(join(report.services[0].library, 'projects', fixture.id, name));
    assert.equal(stored.length, expected.bytes); assert.equal(hash(stored), expected.sha256);
    result[name] = {bytes: expected.bytes, sha256: expected.sha256};
    await response.dispose();
  }
  report.audioChecks.push(result);
}

async function capture(fixtureRoot, out) {
  const {frozen, receipt} = await readFixture(fixtureRoot), original = frozen.projects[0];
  const origin = originFromEnvironment();
  const identity = await serviceIdentity();
  await mkdir(out, {recursive: false});
  const report = {schemaVersion: 1, status: 'running-capture', origin,
    fixtureSha256: receipt.fixtureSha256, sourceHashes: await sourceHashes(),
    services: [identity], browserProcesses: [], pageErrors: [], externalRequests: [], artifacts: [], audioChecks: [],
    checks: [], scope: frozen.scope, tolerances: frozen.tolerances};
  const save = () => writeFile(join(out, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  const started = performance.now(); let context;
  try {
    const launched = await launchBrowser(out, report, origin, true); context = launched.context;
    const page = launched.page;
    await openProject(page, origin, original); assert.deepEqual(await savedProject(page, origin, original.id), original);
    await verifyAudio(page, origin, fixtureRoot, original, report);
    // Genuine independent draft history: raw spelling and an unapplied paste
    // survive one cues-only Apply/Undo/Redo. No paste splitting supplies input.
    const pasted = '  These unapplied words must remain 🦉\nSecond untouched line  ';
    await page.getByLabel('Start line 1', {exact: true}).fill('0e0');
    await page.getByLabel('Paste lyrics, one line per cue', {exact: true}).fill(pasted);
    await page.locator('#timing-begin').click();
    await expect(page.locator('#timing-mark')).toHaveText('Mark line start');
    const box = await page.locator('#audio').boundingBox(); assert(box);
    // The trusted click targets Chromium's native media Play control. No
    // production play hook or script-origin currentTime/playbackRate write.
    await page.locator('#audio').click({position: {x: 25, y: box.height / 2}});
    await page.waitForFunction(() => !document.querySelector('#audio').paused, undefined, {timeout: 5000});
    report.listenStartedWallMs = performance.now();
    for (const item of frozen.targetMarks) {
      report.currentPlannedTarget = item;
      // Do actionability/scroll/hit testing during the deliberate preceding
      // gap, not on the media-clock deadline. The final action is still a
      // native trusted mouse click with actual state captured on dispatch.
      const mark = page.locator('#timing-mark');
      const expectedLabel = item.action === 'start' ? 'Mark line start' : 'Mark line end';
      await expect(mark).toHaveText(expectedLabel);
      await expect(mark).toBeEnabled();
      await mark.scrollIntoViewIfNeeded();
      const point = await mark.evaluate(button => {
        const box = button.getBoundingClientRect();
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        return {x, y, label: button.textContent.trim(), enabled: !button.disabled,
          hidden: button.hidden, hit: button.contains(document.elementFromPoint(x, y))};
      });
      assert.equal(point.label, expectedLabel); assert(point.enabled && !point.hidden && point.hit);
      await page.mouse.move(point.x, point.y);
      await page.waitForFunction(target => document.querySelector('#audio').currentTime >= target,
        item.target, {polling: 'raf', timeout: 6000});
      await page.mouse.click(point.x, point.y);
      const observations = await page.evaluate(() => window.timingMaximumReceipts);
      const previousCount = report.markReceipts?.length ?? 0;
      // Preserve even a failed dispatched event and its planned target. The
      // finally receipt must never silently omit the event being diagnosed.
      report.markReceipts = observations;
      const observed = observations.at(-1);
      assert.equal(observations.length, previousCount + 1);
      assert.equal(observed.action, item.action); assert(observed.trusted);
      assert.equal(observed.label, expectedLabel); assert(observed.enabled && !observed.hidden);
      assert.equal(observed.paused, false); assert.equal(observed.ended, false);
      assert.equal(observed.rate, 1); assert.equal(observed.loop, false);
      assert(observed.before >= item.target &&
        observed.before <= item.target + frozen.tolerances.schedulingLateSeconds,
        `Scheduling threshold failed: line=${item.line} action=${item.action} before=${observed.before} target=${item.target} latenessMs=${((observed.before - item.target) * 1000).toFixed(3)} limitMs=150.`);
      assert(observed.after >= observed.before);
      if (item.line % 20 === 0 && item.action === 'end') {
        await save(); console.log(JSON.stringify({status: 'listening', completedLines: item.line,
          mediaSeconds: observed.after}));
      }
    }
    report.currentPlannedTarget = frozen.finalEnd;
    await expect(page.locator('#timing-end-final')).toBeVisible({timeout: 6000});
    assert.equal(await page.locator('#audio').evaluate(audio => audio.ended), true);
    await page.locator('#timing-end-final').click();
    report.markReceipts = await page.evaluate(() => window.timingMaximumReceipts);
    assert.equal(report.markReceipts.length, 400);
    assert.equal(report.markReceipts[399].action, 'end-final'); assert(report.markReceipts[399].trusted);
    assert.equal(report.markReceipts[399].ended, true);
    report.actualListeningWallMs = performance.now() - report.listenStartedWallMs;
    assert(report.actualListeningWallMs >= 299000, 'Five-minute playback was not observed.');
    await expect(page.locator('#timing-review')).toBeVisible();
    const reviewText = await page.locator('#timing-review-list').textContent();
    for (const cue of original.cues) assert(reviewText.includes(cue.text), 'Review omitted literal source text.');
    assert.deepEqual(await savedProject(page, origin, original.id), original, 'Transient capture must not save.');
    await page.locator('#timing-apply').click();
    const cues = await cueDom(page); assert.equal(cues.length, 200);
    for (const [index, cue] of cues.entries()) {
      assert.equal(cue.text, original.cues[index].text);
      const start = report.markReceipts[index * 2], end = report.markReceipts[index * 2 + 1];
      for (const [number, observation] of [[cue.start, start], [cue.end, end]]) {
        if (observation.action === 'end-final') assert.equal(number, 300);
        else assert(Math.abs(number - observation.before) <= .020 && Math.abs(number - observation.after) <= .020,
          `Saved boundary is not its observed native time on line ${index + 1}.`);
      }
      assert(cue.end > cue.start);
      if (index) assert(cue.start > cues[index - 1].end, 'Deliberate instrumental gap disappeared.');
    }
    assert(cues.some(cue => Math.abs(cue.start * 1000 - Math.round(cue.start * 1000)) > 1e-6),
      'Captured values were unexpectedly all quantized to milliseconds.');
    report.expectedSaved = {...original, revision: original.revision + 1, cues};
    await writeFile(join(out, 'captured-project.json'), JSON.stringify(report.expectedSaved, null, 2) + '\n');
    await page.getByRole('button', {name: 'Undo lyric edit', exact: true}).click();
    assert.deepEqual(await cueDom(page), original.cues);
    await expect(page.getByLabel('Start line 1', {exact: true})).toHaveValue('0e0');
    await expect(page.getByLabel('Paste lyrics, one line per cue', {exact: true})).toHaveValue(pasted);
    await page.getByRole('button', {name: 'Redo lyric edit', exact: true}).click();
    assert.deepEqual(await cueDom(page), cues);
    await expect(page.getByLabel('Paste lyrics, one line per cue', {exact: true})).toHaveValue(pasted);
    await expect(page.getByLabel('Clip title', {exact: true})).toHaveValue(original.title);
    assert.deepEqual(await savedProject(page, origin, original.id), original);
    await page.locator('#discard-draft').click();
    await page.getByRole('button', {name: 'Save lyrics', exact: true}).click();
    await expect.poll(() => savedProject(page, origin, original.id)).toEqual(report.expectedSaved);
    report.checks.push('Full 200-line/20,000-code-point actual native capture, explicit final End, one Undo/Redo and manual Save.');
    await nativeDownload(page, page.getByRole('button', {name: 'Export timed lyrics', exact: true}), join(out, 'captured.srt'));
    assert((await artifact(report, out, 'captured.srt')).equals(expectedSrt(cues)));
    await page.locator('#archive-backup').click();
    const archiveLink = page.getByRole('link', {name: 'Download saved archive', exact: true});
    await expect(archiveLink).toBeVisible({timeout: 60000});
    await nativeDownload(page, archiveLink, join(out, 'captured.karaoke.zip'));
    await artifact(report, out, 'captured.karaoke.zip');
    await writeFile(join(out, 'archive-expectations.json'), JSON.stringify({expected: [report.expectedSaved]}) + '\n');
    const archiveResult = await runFile(PYTHON, ['tests/srt_smoke_server.py', '--inspect-archive',
      join(out, 'captured.karaoke.zip'), '--expectations', join(out, 'archive-expectations.json'),
      '--audio-facts', join(fixtureRoot, 'audio-facts.json')], {cwd: APP, timeout: 60000, maxBuffer: 1048576});
    report.archive = JSON.parse(archiveResult.stdout);
    const encodeStarted = performance.now();
    await nativeDownload(page, page.getByRole('button', {name: 'Export karaoke MP4', exact: true}), join(out, 'captured-300s.mp4'));
    report.actualExportDownloadWallMs = performance.now() - encodeStarted;
    await artifact(report, out, 'captured-300s.mp4');
    const videoResult = await runFile(PYTHON, ['-c', MEDIA_INSPECTOR, APP, join(out, 'captured-300s.mp4'),
      join(out, 'captured-project.json')], {cwd: APP, timeout: 600000, maxBuffer: 1048576});
    report.video = JSON.parse(videoResult.stdout);
    await verifyAudio(page, origin, fixtureRoot, original, report);
    await page.screenshot({path: join(out, 'desktop.png'), fullPage: true});
    await page.setViewportSize({width: 390, height: 844});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({path: join(out, 'mobile-390.png'), fullPage: true});
    for (const name of ['desktop.png', 'mobile-390.png']) await artifact(report, out, name);
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
    report.status = 'capture-passed-awaiting-operator-service-restart';
    report.captureWallMs = performance.now() - started;
  } catch (error) { report.status = 'failed'; report.failure = {message: error.message, stack: error.stack}; throw error; }
  finally { await context?.close(); report.captureBrowserClosed = true; await save(); }
  console.log(JSON.stringify({status: report.status, out, wallMs: report.captureWallMs,
    next: 'Root gracefully restarts its own service on the same origin, then invokes --verify-restart.'}));
}

async function verifyRestart(fixtureRoot, out) {
  const {frozen, receipt} = await readFixture(fixtureRoot), origin = originFromEnvironment();
  const report = JSON.parse(await readFile(join(out, 'verification.json'), 'utf8'));
  const identity = await serviceIdentity();
  assert.equal(report.status, 'capture-passed-awaiting-operator-service-restart');
  assert.equal(report.origin, origin, 'A genuine same-origin service restart is required.');
  assert.equal(report.fixtureSha256, receipt.fixtureSha256);
  assert.equal(identity.library, report.services[0].library);
  assert(identity.pid !== report.services[0].pid || identity.startTicks !== report.services[0].startTicks,
    'The same service process is still running; root must complete its actual restart first.');
  report.services.push(identity);
  for (const item of report.artifacts) {
    const bytes = await readFile(join(out, item.name)); assert.equal(bytes.length, item.bytes); assert.equal(hash(bytes), item.sha256);
  }
  const started = performance.now(); let context;
  try {
    const launched = await launchBrowser(out, report, origin, false); context = launched.context;
    const page = launched.page;
    assert(report.browserProcesses.length >= 2 && new Set(report.browserProcesses).size >= 2,
      'A distinct actual browser process was not observed.');
    await openProject(page, origin, report.expectedSaved);
    assert.deepEqual(await savedProject(page, origin, frozen.projects[0].id), report.expectedSaved);
    assert.deepEqual(await cueDom(page), report.expectedSaved.cues);
    await nativeDownload(page, page.getByRole('button', {name: 'Export timed lyrics', exact: true}), join(out, 'restart.srt'));
    const srt = await artifact(report, out, 'restart.srt');
    assert(srt.equals(await readFile(join(out, 'captured.srt')))); assert(srt.equals(expectedSrt(report.expectedSaved.cues)));
    await verifyAudio(page, origin, fixtureRoot, frozen.projects[0], report);
    const disk = JSON.parse(await readFile(join(identity.library, 'projects', frozen.projects[0].id, 'project.json'), 'utf8'));
    assert.deepEqual(disk, report.expectedSaved);
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
    report.checks.push('Operator service restart plus a distinct full Chromium process preserve exact saved cues/revision, SRT, and all three original WAV hashes.');
    report.status = 'passed'; report.restartWallMs = performance.now() - started;
  } catch (error) { report.status = 'restart-failed'; report.failure = {message: error.message, stack: error.stack}; throw error; }
  finally { await context?.close(); report.restartBrowserClosed = true;
    await writeFile(join(out, 'verification.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify({status: report.status, out, videoFrames: report.video.frames,
    actualListeningWallMs: report.actualListeningWallMs, exportDownloadWallMs: report.actualExportDownloadWallMs}));
}

async function main() {
  const root = resolve(process.env.KARAOKE_TIMING_FIXTURES || '/workspace/karaoke115-maximum-fixtures');
  if (process.argv.includes('--fixtures-only')) return freezeFixtures(root);
  assert(process.env.KARAOKE_TIMING_OUTPUT, 'Set KARAOKE_TIMING_OUTPUT to a new workspace directory.');
  const out = resolve(process.env.KARAOKE_TIMING_OUTPUT);
  if (process.argv.includes('--capture')) return capture(root, out);
  assert(process.argv.includes('--verify-restart'), 'Choose --fixtures-only, --capture or --verify-restart.');
  return verifyRestart(root, out);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
