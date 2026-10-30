import { test, expect } from '@playwright/test';

const evidence = new WeakMap();

// A controllable WebGazer stand-in. Assigning undefined (a fresh load) creates a new instance.
function installFakeCamera() {
  const record = window.__camera = { instances: [], faceVisible: true, released: 0 };
  function create() {
    let listener = null;
    let samples = [];
    const api = {
      params: {}, started: false,
      setGazeListener(callback) { listener = callback; return api; },
      clearGazeListener() { listener = null; return api; },
      begin: async () => { api.started = true; return api; },
      saveDataAcrossSessions(value) { api.saved = value; return api; },
      showPredictionPoints() { return api; },
      removeMouseEventListeners() { api.mouseTraining = false; return api; },
      end() { record.released++; api.started = false; return api; },
      stopVideo() { return api; },
      getRegression: () => [{ init() { samples = []; }, getData: () => samples }],
      recordScreenPosition(x, y) { if (record.faceVisible) samples.push([x, y]); },
      emit(point) { listener?.(point, 0); },
      get samples() { return samples.length; },
    };
    record.instances.push(api);
    return api;
  }
  let current = create();
  Object.defineProperty(window, 'webgazer', {
    configurable: true,
    get: () => current,
    set: value => { current = value === undefined ? create() : value; },
  });
}

test.beforeEach(async ({ page }) => {
  const state = { external: [], errors: [] };
  evidence.set(page, state);
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:4173') {
      state.external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.addInitScript(installFakeCamera);
  await page.clock.install({ time: new Date('2026-10-12T00:00:00Z') });
});
test.afterEach(async ({ page }) => {
  expect(evidence.get(page).external, 'the fake camera means no CDN or model downloads').toEqual([]);
  expect(evidence.get(page).errors, 'page must not throw').toEqual([]);
});

const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');
const dot = page => page.locator('#gaze-web-navigator .calibration-dot');

let minute = 1;
async function open(page, path) {
  await page.goto(path);
  await page.clock.pauseAt(new Date(Date.UTC(2026, 9, 12, 0, minute++)));
}

const openSettings = page => panel(page).locator('details.settings').evaluate(details => { details.open = true; });

async function startCamera(page) {
  await openSettings(page);
  await panel(page).getByRole('button', { name: 'Camera' }).click();
  await expect(panel(page).getByRole('button', { name: 'Camera' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dot(page)).toHaveClass(/settling/);
  await expect(status(page)).toContainText('Look at dot 1 of 9');
}

// Calibration, then the accuracy check's four dots with no gaze to measure: the circle keeps its size.
async function finishCalibration(page, circle = 'medium (90 px)') {
  await page.clock.runFor(9 * 1900 + 100);
  await expect(status(page)).toHaveText('Calibrated with 9 of 9 dots. Checking accuracy: look at dot 1 of 4.');
  await expect(dot(page)).toHaveClass(/checking/);
  await page.clock.runFor(4 * 2000);
  await expect(status(page)).toHaveText(`Calibrated with 9 of 9 dots. The accuracy check saw too little gaze to measure, so the circle stays ${circle}. The circle now follows your gaze.`);
  await expect(dot(page)).toHaveClass(/hidden/);
}

// Steady gaze `offset` px to the right of each accuracy-check dot, at about 30 samples a second.
async function lookNearCheckDots(page, offset) {
  for (;;) {
    const [shown, x, y] = await dot(page).evaluate(element => [element.classList.contains('checking'), parseFloat(element.style.left), parseFloat(element.style.top)]);
    if (!shown) break;
    await page.evaluate(([x, y]) => window.webgazer.emit({ x, y }), [x + offset, y]);
    await page.clock.runFor(33);
  }
}

// Emits steady gaze at an element's center long enough for smoothing to settle there.
async function gazeAt(page, locator) {
  await locator.evaluate(element => {
    const top = element.getBoundingClientRect().top + window.scrollY - Math.min(140, window.innerHeight * 0.2);
    window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  });
  const box = await locator.boundingBox();
  for (let i = 0; i < 12; i++) {
    await page.evaluate(([x, y]) => window.webgazer.emit({ x, y }), [box.x + box.width / 2, box.y + box.height / 2]);
    await page.clock.runFor(33);
  }
  await page.clock.runFor(150);
}

async function typeInstruction(page, text) {
  await panel(page).getByLabel('Typed instruction').fill(text);
  await panel(page).getByRole('button', { name: 'Do it' }).click();
}

test('hands-free calibration needs no clicks, then camera gaze selects the context', async ({ page }) => {
  await open(page, '/practice-site/catalog.html');
  await startCamera(page);
  const api = await page.evaluate(() => ({ saved: window.webgazer.saved, mouse: window.webgazer.mouseTraining }));
  expect(api).toEqual({ saved: false, mouse: false });
  await page.clock.runFor(800);
  expect(await page.evaluate(() => window.webgazer.samples), 'no samples during the settle period').toBe(0);
  await finishCalibration(page);
  expect(await page.evaluate(() => window.webgazer.samples)).toBe(36);
  // The real pointer no longer moves the circle in camera mode.
  await page.mouse.move(5, 5);
  await gazeAt(page, page.getByLabel('Sort by'));
  await expect(panel(page).locator('.context li').first()).toHaveText(/Dropdown: Sort by/);
  await typeInstruction(page, 'choose title');
  await expect(page.getByLabel('Sort by')).toHaveValue('Title');
});

test('after calibration, an accuracy check sizes the circle to where the gaze lands', async ({ page }) => {
  await open(page, '/practice-site/catalog.html');
  await startCamera(page);
  await page.clock.runFor(9 * 1900 + 100);
  await expect(status(page)).toHaveText('Calibrated with 9 of 9 dots. Checking accuracy: look at dot 1 of 4.');
  await lookNearCheckDots(page, 50);
  await expect(status(page)).toHaveText('Calibrated with 9 of 9 dots. Your gaze lands within about 50 px of where you look, so the circle is small (60 px). The circle now follows your gaze.');
  await expect(panel(page).getByLabel('Circle size')).toHaveValue('small');
  // A poor calibration takes the largest circle and says how to improve it.
  await typeInstruction(page, 'recalibrate');
  await page.clock.runFor(9 * 1900 + 100);
  await lookNearCheckDots(page, 200);
  await expect(status(page)).toHaveText('Calibrated with 9 of 9 dots. Your gaze lands up to about 200 px from where you look, more than the large circle (130 px) covers. Check lighting and keep your head still, then say recalibrate, or use pointer.');
  await expect(panel(page).getByLabel('Circle size')).toHaveValue('large');
  // Cancel during the check keeps the calibration and the circle.
  await typeInstruction(page, 'recalibrate');
  await page.clock.runFor(9 * 1900 + 100);
  await typeInstruction(page, 'cancel');
  await expect(status(page)).toHaveText('Calibrated with 9 of 9 dots. Accuracy check stopped, so the circle stays large (130 px). The circle now follows your gaze.');
  await expect(dot(page)).toHaveClass(/hidden/);
});

test('a control named inside the circle and used becomes one more calibration sample', async ({ page }) => {
  await open(page, '/practice-site/catalog.html');
  await startCamera(page);
  await finishCalibration(page);
  const learned = () => page.evaluate(() => { const data = window.webgazer.getRegression()[0].getData(); return { count: data.length, last: data.at(-1) }; });
  expect((await learned()).count).toBe(36);
  const add = page.getByRole('button', { name: 'Add to cart' }).first();
  await gazeAt(page, add);
  await typeInstruction(page, 'click add to cart');
  await expect(status(page)).toContainText('Add to cart');
  const box = await add.boundingBox(), after = await learned();
  expect(after.count).toBe(37);
  expect(Math.abs(after.last[0] - (box.x + box.width / 2))).toBeLessThan(1);
  expect(Math.abs(after.last[1] - (box.y + box.height / 2))).toBeLessThan(1);
  // At most one sample every two seconds; a control as wide as the page says too little about where the eyes were.
  await typeInstruction(page, 'click add to cart');
  expect((await learned()).count).toBe(37);
  await page.clock.runFor(2100);
  await gazeAt(page, page.getByLabel('Sort by'));
  await typeInstruction(page, 'choose title');
  await expect(page.getByLabel('Sort by')).toHaveValue('Title');
  expect((await learned()).count).toBe(37);
  await page.clock.runFor(2100);
  await gazeAt(page, add);
  await typeInstruction(page, 'click add to cart');
  await expect.poll(async () => (await learned()).count).toBe(38);
});

test('camera mode continues after navigation with a fresh calibration, and stop camera releases it', async ({ page }) => {
  await open(page, '/practice-site/index.html');
  await startCamera(page);
  await finishCalibration(page);
  await gazeAt(page, page.getByRole('link', { name: 'Contact', exact: true }));
  await typeInstruction(page, 'open contact');
  await page.waitForURL('**/contact.html');
  await page.clock.pauseAt(new Date(Date.UTC(2026, 9, 12, 0, minute++)));
  // The new page recalibrates automatically; its clock may have run briefly before pausing.
  await expect(dot(page)).toHaveClass(/settling|sampling/);
  await expect(status(page)).toContainText(/Look at dot \d of 9/);
  await finishCalibration(page);
  await typeInstruction(page, 'stop camera');
  await expect(status(page)).toHaveText('Camera off. The circle follows the pointer.');
  expect(await page.evaluate(() => window.__camera.released)).toBe(1);
  await openSettings(page);
  await expect(panel(page).getByRole('button', { name: 'Pointer' })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page).getByRole('button', { name: 'Recalibrate' })).toBeDisabled();
});

test('calibration retries hidden-face dots, reports failure, and spoken cancel stops a rerun', async ({ page }) => {
  await open(page, '/practice-site/account.html');
  await page.evaluate(() => { window.__camera.faceVisible = false; });
  await startCamera(page);
  await page.clock.runFor(1950);
  await expect(status(page)).toContainText('Dot 1 of 9 needs another look');
  await page.clock.runFor(9 * 2 * 1900);
  await expect(status(page)).toContainText('Only 0 of 9 dots could be learned');
  await page.evaluate(() => { window.__camera.faceVisible = true; });
  await openSettings(page);
  await panel(page).getByRole('button', { name: 'Recalibrate' }).click();
  await expect(status(page)).toContainText('Look at dot 1 of 9');
  await typeInstruction(page, 'cancel');
  await expect(status(page)).toHaveText('Calibration stopped. Say recalibrate to try again, or use pointer.');
  await expect(dot(page)).toHaveClass(/hidden/);
});

test('a cancelled camera start cannot change the mode of an immediate retry', async ({ page }) => {
  await open(page, '/practice-site/catalog.html');
  const state = await page.evaluate(async () => {
    window.gazeNavigator.stop();
    const { startWebNavigator } = await import('/src/web/overlay.js');
    let loads = 0;
    window.gazeNavigator = startWebNavigator({ window, loadCamera: () => ++loads === 1 ? new Promise(() => {}) : Promise.resolve(window.webgazer) });
    window.gazeNavigator.run('use camera');
    window.gazeNavigator.run('use pointer');
    window.gazeNavigator.run('use camera');
    for (let index = 0; index < 20; index++) await Promise.resolve();
    return { source: window.gazeNavigator.shadow.querySelector('.use-camera').getAttribute('aria-pressed'), camera: window.gazeNavigator.camera.state, calibrating: window.gazeNavigator.calibrating };
  });
  expect(state).toEqual({ source: 'true', camera: 'ready', calibrating: true });
});

test('resizing during calibration keeps the stale circle hidden and preserves the calibration session', async ({ page }) => {
  await open(page, '/practice-site/index.html');
  const target = await page.getByRole('link', { name: 'Catalog', exact: true }).boundingBox();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2); await page.clock.runFor(33);
  await expect(page.locator('#gaze-web-navigator .outline').first()).toBeVisible();
  await expect(page.locator('#gaze-web-navigator .circle')).toHaveClass(/visible/);
  await startCamera(page);
  const circle = page.locator('#gaze-web-navigator .circle');
  await expect(circle).not.toHaveClass(/visible/);
  await typeInstruction(page, 'use a large circle'); await page.clock.runFor(33);
  await expect(panel(page).getByLabel('Circle size')).toHaveValue('large');
  await expect(circle).not.toHaveClass(/visible/);
  await expect(page.locator('#gaze-web-navigator .outline')).toHaveCount(0);
  await expect(dot(page)).toHaveClass(/settling/);
  expect(await page.evaluate(() => window.__camera.released)).toBe(0);
  await finishCalibration(page, 'large (130 px)');
  await gazeAt(page, page.getByRole('link', { name: 'Catalog', exact: true }));
  await expect(circle).toHaveClass(/visible/); await expect(circle).toHaveCSS('width', '260px');
});

test('losing the camera estimate retires its last target until a fresh page gaze arrives',async({page})=>{
  await open(page,'/practice-site/catalog.html');await startCamera(page);await finishCalibration(page);
  const sort=page.getByLabel('Sort by'),before=await sort.inputValue();await gazeAt(page,sort);
  await page.evaluate(()=>window.webgazer.emit(null));await page.clock.runFor(33);
  await typeInstruction(page,'choose title');await expect(sort).toHaveValue(before);
  await expect(status(page)).toContainText('tracking is lost');
  // Looking into the navigator cannot recover the old page target.
  await panel(page).evaluate(e=>{const r=e.getBoundingClientRect();window.webgazer.emit({x:r.x+r.width/2,y:r.y+r.height/2});});
  await typeInstruction(page,'choose title');await expect(sort).toHaveValue(before);
  await gazeAt(page,sort);await typeInstruction(page,'choose title');await expect(sort).toHaveValue('Title');
});

test('camera loss cancels a pending confirmation even after tracking returns',async({page})=>{
  await open(page,'/practice-site/catalog.html');await startCamera(page);await finishCalibration(page);
  const buy=page.getByRole('button',{name:'Add to cart',exact:true}).first();await buy.evaluate(e=>{e.textContent='Buy the quiet river';});const purchase=page.getByRole('button',{name:'Buy the quiet river',exact:true});await gazeAt(page,purchase);await typeInstruction(page,'click buy the quiet river');
  await expect(status(page)).toContainText('confirm');await expect(page.locator('#cartCount')).toHaveText('0');
  await page.evaluate(()=>window.webgazer.emit(null));await gazeAt(page,purchase);await typeInstruction(page,'confirm');
  await expect(page.locator('#cartCount')).toHaveText('0');await expect(status(page)).toContainText('nothing waiting');
  await typeInstruction(page,'click buy the quiet river');await typeInstruction(page,'confirm');await expect(page.locator('#cartCount')).toHaveText('1');
});

test('a speech-start target is discarded on loss and a fresh speech capture can use the recovered page',async({page})=>{
  await page.addInitScript(()=>{window.SpeechRecognition=class {constructor(){window.__lossSpeech=this;}start(){this.onstart?.();}abort(){this.onend?.();}};});
  await open(page,'/practice-site/catalog.html');await startCamera(page);await finishCalibration(page);
  const sort=page.getByLabel('Sort by');await gazeAt(page,sort);await panel(page).getByRole('button',{name:'Start listening',exact:true}).click();
  await page.evaluate(()=>window.__lossSpeech.onspeechstart?.());
  await page.evaluate(()=>window.webgazer.emit(null));
  // A second real dropdown is far away so the recovered gaze offers a different, unambiguous target.
  await page.evaluate(()=>{const label=document.createElement('label');label.textContent='Other sort';label.style.display='block';label.style.marginTop='1200px';const select=document.createElement('select');select.id='other-sort';select.innerHTML='<option>Newest</option><option>Title</option>';label.append(select);document.querySelector('main').append(label);const space=document.createElement('div');space.style.height='600px';label.after(space);});
  await gazeAt(page,page.locator('#other-sort'));
  await page.evaluate(()=>window.__lossSpeech.onresult({resultIndex:0,results:[Object.assign([{transcript:'choose title'}],{isFinal:true})]}));
  await expect(sort).toHaveValue('Newest');await expect(page.locator('#other-sort')).toHaveValue('Newest');
  // Starting speech while lost must also remain invalid across a typed safety command and recovery.
  await page.evaluate(()=>window.webgazer.emit(null));await page.evaluate(()=>window.__lossSpeech.onspeechstart?.());await typeInstruction(page,'cancel');
  await gazeAt(page,page.locator('#other-sort'));await page.evaluate(()=>window.__lossSpeech.onresult({resultIndex:1,results:[Object.assign([{transcript:'ignored prior'}],{isFinal:true}),Object.assign([{transcript:'choose title'}],{isFinal:true})]}));
  await expect(page.locator('#other-sort')).toHaveValue('Newest');
  await gazeAt(page,sort);await page.evaluate(()=>{window.__lossSpeech.onspeechstart?.();window.__lossSpeech.onresult({resultIndex:0,results:[Object.assign([{transcript:'choose title'}],{isFinal:true})]});});
  await expect(sort).toHaveValue('Title');
});

test('a delayed matching answer cannot act after camera loss, and pointer recovery stays usable',async({page})=>{
  await page.addInitScript(()=>{window.__gazeTestAssistant={decide:(_state,_question,options)=>new Promise(resolve=>{window.__releaseLostMatch=()=>resolve({probs:options.map(option=>option.includes('"Catalog"')?.99:.001)});}),yes:async()=>0};});
  await open(page,'/practice-site/index.html');await startCamera(page);await finishCalibration(page);const catalog=page.getByRole('link',{name:'Catalog',exact:true});await gazeAt(page,catalog);
  await panel(page).getByLabel('Smarter target matching').check();await expect(panel(page).locator('.assist-state')).toContainText('is on');
  await typeInstruction(page,'show me the book list');await expect(status(page)).toContainText('Working out');
  await page.evaluate(()=>window.webgazer.emit(null));await page.evaluate(()=>window.__releaseLostMatch());await page.clock.runFor(100);await expect(page).toHaveURL(/index.html$/);
  await typeInstruction(page,'pause');await expect(status(page)).toContainText('Paused');await typeInstruction(page,'cancel');await expect(status(page)).toContainText('Cancelled');await typeInstruction(page,'use pointer');await typeInstruction(page,'resume');
  const box=await catalog.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.clock.runFor(150);await typeInstruction(page,'open catalog');await page.waitForURL('**/catalog.html');
});

test('keyboard command capture cannot reuse the old camera target after loss and recovery',async({page})=>{
  await open(page,'/practice-site/catalog.html');await startCamera(page);await finishCalibration(page);
  const sort=page.getByLabel('Sort by');await gazeAt(page,sort);await sort.focus();await page.keyboard.press('Alt+Shift+G');await page.keyboard.type('choose title');
  await page.evaluate(()=>window.webgazer.emit(null));await expect(panel(page).getByLabel('Typed instruction')).toHaveAttribute('readonly','');
  await page.evaluate(()=>{const select=document.createElement('select');select.id='other-sort';select.innerHTML='<option>Newest</option><option>Title</option>';select.style.display='block';select.style.marginTop='1200px';document.querySelector('main').append(select);const space=document.createElement('div');space.style.height='600px';select.after(space);});
  await gazeAt(page,page.locator('#other-sort'));await page.keyboard.press('Enter');
  await expect(sort).toHaveValue('Newest');await expect(page.locator('#other-sort')).toHaveValue('Newest');await expect(status(page)).toContainText('tracking is lost');
});

test('cancelled partial training refuses camera actions until successful retraining', async ({ page }) => {
  await open(page, '/practice-site/catalog.html'); await startCamera(page);
  await page.clock.runFor(2 * 1900); await typeInstruction(page, 'cancel');
  const sort = page.getByLabel('Sort by'); await gazeAt(page, sort);
  await typeInstruction(page, 'choose title'); await expect(sort).toHaveValue('Newest');
  await expect(status(page)).toContainText('calibration is not ready');
  await typeInstruction(page, 'recalibrate'); await finishCalibration(page);
  await gazeAt(page, sort); await typeInstruction(page, 'choose title'); await expect(sort).toHaveValue('Title');
});

test('six learned dots leave camera actions blocked but pointer fallback works', async ({ page }) => {
  await open(page, '/practice-site/catalog.html'); await startCamera(page);
  await page.clock.runFor(6 * 1900); await page.evaluate(() => { window.__camera.faceVisible = false; });
  await page.clock.runFor(3 * 2 * 1900 + 500); await expect(status(page)).toContainText('Only 6 of 9 dots');
  const sort = page.getByLabel('Sort by'); await gazeAt(page, sort); await typeInstruction(page, 'choose title'); await expect(sort).toHaveValue('Newest');
  await typeInstruction(page, 'use pointer'); const box = await sort.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.clock.runFor(150);
  await typeInstruction(page, 'choose title'); await expect(sort).toHaveValue('Title');
});

test('redo retires successful calibration while cancelling only the accuracy check keeps it', async ({ page }) => {
  await open(page, '/practice-site/catalog.html'); await startCamera(page); await finishCalibration(page);
  await typeInstruction(page, 'recalibrate'); await page.clock.runFor(1900); await typeInstruction(page, 'cancel');
  const sort = page.getByLabel('Sort by'); await gazeAt(page, sort); await typeInstruction(page, 'choose title'); await expect(sort).toHaveValue('Newest');
  await typeInstruction(page, 'recalibrate'); await page.clock.runFor(9 * 1900 + 100); await typeInstruction(page, 'cancel');
  await gazeAt(page, sort); await typeInstruction(page, 'choose title'); await expect(sort).toHaveValue('Title');
});

test('speech begun on unready camera cannot act on a later pointer target', async ({ page }) => {
  await page.addInitScript(() => { window.SpeechRecognition = class { constructor() { window.__readySpeech = this; } start() { this.onstart?.(); } abort() { this.onend?.(); } }; });
  await open(page, '/practice-site/catalog.html'); await startCamera(page); await typeInstruction(page, 'cancel');
  const sort = page.getByLabel('Sort by'); await gazeAt(page, sort);
  await panel(page).getByRole('button', { name: 'Start listening', exact: true }).click();
  await page.evaluate(() => window.__readySpeech.onspeechstart?.()); await typeInstruction(page, 'use pointer');
  const box = await sort.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.clock.runFor(150);
  await page.evaluate(() => window.__readySpeech.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'choose title' }], { isFinal: true })] }));
  await expect(sort).toHaveValue('Newest'); await typeInstruction(page, 'choose title'); await expect(sort).toHaveValue('Title');
});

test('late restore acknowledgement cannot revive a cancelled manual recalibration', async ({ page }) => {
  await open(page, '/practice-site/catalog.html');
  await page.evaluate(async () => {
    window.gazeNavigator.stop();
    const { startWebNavigator } = await import('/src/web/overlay.js');
    const { createLocalCamera } = await import('/src/web/camera-source.js');
    window.gazeNavigator = startWebNavigator({ window, createCamera: options => {
      const camera = createLocalCamera(options);
      camera.restoreCalibration = () => new Promise(resolve => { window.__restoreReady = () => resolve({ ok: true }); });
      return camera;
    } });
  });
  await openSettings(page); await panel(page).getByRole('button', { name: 'Camera', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__restoreReady)).toBe('function');
  await typeInstruction(page, 'recalibrate'); await page.clock.runFor(1900); await typeInstruction(page, 'cancel');
  await page.evaluate(() => window.__restoreReady());
  const sort = page.getByLabel('Sort by'); await gazeAt(page, sort); await typeInstruction(page, 'choose title');
  await expect(sort).toHaveValue('Newest'); await expect(status(page)).toContainText('calibration is not ready');
});

async function resizeViewport(page) {
  const size = page.viewportSize(); await page.setViewportSize({ ...size, height: size.height + 60 }); await page.clock.runFor(33);
}

test('a changed viewport retires successful camera calibration until explicit retraining', async ({ page }) => {
  await open(page, '/practice-site/catalog.html'); await startCamera(page); await finishCalibration(page);
  const sort = page.getByLabel('Sort by'); await gazeAt(page, sort);
  await page.evaluate(() => window.dispatchEvent(new Event('resize'))); await page.clock.runFor(33);
  await typeInstruction(page, 'choose title'); await expect(sort).toHaveValue('Title');
  await sort.selectOption('Newest'); await resizeViewport(page); await gazeAt(page, sort);
  await typeInstruction(page, 'choose title'); await expect(sort).toHaveValue('Newest');
  await expect(status(page)).toContainText('calibration is not ready');
  expect(await page.evaluate(() => window.webgazer.samples)).toBe(0);
  await typeInstruction(page, 'pause'); await expect(status(page)).toContainText('Paused'); await typeInstruction(page, 'resume');
  await typeInstruction(page, 'recalibrate'); await finishCalibration(page); await gazeAt(page, sort);
  await typeInstruction(page, 'choose title'); await expect(sort).toHaveValue('Title');
});

test('a changed viewport cancels partial training without silently completing it', async ({ page }) => {
  await open(page, '/practice-site/catalog.html'); await startCamera(page); await page.clock.runFor(2 * 1900);
  await resizeViewport(page); await expect(status(page)).toContainText('window size changed');
  expect(await page.evaluate(() => window.gazeNavigator.calibrating)).toBe(false); await expect(dot(page)).toHaveClass(/hidden/);
  await page.clock.runFor(9 * 1900); const sort = page.getByLabel('Sort by'); await gazeAt(page, sort);
  await typeInstruction(page, 'choose title'); await expect(sort).toHaveValue('Newest');
  await typeInstruction(page, 'use pointer'); const box = await sort.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.clock.runFor(150);
  await typeInstruction(page, 'choose title'); await expect(sort).toHaveValue('Title');
});

test('a changed viewport retires confirmation and speech begun before pointer recovery', async ({ page }) => {
  await page.addInitScript(() => { window.SpeechRecognition = class { constructor() { window.__resizeSpeech = this; } start() { this.onstart?.(); } abort() { this.onend?.(); } }; });
  await open(page, '/practice-site/catalog.html'); await startCamera(page); await finishCalibration(page);
  const buy = page.getByRole('button', { name: 'Add to cart', exact: true }).first(); await buy.evaluate(e => { e.textContent = 'Buy the quiet river'; });
  await gazeAt(page, page.getByRole('button', { name: 'Buy the quiet river', exact: true })); await typeInstruction(page, 'click buy the quiet river'); await expect(status(page)).toContainText('confirm');
  await resizeViewport(page); await typeInstruction(page, 'confirm'); await expect(page.locator('#cartCount')).toHaveText('0');
  const sort = page.getByLabel('Sort by'); await gazeAt(page, sort); await panel(page).getByRole('button', { name: 'Start listening', exact: true }).click();
  await page.evaluate(() => window.__resizeSpeech.onspeechstart?.()); await typeInstruction(page, 'use pointer');
  const box = await sort.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.clock.runFor(150);
  await page.evaluate(() => window.__resizeSpeech.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'choose title' }], { isFinal: true })] }));
  await expect(sort).toHaveValue('Newest'); await typeInstruction(page, 'choose title'); await expect(sort).toHaveValue('Title');
});

test('a changed viewport invalidates a delayed restoration acknowledgement', async ({ page }) => {
  await open(page, '/practice-site/catalog.html'); await page.evaluate(async () => {
    window.gazeNavigator.stop(); const { startWebNavigator } = await import('/src/web/overlay.js'); const { createLocalCamera } = await import('/src/web/camera-source.js');
    window.gazeNavigator = startWebNavigator({ window, createCamera: options => {
      const camera = createLocalCamera(options); camera.restoreCalibration = () => new Promise(resolve => { window.__resizeRestore = () => resolve({ ok: true }); }); return camera;
    } });
  });
  await openSettings(page); await panel(page).getByRole('button', { name: 'Camera', exact: true }).click(); await expect.poll(() => page.evaluate(() => typeof window.__resizeRestore)).toBe('function');
  await resizeViewport(page); await page.evaluate(() => window.__resizeRestore()); const sort = page.getByLabel('Sort by'); await gazeAt(page, sort);
  await typeInstruction(page, 'choose title'); await expect(sort).toHaveValue('Newest'); await expect(status(page)).toContainText('calibration is not ready');
});
