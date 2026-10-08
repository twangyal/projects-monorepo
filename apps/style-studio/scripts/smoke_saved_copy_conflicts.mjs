/* global Buffer, console, process, window, document, indexedDB, structuredClone */
/** Independent #116 whole-profile capacity/CAS acceptance.
 * No producer validator, storage class, image exporter or preference-model
 * implementation supplies expected records or pixels. The server is external.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath, URL} from 'node:url';
import {promisify} from 'node:util';
import {performance} from 'node:perf_hooks';
import {chromium, expect} from '@playwright/test';

const PYTHON = process.env.STYLE_CONFLICT_PYTHON || 'python3';
const runFile = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const id = n => n.toString(16).padStart(32, '0');
const canonical = project => Buffer.from(JSON.stringify(project));
const pad = (text, length) => text + 'x'.repeat(length - text.length);
const oneHot = [0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const otherHot = [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0];
const outfitFeatures = [1 / 3, 1 / 3, 1 / 3, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0];

function originalPlan() {
  const firstColors = [[232, 32, 40], [28, 74, 220], [32, 186, 78]];
  const images = Array.from({length: 20}, (_, index) => {
    const base = firstColors[index] || [32 + (index * 37) % 192, 32 + (index * 71) % 192, 32 + (index * 97) % 192];
    const colors = [base, [base[1], base[2], base[0]], [base[2], base[0], base[1]], base.map(v => 255 - v)];
    return {id: id(1000 + index), file: `photo-${String(index).padStart(2, '0')}.jpg`,
      width: 720, height: 720, bytes: 204800, colors};
  });
  return {schemaVersion: 1, issue: 116, images,
    alternate: {...images[0], file: 'photo-00-alternate.jpg', colors: [...images[0].colors].reverse()},
    samples: [[120, 120], [600, 120], [120, 600], [600, 600]],
    board: {width: 1200, height: 1000, x: [101, 465, 829], y: 272, side: 270,
      sourceSide: 720, rgbTolerance: 12, white: [255, 255, 255], card: [244, 241, 235]},
    expected: {pieces: 36, piecesPerCategory: 12, examples: 80, looks: 30, photos: 20,
      totalJpegBytes: 4096000, rawFileBytes: 8388608, overflowFileBytes: 8388609,
      historyBytes: 25165824, historySnapshots: 20},
    differences: ['B retains all IDs, title and counts; changes actual photo 0 pixels, existing example 0 rating, look 0 name/notes.',
      'C retains B photo bytes and counts; changes existing example 1 rating and look 1 notes.',
      'Local candidate retains A photos/snapshots and changes existing saved look 29 rating in place.'],
    limits: ['Exact 200 KiB JPEG capacity uses harmless declared COM padding before SOS; image patterns are simple original RGB quadrants, not worst-case compressed photographic complexity.',
      'Exact 8 MiB input uses trailing JSON whitespace; complete canonical supported content is measured, not claimed to fill 8 MiB.',
      'No trained parameters, subjective taste accuracy, inference speed, peak memory or physical-device claim.',
      'The runner only owns its own browser processes; it never builds, starts or stops the externally provided server.']};
}

const IMAGE_GENERATOR = String.raw`
import hashlib, io, json, pathlib, struct, sys
from PIL import Image, ImageDraw, __version__ as pillow_version
root=pathlib.Path(sys.argv[1]); plan=json.loads((root/'original-plan.json').read_text())
facts=[]
for item in [*plan['images'],plan['alternate']]:
 image=Image.new('RGB',(720,720)); draw=ImageDraw.Draw(image)
 for box,color in zip([(0,0,359,359),(360,0,719,359),(0,360,359,719),(360,360,719,719)],item['colors']): draw.rectangle(box,fill=tuple(color))
 output=io.BytesIO(); image.save(output,format='JPEG',quality=95,subsampling=0,optimize=False,progressive=False)
 base=output.getvalue(); assert base[:2]==b'\xff\xd8' and base[-2:]==b'\xff\xd9'
 remaining=item['bytes']-len(base); assert remaining>=4
 parts=[]
 while remaining:
  size=min(remaining,65537)
  if 0<remaining-size<4: size-=4
  assert size>=4
  payload=(b'ORIGINAL_CAPACITY_PADDING_'*((size-4)//26+2))[:size-4]
  assert len(payload)==size-4
  parts.append(b'\xff\xfe'+struct.pack('>H',size-2)+payload); remaining-=size
 jpeg=base[:2]+b''.join(parts)+base[2:]; assert len(jpeg)==204800
 path=root/item['file']; path.write_bytes(jpeg)
 with Image.open(io.BytesIO(jpeg)) as decoded:
  decoded.load(); assert decoded.size==(720,720) and decoded.mode=='RGB'
  samples=[list(decoded.getpixel(tuple(point))) for point in plan['samples']]
  for pixel,color in zip(samples,item['colors']): assert max(abs(a-b) for a,b in zip(pixel,color))<=12
 facts.append({'file':item['file'],'sha256':hashlib.sha256(jpeg).hexdigest(),'bytes':len(jpeg),'compressedBeforePaddingBytes':len(base),'declaredPaddingBytes':len(jpeg)-len(base),'samples':samples})
assert len({f['sha256'] for f in facts})==21
(root/'image-facts.json').write_text(json.dumps({'pillowVersion':pillow_version,'images':facts},indent=2)+'\n')
print(json.dumps({'generatedDistinctDecodableJpegs':len(facts),'bytesEach':204800,'pillowVersion':pillow_version}))
`;

async function makeProfile(root, plan, alternate = false) {
  const photos = [];
  for (const [index, image] of plan.images.entries()) {
    const bytes = await readFile(join(root, alternate && index === 0 ? plan.alternate.file : image.file));
    photos.push({id: image.id, mime: 'image/jpeg', width: 720, height: 720,
      dataUrl: 'data:image/jpeg;base64,' + bytes.toString('base64')});
  }
  const categories = ['top', 'bottom', 'shoes'];
  const pieces = [];
  // Category-leading pieces use photos 0/1/2 for the literal board oracle.
  let nextPhoto = 3;
  for (const [categoryIndex, category] of categories.entries()) {
    for (let index = 0; index < 12; index++) {
      const photoIndex = index === 0 ? categoryIndex : nextPhoto < 20 ? nextPhoto++ : null;
      pieces.push({id: id(1 + categoryIndex * 12 + index), name: pad(`Original ${category} ${String(index).padStart(2, '0')} `, 80),
        category, tags: {palette: ['warm', 'cool', 'neutral'][categoryIndex], fit: 'regular', style: 'classic', formality: 'smart'},
        photoId: photoIndex === null ? null : photos[photoIndex].id});
    }
  }
  const looks = Array.from({length: 30}, (_, index) => ({id: id(3000 + index),
    name: pad(`Original saved look ${String(index).padStart(2, '0')} `, 80),
    notes: pad(`Original notes ${String(index).padStart(2, '0')}: spacing retained.\nSecond explicit line. `, 500),
    pieces: [pieces[index % 12], pieces[12 + (index * 5) % 12], pieces[24 + (index * 7) % 12]].map(piece => structuredClone(piece))}));
  const examples = Array.from({length: 50}, (_, index) => ({id: id(2000 + index),
    caption: pad(`Original tagged opinion ${String(index).padStart(2, '0')} `, 160),
    label: index % 2 ? 'pass' : 'like', origin: 'tagged',
    features: [...(index % 2 ? otherHot : oneHot)], photoId: photos[index % 20].id, sourceLookId: null}));
  examples.push(...looks.map((look, index) => ({id: id(2050 + index), caption: look.name,
    label: index % 2 ? 'pass' : 'like', origin: 'outfit', features: [...outfitFeatures], photoId: null, sourceLookId: look.id})));
  const project = {schemaVersion: 1, title: 'Original maximum style 00', pieces, examples, looks, photos};
  if (alternate) {
    project.examples[0].label = 'pass';
    project.looks[0].name = pad('Foreign winner saved look zero ', 80);
    project.looks[0].notes = pad('Foreign winner exact notes zero.\n', 500);
  }
  return project;
}

async function freezeFixtures(root) {
  await mkdir(root, {recursive: false});
  const plan = originalPlan();
  await writeFile(join(root, 'original-plan.json'), JSON.stringify(plan, null, 2) + '\n', {flag: 'wx'});
  const generated = await runFile(PYTHON, ['-c', IMAGE_GENERATOR, root], {timeout: 60000, maxBuffer: 65536});
  const A = await makeProfile(root, plan), B = await makeProfile(root, plan, true);
  const C = structuredClone(B); C.examples[1].label = 'like'; C.looks[1].notes = pad('Newer foreign winner notes one.\n', 500);
  const local = structuredClone(A); local.examples[79].label = 'like';
  const files = [];
  for (const [name, project] of [['profile-A.json', A], ['profile-B.json', B], ['profile-C.json', C], ['profile-local.json', local]]) {
    const bytes = canonical(project);
    assert(bytes.length < 8388608);
    await writeFile(join(root, name), bytes, {flag: 'wx'});
    files.push({name, bytes: bytes.length, sha256: hash(bytes)});
  }
  const bytes = canonical(A), max = Buffer.concat([bytes, Buffer.alloc(8388608 - bytes.length, 32)]);
  const rawFiles = [['profile-exact-8MiB.json', max], ['profile-plus-one.json', Buffer.concat([max, Buffer.from(' ')])]];
  for (const [name, data] of rawFiles) {
    await writeFile(join(root, name), data, {flag: 'wx'}); files.push({name, bytes: data.length, sha256: hash(data)});
  }
  const imageFactsBytes = await readFile(join(root, 'image-facts.json'));
  const receipt = {schemaVersion: 1, status: 'fixtures-frozen-not-run', planSha256: hash(await readFile(join(root, 'original-plan.json'))),
    imageFactsSha256: hash(imageFactsBytes), files, images: JSON.parse(imageFactsBytes),
    expected: plan.expected, measuredCanonicalBytes: bytes.length,
    rawWhitespacePaddingBytes: max.length - bytes.length,
    expectedRetainedFullHistorySnapshots: Math.min(20, Math.floor(25165824 / canonical(local).length)),
    generatorSha256: hash(await readFile(fileURLToPath(import.meta.url))), limitations: plan.limits};
  assert.equal(receipt.expectedRetainedFullHistorySnapshots, 4);
  await writeFile(join(root, 'fixture-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({status: receipt.status, root, canonicalBytes: bytes.length,
    rawWhitespacePaddingBytes: receipt.rawWhitespacePaddingBytes, jpegGeneration: JSON.parse(generated.stdout)}));
}

async function readFixtures(root) {
  const receipt = JSON.parse(await readFile(join(root, 'fixture-receipt.json'), 'utf8'));
  const planBytes = await readFile(join(root, 'original-plan.json'));
  assert.equal(hash(planBytes), receipt.planSha256); assert.deepEqual(JSON.parse(planBytes), originalPlan());
  const photoFacts = await readFile(join(root, 'image-facts.json'));
  assert.equal(hash(photoFacts), receipt.imageFactsSha256);
  for (const file of [...receipt.files, ...receipt.images.images]) {
    const data = await readFile(join(root, file.name || file.file));
    assert.equal(data.length, file.bytes); assert.equal(hash(data), file.sha256);
  }
  const projects = {};
  for (const name of ['A', 'B', 'C', 'local']) projects[name] = JSON.parse(await readFile(join(root, `profile-${name}.json`), 'utf8'));
  assert.deepEqual(projects.A, await makeProfile(root, originalPlan()));
  assert.deepEqual(projects.B, await makeProfile(root, originalPlan(), true));
  const expectedC = structuredClone(projects.B); expectedC.examples[1].label = 'like'; expectedC.looks[1].notes = pad('Newer foreign winner notes one.\n', 500);
  const expectedLocal = structuredClone(projects.A); expectedLocal.examples[79].label = 'like';
  assert.deepEqual(projects.C, expectedC); assert.deepEqual(projects.local, expectedLocal);
  return {plan: originalPlan(), receipt, projects};
}

const BOARD_INSPECTOR = String.raw`
import hashlib,json,pathlib,sys
from PIL import Image
root,path,variant=pathlib.Path(sys.argv[1]),pathlib.Path(sys.argv[2]),sys.argv[3]
plan=json.loads((root/'original-plan.json').read_text()); board=plan['board']
with Image.open(path) as image:
 image.load(); assert image.format=='PNG' and image.size==(1200,1000)
 rgba=image.convert('RGBA'); assert rgba.getpixel((5,5))==(255,255,255,255)
 samples=[]
 for card in range(3):
  colors=plan['alternate']['colors'] if card==0 and variant=='B' else plan['images'][card]['colors']
  assert rgba.getpixel((64+364*card+2,704))==(244,241,235,255)
  for source,color in zip(plan['samples'],colors):
   x=board['x'][card]+int(source[0]*270/720); y=272+int(source[1]*270/720)
   pixel=rgba.getpixel((x,y)); assert pixel[3]==255
   assert max(abs(a-b) for a,b in zip(pixel[:3],color))<=12,(card,source,pixel,color)
   samples.append({'card':card,'source':source,'board':[x,y],'rgb':list(pixel[:3]),'expectedOriginalRgb':color})
 wrong=plan['alternate']['colors'][0] if variant=='A' else plan['images'][0]['colors'][0]
 actual=rgba.getpixel((146,317))[:3]
 assert max(abs(a-b) for a,b in zip(actual,wrong))>12
print(json.dumps({'status':'passed','format':'PNG','width':1200,'height':1000,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'samples':samples,'wrongPhotoRejected':True,'rgbaSha256':hashlib.sha256(rgba.tobytes()).hexdigest()}))
`;

function suppliedOrigin() {
  assert(process.env.STYLE_CONFLICT_ORIGIN, 'Root must provide STYLE_CONFLICT_ORIGIN.');
  const url = new URL(process.env.STYLE_CONFLICT_ORIGIN);
  assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1');
  assert(url.port); assert.equal(url.href, url.origin + '/'); return url.origin;
}

async function rawStored(page) {
  // Real native readonly inspection, not a replacement store/fake transaction.
  // No application module or private expected-receipt state is imported.
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('style-studio');
    request.onupgradeneeded = () => { request.transaction.abort(); reject(Error('Expected an existing actual database.')); };
    request.onerror = () => reject(Error('Native read failed.'));
    request.onsuccess = () => {
      const database = request.result;
      if (database.version !== 2 || !database.objectStoreNames.contains('profiles')) {
        database.close(); reject(Error('Expected genuine version 2 profiles database.')); return;
      }
      const tx = database.transaction('profiles', 'readonly'), store = tx.objectStore('profiles');
      const keyRequest = store.getKey('current'), valueRequest = store.get('current');
      let key, value;
      keyRequest.onsuccess = () => { key = keyRequest.result; };
      valueRequest.onsuccess = () => { value = valueRequest.result; };
      tx.oncomplete = () => { database.close(); resolve({present: key !== undefined, value}); };
      tx.onabort = tx.onerror = () => { database.close(); reject(Error('Native readonly transaction failed.')); };
    };
  }));
}

async function durable(page, expected) {
  let snapshot;
  await expect.poll(async () => {
    snapshot = await rawStored(page);
    return snapshot.present && snapshot.value?.schemaVersion === 2 &&
      JSON.stringify(snapshot.value.project) === JSON.stringify(expected);
  }, {timeout: 20000, intervals: [50, 100, 250]}).toBe(true);
  assert.deepEqual(Object.keys(snapshot.value).sort(), ['project', 'revision', 'schemaVersion']);
  assert.match(snapshot.value.revision, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  return snapshot.value;
}

async function nativeDownload(page, button, path) {
  const pending = page.waitForEvent('download', {timeout: 30000});
  await button.click(); const item = await pending; await item.saveAs(path);
  assert.equal(await item.failure(), null); return readFile(path);
}

async function backup(page, expected, out, name, report) {
  const data = await nativeDownload(page, page.locator('#export-profile'), join(out, name));
  assert(data.equals(canonical(expected)), `Native complete backup differed: ${name}.`);
  report.artifacts.push({name, bytes: data.length, sha256: hash(data)}); return data;
}

async function importFile(page, file) {
  await page.locator('#profile-import').setInputFiles(file);
  await expect(page.locator('#message')).toContainText('Profile imported', {timeout: 30000});
  await expect(page.locator('#cancel-operation')).toBeHidden();
}

async function board(page, root, out, variant, report) {
  const card = page.locator(`[data-look-id="${id(3000)}"]`), name = `board-${variant}.png`;
  const bytes = await nativeDownload(page, card.getByRole('button', {name: 'Download outfit board', exact: true}), join(out, name));
  report.artifacts.push({name, bytes: bytes.length, sha256: hash(bytes)});
  const decoded = await runFile(PYTHON, ['-c', BOARD_INSPECTOR, root, join(out, name), variant], {timeout: 30000, maxBuffer: 65536});
  report.boards.push(JSON.parse(decoded.stdout));
}

async function runtime(root, out) {
  const {receipt, projects, plan} = await readFixtures(root), origin = suppliedOrigin();
  await mkdir(out, {recursive: false});
  const report = {schemaVersion: 1, status: 'running', origin, fixtureReceiptSha256: hash(await readFile(join(root, 'fixture-receipt.json'))),
    runnerSha256: hash(await readFile(fileURLToPath(import.meta.url))), fixture: receipt,
    browserProcesses: [], errors: [], external: [], artifacts: [], boards: [], checks: []};
  const save = () => writeFile(join(out, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  const started = performance.now(); let context;
  const autoAccept = dialog => dialog.accept();
  const observe = page => {
    page.on('dialog', autoAccept); page.on('pageerror', error => report.errors.push(error.message));
    page.on('request', request => {
      if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) report.external.push(request.url());
    });
  };
  const launch = async () => {
    context = await chromium.launchPersistentContext(join(out, 'browser-profile'), {headless: true,
      acceptDownloads: true, viewport: {width: 1280, height: 960},
      ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
    report.browserVersion = context.browser().version();
    const cdp = await context.browser().newBrowserCDPSession();
    report.browserProcesses.push(...(await cdp.send('SystemInfo.getProcessInfo')).processInfo
      .filter(value => value.type === 'browser').map(value => value.id)); await cdp.detach();
    const page = context.pages()[0] || await context.newPage(); observe(page); return page;
  };
  try {
    const left = await launch(); await left.goto(origin);
    await expect(left.locator('#save-status')).not.toContainText(/Opening/i);
    await importFile(left, join(root, 'profile-exact-8MiB.json'));
    report.firstSavedRevision = (await durable(left, projects.A)).revision;
    await backup(left, projects.A, out, 'A-native.json', report); await board(left, root, out, 'A', report);
    await left.locator('#profile-import').setInputFiles(join(root, 'profile-plus-one.json'));
    await expect(left.locator('#message')).toContainText(/8 MiB|large|limit|size/i);
    await backup(left, projects.A, out, 'A-after-overflow-native.json', report);
    assert.deepEqual((await rawStored(left)).value.project, projects.A);
    const right = await context.newPage(); observe(right); await right.goto(origin);
    await expect(right.locator('#profile-title')).toHaveValue(projects.A.title, {timeout: 30000});
    await expect(right.locator('#save-status')).not.toContainText(/Opening/i);
    await backup(right, projects.A, out, 'A-second-tab-native.json', report);
    await importFile(right, join(root, 'profile-B.json')); const winner = await durable(right, projects.B);
    await backup(right, projects.B, out, 'B-winner-native.json', report); await board(right, root, out, 'B', report);
    const rawPiece = '  Unsubmitted piece 🦉  ', rawNotes = '  Unsubmitted look note\nExact second line 🦉  ';
    await left.locator('#piece-name').fill(rawPiece);
    const notes = left.locator(`#look-notes-${id(3000)}`); await notes.fill(rawNotes);
    await notes.evaluate(node => node.setSelectionRange(3, 9));
    await left.evaluate(() => {
      window.styleMaximumObservedNodes = {piece: document.querySelector('#piece-name'), notes: document.querySelector('#look-notes-' + (3000).toString(16).padStart(32, '0'))};
    });
    const rawIntact = async () => {
      await expect(left.locator('#piece-name')).toHaveValue(rawPiece); await expect(notes).toHaveValue(rawNotes);
      assert.deepEqual(await left.evaluate(() => {
        const old = window.styleMaximumObservedNodes, current = document.querySelector('#look-notes-' + (3000).toString(16).padStart(32, '0'));
        return {pieceSame: old.piece === document.querySelector('#piece-name'), notesSame: old.notes === current,
          selection: [current.selectionStart, current.selectionEnd]};
      }), {pieceSame: true, notesSame: true, selection: [3, 9]});
    };
    await left.locator(`[data-look-id="${id(3029)}"] [data-label="like"]`).click();
    await expect(left.locator('#save-status')).toContainText(/another tab|changed|conflict|protected/i);
    assert.deepEqual((await rawStored(left)).value, winner, 'Stale complete profile changed the foreign winner.');
    await rawIntact(); await backup(left, projects.local, out, 'local-conflict-native.json', report);
    await left.locator('#undo').click(); await backup(left, projects.A, out, 'local-undo-native.json', report);
    await left.locator('#redo').click(); await backup(left, projects.local, out, 'local-redo-native.json', report);
    await rawIntact(); assert.deepEqual((await rawStored(left)).value, winner);
    // A real native confirmation remains open while another genuine tab
    // commits C. No mocked storage result or replacement receipt is used.
    left.off('dialog', autoAccept);
    const dialogPending = left.waitForEvent('dialog'), clickPending = left.locator('#replace-saved-copy').click();
    const dialog = await dialogPending; assert.equal(dialog.type(), 'confirm');
    await importFile(right, join(root, 'profile-C.json')); const newer = await durable(right, projects.C);
    await dialog.accept(); await clickPending; left.on('dialog', autoAccept);
    await expect(left.locator('#save-status')).toContainText(/another tab|changed|conflict|protected/i);
    assert.deepEqual((await rawStored(left)).value, newer); await rawIntact();
    await backup(left, projects.local, out, 'local-after-stale-review-native.json', report);
    await left.locator('#replace-saved-copy').click(); const replaced = await durable(left, projects.local);
    assert.notEqual(replaced.revision, newer.revision); await rawIntact();
    await backup(left, projects.local, out, 'local-replacement-native.json', report);
    report.checks.push('Full A/B/C photo/rating/look conflict identity; protected local Undo/Redo/raw nodes/caret; stale reviewed replacement refused and fresh explicit replacement complete.');
    // Deliberately resolve unsent fields before testing committed history.
    await left.locator('#piece-name').fill(''); await notes.fill(projects.A.looks[0].notes);
    for (let index = 1; index <= 6; index++) {
      const title = `Original maximum style ${String(index).padStart(2, '0')}`;
      await left.locator('#profile-title').fill(title); await left.locator('#profile-form').getByRole('button', {name: 'Save profile title', exact: true}).click();
      await durable(left, {...projects.local, title});
    }
    const states = receipt.expectedRetainedFullHistorySnapshots;
    for (let step = 1; step < states; step++) {
      await left.locator('#undo').click();
      await expect(left.locator('#profile-title')).toHaveValue(`Original maximum style ${String(6 - step).padStart(2, '0')}`);
    }
    await expect(left.locator('#undo')).toBeDisabled();
    for (let step = 1; step < states; step++) await left.locator('#redo').click();
    const final = {...projects.local, title: 'Original maximum style 06'};
    // The same content existed before Undo. Wait for the actual current save
    // pump to finish before freezing its revision for exact restart comparison.
    await expect(left.locator('#save-status')).toContainText('Saved on this device');
    await expect(left.locator('#retry-load')).toBeEnabled();
    const finalStored = await durable(left, final);
    report.finalStoredReceipt = {schemaVersion: finalStored.schemaVersion, revision: finalStored.revision,
      storedJsonBytes: Buffer.byteLength(JSON.stringify(finalStored)), storedJsonSha256: hash(Buffer.from(JSON.stringify(finalStored))),
      completeProjectBytes: canonical(final).length, completeProjectSha256: hash(canonical(final))};
    await backup(left, final, out, 'final-native.json', report);
    report.history = {completeSnapshotBytes: canonical(final).length, retainedSnapshots: states, undoTransitions: states - 1,
      budgetBytes: 25165824, provesByteCap: canonical(final).length * states <= 25165824 && canonical(final).length * (states + 1) > 25165824};
    assert(report.history.provesByteCap); await save();
    await context.close(); context = undefined;
    const reopened = await launch(); await reopened.goto(origin);
    await expect(reopened.locator('#profile-title')).toHaveValue(final.title, {timeout: 30000});
    await expect(reopened.locator('#save-status')).not.toContainText(/Opening|Restoring/i);
    assert.deepEqual((await rawStored(reopened)).value, finalStored, 'Restart rewrote or lost the complete stored value.');
    await backup(reopened, final, out, 'restart-native.json', report);
    assert(new Set(report.browserProcesses).size >= 2, 'A genuinely new browser process is required.');
    await reopened.screenshot({path: join(out, 'desktop.png'), fullPage: true});
    await reopened.setViewportSize({width: 390, height: 844});
    assert(await reopened.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await reopened.screenshot({path: join(out, 'mobile-390.png'), fullPage: true});
    for (const name of ['desktop.png', 'mobile-390.png']) {
      const bytes = await readFile(join(out, name)); report.artifacts.push({name, bytes: bytes.length, sha256: hash(bytes)});
    }
    assert.deepEqual(report.errors, []); assert.deepEqual(report.external, []);
    report.checks.push('Complete 36/80/30/20 graph, exact 8MiB raw admission/+1 refusal, four full-history snapshots by measured 24MiB budget, full distinct browser restart and exact complete native JSON.');
    report.expected = plan.expected; report.status = 'passed'; report.wallMs = performance.now() - started;
  } catch (error) { report.status = 'failed'; report.failure = {message: error.message, stack: error.stack}; throw error; }
  finally { await context?.close(); report.allOwnedBrowserProcessesClosed = true; await save(); }
  console.log(JSON.stringify({status: report.status, out, wallMs: report.wallMs, canonicalBytes: receipt.measuredCanonicalBytes}));
}

async function main() {
  const root = resolve(process.env.STYLE_CONFLICT_FIXTURES || '/workspace/style116-maximum-fixtures');
  if (process.argv.includes('--fixtures-only')) return freezeFixtures(root);
  assert(process.argv.includes('--run-prepared'));
  assert(process.env.STYLE_CONFLICT_OUTPUT, 'Set STYLE_CONFLICT_OUTPUT to a new workspace directory.');
  return runtime(root, resolve(process.env.STYLE_CONFLICT_OUTPUT));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
