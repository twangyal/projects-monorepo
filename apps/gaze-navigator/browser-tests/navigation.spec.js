import { test, expect } from '@playwright/test';

const evidence = new WeakMap();
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
  await page.clock.install({ time: new Date('2026-10-03T00:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-10-03T00:01:00Z'));
});
test.afterEach(async ({ page }) => {
  expect(evidence.get(page).external, 'simulation must not contact a camera/model CDN').toEqual([]);
  expect(evidence.get(page).errors, 'page must not throw').toEqual([]);
});

async function calibrate(page) {
  for (let i = 0; i < 27; i++) await page.locator('#calibrationStage button').click();
  await expect(page.locator('#playground')).toBeVisible();
}

async function simulate(page) {
  await page.getByRole('button', { name: 'Pointer simulation', exact: true }).click();
  await calibrate(page);
}

async function hit(locator) {
  return locator.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const at = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return at === element || element.contains(at);
  });
}

// Nearby assist can select controls up to 96 px away, so "looking away" must use the
// visible point farthest from every enabled gaze target rather than a fixed corner.
async function lookAway(page) {
  const point = await page.evaluate(() => {
    const rects = [...document.querySelectorAll('[data-gaze-target]')]
      .filter(node => !node.disabled)
      .map(node => node.getBoundingClientRect())
      .filter(rect => rect.width > 0 && rect.height > 0);
    let best = { x: 1, y: 1, distance: -1 };
    for (let x = 1; x < innerWidth; x += 8) {
      for (let y = 1; y < innerHeight; y += 8) {
        const distance = Math.min(...rects.map(rect => Math.hypot(
          Math.max(rect.left - x, 0, x - rect.right), Math.max(rect.top - y, 0, y - rect.bottom))));
        if (distance > best.distance) best = { x, y, distance };
      }
    }
    return best;
  });
  await page.mouse.move(point.x, point.y);
  return point.distance;
}

async function hold(page, locator, { scroll = true, duration = 1100 } = {}) {
  if (scroll) await locator.evaluate(element => new Promise(resolve => {
    const ancestors = [];
    for (let node = element.parentElement; node; node = node.parentElement) ancestors.push(node);
    const positions = () => [window.scrollX, window.scrollY, ...ancestors.flatMap(node => [node.scrollLeft, node.scrollTop])];
    const before = positions();
    const done = () => { document.removeEventListener('scrollend', done, true); resolve(); };
    document.addEventListener('scrollend', done, true);
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    if (positions().every((value, index) => value === before[index])) done();
  }));
  await lookAway(page);
  await page.clock.runFor(32);
  const geometry = await locator.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const at = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return { target: element.id || element.textContent, bounds: bounds.toJSON(), hit: at?.id || at?.className };
  });
  expect(await hit(locator), `control center must be visible and unobstructed: ${JSON.stringify(geometry)}`).toBe(true);
  const bounds = await locator.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.clock.runFor(duration);
}

async function reachKey(page, key, direction) {
  for (let i = 0; i < 20 && !await hit(key); i++) {
    await hold(page, page.locator(direction > 0 ? '#keyboardDown' : '#keyboardUp'), { scroll: false });
  }
  expect(await hit(key), 'all keys must be reachable through gaze scrolling').toBe(true);
}

test('real pointer dwell confirms once until looking away', async ({ page }) => {
  await simulate(page);
  const compose = page.locator('#composeButton');
  await compose.evaluate(button => {
    button.dataset.confirmations = '0';
    button.addEventListener('click', () => { button.dataset.confirmations = String(Number(button.dataset.confirmations) + 1); });
  });
  await hold(page, compose);
  await expect(page.locator('#composer')).toBeVisible();
  const held = await compose.boundingBox();
  await page.mouse.move(held.x + held.width / 2 + 1, held.y + held.height / 2);
  await page.clock.runFor(3000);
  await expect(compose).toHaveAttribute('data-confirmations', '1');
  await hold(page, compose);
  await expect(compose).toHaveAttribute('data-confirmations', '2');
});

test('confirmation timing is gaze reachable and slower holds cannot activate prematurely', async ({ page }) => {
  await simulate(page);
  const target = page.locator('#selectButton');
  await target.evaluate(button => {
    button.dataset.confirmations = '0';
    button.addEventListener('click', () => { button.dataset.confirmations = String(Number(button.dataset.confirmations) + 1); });
  });
  await hold(page, page.locator('#dwellSlow'));
  await expect(page.locator('#dwellSlow')).toHaveAttribute('aria-pressed', 'true');
  await hold(page, target);
  await expect(target).toHaveAttribute('data-confirmations', '0');
  await page.clock.runFor(600);
  await expect(target).toHaveAttribute('data-confirmations', '1');
  await page.clock.runFor(3500);
  await expect(target).toHaveAttribute('data-confirmations', '1');
  await hold(page, page.locator('#dwellVerySlow'), { duration: 1700 });
  await expect(page.locator('#dwellVerySlow')).toHaveAttribute('aria-pressed', 'true');
  await hold(page, target);
  await expect(target).toHaveAttribute('data-confirmations', '1');
  await page.clock.runFor(1600);
  await expect(target).toHaveAttribute('data-confirmations', '2');
  await page.clock.runFor(3500);
  await expect(target).toHaveAttribute('data-confirmations', '2');
  await hold(page, page.locator('#dwellDefault'), { duration: 2700 });
  await expect(page.locator('#dwellDefault')).toHaveAttribute('aria-pressed', 'true');
  await hold(page, target);
  await expect(target).toHaveAttribute('data-confirmations', '3');
  await page.locator('#dwellSlow').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#dwellSlow')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await simulate(page);
  await expect(page.locator('#dwellDefault')).toHaveAttribute('aria-pressed', 'true');
});

test('gaze safety controls stay reachable through pause, scrolling, and stop', async ({ page }) => {
  await simulate(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await hold(page, page.locator('#pageDown'), { scroll: false });
  const lower = await page.evaluate(() => window.scrollY);
  expect(lower).toBeGreaterThan(0);
  await hold(page, page.locator('#pageUp'), { scroll: false });
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(lower);
  await hold(page, page.locator('#pauseTracking'), { scroll: false });
  await expect(page.locator('#pauseTracking')).toHaveText('Resume tracking');
  const paused = await page.locator('#pauseTracking').boundingBox();
  await page.mouse.move(paused.x + paused.width / 2 + 1, paused.y + paused.height / 2);
  await page.clock.runFor(2000);
  await expect(page.locator('#pauseTracking')).toHaveText('Resume tracking');
  await expect(page.locator('#pageDown')).toBeDisabled();
  await hold(page, page.locator('#pauseTracking'), { scroll: false });
  await expect(page.locator('#pauseTracking')).toHaveText('Pause tracking');
  await hold(page, page.locator('#stopTracking'), { scroll: false });
  await expect(page.locator('#simulate')).toBeEnabled();
  await expect(page.locator('#status')).toContainText('Tracking stopped');
});

test('gaze keyboard reaches lower keys and saves a complete session draft', async ({ page }) => {
  await simulate(page);
  await hold(page, page.locator('#composeButton'));
  await hold(page, page.locator('#editSubject'));
  const a = page.locator('#keyboardKeys').getByRole('button', { name: 'a', exact: true });
  const backspace = page.locator('#keyboardKeys').getByRole('button', { name: 'Backspace', exact: true });
  await hold(page, a, { scroll: false });
  await expect(page.locator('#draftSubject')).toHaveValue('a');
  await reachKey(page, backspace, 1);
  await hold(page, backspace, { scroll: false });
  await expect(page.locator('#draftSubject')).toHaveValue('');
  await reachKey(page, a, -1);
  await hold(page, a, { scroll: false });
  await hold(page, page.locator('#closeKeyboard'), { scroll: false });
  await expect(page.locator('#textKeyboard')).toBeHidden();
  await hold(page, page.locator('#editBody'));
  await hold(page, page.locator('#keyboardKeys').getByRole('button', { name: 'b', exact: true }), { scroll: false });
  await hold(page, page.locator('#closeKeyboard'), { scroll: false });
  await hold(page, page.locator('#saveDraft'));
  await expect(page.locator('#draftList article')).toHaveText('a: bOpen draft: a');
  await expect(page.getByRole('button', { name: 'Open draft: a', exact: true })).toBeVisible();
  await expect(page.locator('#composer')).toBeHidden();
  await expect(page.locator('#result')).toContainText('Nothing was sent');
});


test('multiline keyboard preview preserves reachable controls and held-scroll confirmation', async ({ page }) => {
  await simulate(page);
  await hold(page, page.locator('#composeButton'));
  const original = Array.from({ length: 12 }, (_, index) => `Line ${index + 1}: a longer practice message that wraps on a narrow screen.`).join('\n');
  await page.locator('#draftBody').fill(original);
  await hold(page, page.locator('#editBody'));
  for (const id of ['keyboardUp', 'keyboardDown', 'keyboardCaps', 'closeKeyboard']) {
    expect(await hit(page.locator(`#${id}`)), `${id} must stay visible with multiline text`).toBe(true);
  }
  await hold(page, page.locator('#keyboardCaps'), { scroll: false });
  await expect(page.locator('#keyboardCaps')).toHaveText('Lowercase');
  await hold(page, page.locator('#keyboardKeys').getByRole('button', { name: 'A', exact: true }), { scroll: false });
  await expect(page.locator('#draftBody')).toHaveValue(original + 'A');
  await hold(page, page.locator('#keyboardCaps'), { scroll: false });
  await hold(page, page.locator('#keyboardKeys').getByRole('button', { name: 'b', exact: true }), { scroll: false });
  await expect(page.locator('#draftBody')).toHaveValue(original + 'Ab');
  const keys = page.locator('#keyboardKeys');
  await hold(page, page.locator('#keyboardDown'), { scroll: false });
  const once = await keys.evaluate(element => element.scrollTop);
  expect(once).toBeGreaterThan(0);
  const held = await page.locator('#keyboardDown').boundingBox();
  await page.mouse.move(held.x + held.width / 2 + 1, held.y + held.height / 2);
  await page.clock.runFor(2000);
  expect(await keys.evaluate(element => element.scrollTop), 'fresh samples over a held scroll control must not repeat its action').toBe(once);
  await hold(page, page.locator('#closeKeyboard'), { scroll: false });
  await expect(page.locator('#textKeyboard')).toBeHidden();
  await expect(page.locator('#draftBody')).toHaveValue(original + 'Ab');
});

test('held-out report can be closed through gaze without manually scrolling its overlay', async ({ page }) => {
  await simulate(page);
  await hold(page, page.locator('#checkAccuracy'), { scroll: false });
  await expect(page.locator('#accuracyPanel')).toBeVisible();
  await expect(page.locator('#downloadAccuracy')).toBeDisabled();
  const area = await page.locator('#accuracyStage').boundingBox();
  for (let i = 0; i < 5; i++) {
    const visible = await page.locator('#accuracyDot').evaluate(dot => {
      const bounds = dot.getBoundingClientRect();
      const at = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return at?.closest('#accuracyStage') !== null && at?.closest('#accuracyStage') !== undefined;
    });
    expect(visible, `measurement target ${i + 1} must be visible above the fixed footer`).toBe(true);
    await page.clock.runFor(2100);
  }
  await expect(page.locator('#accuracyResult')).toContainText('SIMULATION');
  const displayed = JSON.parse(await page.locator('#accuracyData').textContent());
  expect(displayed).toMatchObject({format:'gaze-accuracy-report',schemaVersion:1,mode:'simulation',
    viewport:{width:page.viewportSize().width,height:page.viewportSize().height},
    measurementArea:{left:area.x,top:area.y,width:area.width,height:area.height},
    protocol:{targetMs:2000,settleMs:500,targetCount:5,units:'CSS pixels'}});
  expect(displayed.targets).toHaveLength(5);
  expect(displayed.limitations.join(' ')).toContain('not webcam accuracy');
  const pending = page.waitForEvent('download');
  await hold(page, page.locator('#downloadAccuracy'), {scroll:false});
  const downloaded = await pending;
  const stream = await downloaded.createReadStream();
  const chunks=[];for await(const chunk of stream)chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(displayed);
  expect(downloaded.suggestedFilename()).toBe('gaze-accuracy-simulation.json');
  await hold(page, page.locator('#cancelAccuracy'), { scroll: false });
  await expect(page.locator('#accuracyPanel')).toBeHidden();
});

test('new and cancelled accuracy checks cannot download an earlier report',async({page})=>{
  await simulate(page);
  await page.locator('#checkAccuracy').click();
  await page.clock.runFor(10500);
  await expect(page.locator('#downloadAccuracy')).toBeEnabled();
  await page.locator('#cancelAccuracy').click();
  await page.locator('#checkAccuracy').click();
  await expect(page.locator('#downloadAccuracy')).toBeDisabled();
  await expect(page.locator('#accuracyData')).toBeEmpty();
  await page.locator('#pauseTracking').click();
  await expect(page.locator('#accuracyResult')).toContainText('cancelled');
  await expect(page.locator('#downloadAccuracy')).toBeDisabled();
  await expect(page.locator('#accuracyData')).toBeEmpty();
});

test('gaze reopens a saved draft and updates the same record',async({page})=>{
 await simulate(page);await page.locator('#composeButton').click();
 await page.locator('#draftSubject').fill('Original subject');await page.locator('#draftBody').fill('Original body');
 await page.locator('#saveDraft').click();
 await hold(page,page.locator('[data-draft-id="draft-1"] button'));
 await expect(page.locator('#draftSubject')).toHaveValue('Original subject');
 await expect(page.locator('#saveDraft')).toHaveText('Update draft');
 await page.locator('#draftBody').fill('Changed body');
 await hold(page,page.locator('#saveDraft'));
 await expect(page.locator('#draftList [data-draft-id]')).toHaveCount(1);
 await expect(page.locator('#draftList')).toContainText('Changed body');
 await hold(page,page.locator('[data-draft-id="draft-1"] button'));
 await expect(page.locator('#draftBody')).toHaveValue('Changed body');
});

test('dirty draft switches require gaze review and retain the current composer on Keep',async({page})=>{
 await simulate(page);await page.locator('#composeButton').click();
 await page.locator('#draftSubject').fill('Saved');await page.locator('#draftBody').fill('Retained');await page.locator('#saveDraft').click();
 await page.locator('#composeButton').click();await page.locator('#draftSubject').fill('Unsaved');await page.locator('#draftBody').fill('Latest text');
 await hold(page,page.locator('[data-draft-id="draft-1"] button'));
 await expect(page.locator('#draftReview')).toBeVisible();
 await page.locator('#draftBody').fill('Typed after review appeared');
 await hold(page,page.locator('#keepComposer'));
 await expect(page.locator('#draftBody')).toHaveValue('Typed after review appeared');
 await page.locator('#cancelDraft').click();await page.locator('#composeButton').click();
 await expect(page.locator('#draftSubject')).toHaveValue('Unsaved');
 await hold(page,page.locator('[data-draft-id="draft-1"] button'));
 await hold(page,page.locator('#replaceComposer'));
 await expect(page.locator('#draftBody')).toHaveValue('Retained');
 await page.locator('#draftBody').fill('Uncommitted correction');
 await hold(page,page.locator('#newDraft'));
 await hold(page,page.locator('#replaceComposer'));
 await expect(page.locator('#draftBody')).toBeEmpty();
 await expect(page.locator('#saveDraft')).toHaveText('Save draft');
 await expect(page.locator('#draftList')).toContainText('Retained');
});

test('twenty maximum session drafts retain full text and refuse a new record without losing fields',async({page})=>{
 await simulate(page);
 const body='字'.repeat(10000),title='题'.repeat(199);
 for(let i=0;i<20;i++){
  await page.locator('#composeButton').click();
  await page.locator('#draftSubject').fill(title+String.fromCharCode(65+i));
  await page.locator('#draftBody').fill(body);await page.locator('#saveDraft').click();
 }
 await expect(page.locator('#draftList [data-draft-id]')).toHaveCount(20);
 await page.locator('#composeButton').click();await page.locator('#draftSubject').fill('Unstored');await page.locator('#draftBody').fill('Overflow draft stays here');
 await page.locator('#saveDraft').click();
 await expect(page.locator('#result')).toContainText('20');
 await expect(page.locator('#draftBody')).toHaveValue('Overflow draft stays here');
 await page.locator('[data-draft-id="draft-1"] button').click();await page.locator('#replaceComposer').click();
 await expect(page.locator('#draftSubject')).toHaveValue(title+'A');await expect(page.locator('#draftBody')).toHaveValue(body);
 await page.locator('#draftBody').fill('Updated first maximum');await page.locator('#saveDraft').click();
 await expect(page.locator('#draftList [data-draft-id]')).toHaveCount(20);
 await page.locator('[data-draft-id="draft-20"] button').click();
 await expect(page.locator('#draftSubject')).toHaveValue(title+'T');await expect(page.locator('#draftBody')).toHaveValue(body);
 await page.reload();await simulate(page);await expect(page.locator('#draftList [data-draft-id]')).toHaveCount(0);
});

test('resize restarts partial calibration and disables navigation', async ({ page }) => {
  await page.locator('#simulate').click();
  for (let i = 0; i < 5; i++) await page.locator('#calibrationStage button').click();
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport.width + 12, height: viewport.height + 12 });
  await expect(page.locator('#status')).toHaveText('Calibration point 1 of 9.');
  await expect(page.locator('#calibrationStage button')).toHaveText('1');
  await expect(page.locator('#playground')).toBeHidden();
  await expect(page.locator('#checkAccuracy')).toBeDisabled();
  await expect(page.locator('#pageDown')).toBeDisabled();
  await calibrate(page);
  await expect(page.locator('#checkAccuracy')).toBeEnabled();
});

test('gaze downloads saved drafts and reopens exact text after refresh without saving the composer',async({page})=>{
 await simulate(page);await expect(page.locator('#downloadDrafts')).toBeDisabled();
 await page.locator('#composeButton').click();await page.locator('#draftSubject').fill('Original 🦊');const text='Full original\n<script>window.injected=true</script>\n'+ 'Message '.repeat(80).trimEnd();await page.locator('#draftBody').fill(text);await page.locator('#saveDraft').click();
 await page.locator('#composeButton').click();await page.locator('#draftSubject').fill('Unstored');await page.locator('#draftBody').fill('Keep unsaved composer');
 const downloadPromise=page.waitForEvent('download');await hold(page,page.locator('#downloadDrafts'));const download=await downloadPromise;const {readFile}=await import('node:fs/promises');const bytes=await readFile(await download.path());
 expect(JSON.parse(bytes.toString())).toEqual({format:'gaze-session-drafts',version:1,drafts:[{subject:'Original 🦊',body:text}]});await expect(page.locator('#draftBody')).toHaveValue('Keep unsaved composer');
 await page.reload();await simulate(page);await expect(page.locator('#draftList article')).toHaveCount(0);
 await new Promise(resolve=>setTimeout(resolve,5500));await hold(page,page.locator('#importDrafts'));await expect(page.locator('#draftBackupFile')).toBeVisible();await expect(page.locator('#result')).toContainText('mouse or keyboard');const chooserPromise=page.waitForEvent('filechooser');await page.locator('#draftBackupFile').click();const chooser=await chooserPromise;await chooser.setFiles({name:'backup.json',mimeType:'application/json',buffer:bytes});
 await expect(page.locator('#draftList article')).toHaveCount(1);await hold(page,page.locator('[data-draft-id="draft-1"] button'));await expect(page.locator('#draftBody')).toHaveValue(text);expect(await page.evaluate(()=>window.injected)).toBeUndefined();
 await page.locator('#draftBody').fill(text+' Updated');await hold(page,page.locator('#saveDraft'));await expect(page.locator('#draftList article')).toHaveCount(1);await page.locator('[data-draft-id="draft-1"] button').click();await expect(page.locator('#draftBody')).toHaveValue(text+' Updated');
});

test('maximum imported notebook and malformed or excessive backups preserve saved and unsaved text',async({page})=>{
 await simulate(page);const rows=Array.from({length:20},(_,i)=>({subject:`Imported ${i}`.padEnd(200,'x'),body:'🦊'.repeat(5000)}));const payload=drafts=>({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'gaze-session-drafts',version:1,drafts}))});
 await page.locator('#draftBackupFile').setInputFiles(payload(rows));await expect(page.locator('#draftList article')).toHaveCount(20);
 await page.locator('#composeButton').click();await page.locator('#draftSubject').fill('Unstored');await page.locator('#draftBody').fill('Latest original composer');
 for(const file of [payload([{subject:'Extra',body:'Overflow'}]),{name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{')},{name:'huge.json',mimeType:'application/json',buffer:Buffer.alloc(2*1024*1024+1,32)}]){
  await page.locator('#draftBackupFile').setInputFiles(file);await expect(page.locator('#result')).not.toContainText('Reading draft backup');await expect(page.locator('#draftList article')).toHaveCount(20);await expect(page.locator('#draftBody')).toHaveValue('Latest original composer');
 }
 await page.locator('[data-draft-id="draft-20"] button').click();await page.locator('#replaceComposer').click();await expect(page.locator('#draftSubject')).toHaveValue(rows[19].subject);await expect(page.locator('#draftBody')).toHaveValue(rows[19].body);
});

test('late file read cannot append over a newer selection and current editing remains untouched',async({page})=>{
 await simulate(page);await page.evaluate(()=>{const original=File.prototype.text;File.prototype.text=function(){return this.name==='slow.json'?new Promise(resolve=>{window.releaseDraftRead=resolve;}):original.call(this);};});
 const file=(name,subject)=>({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'gaze-session-drafts',version:1,drafts:[{subject,body:subject+' body'}]}))});
 await page.locator('#draftBackupFile').setInputFiles(file('slow.json','Old'));await expect(page.locator('#result')).toContainText('Reading draft backup');
 await page.locator('#composeButton').click();await page.locator('#draftSubject').fill('New saved');await page.locator('#draftBody').fill('Typed during read');await page.locator('#saveDraft').click();await page.locator('#composeButton').click();await page.locator('#draftBody').fill('Still unsaved');
 await page.locator('#draftBackupFile').setInputFiles(file('fast.json','New imported'));await expect(page.locator('#draftList article')).toHaveCount(2);
 await page.evaluate(()=>window.releaseDraftRead(JSON.stringify({format:'gaze-session-drafts',version:1,drafts:[{subject:'Late stale',body:'Must not publish'}]})));
 await expect(page.locator('#draftList article')).toHaveCount(2);await expect(page.locator('#draftList')).toContainText('Typed during read');await expect(page.locator('#draftList')).toContainText('New imported');await expect(page.locator('#draftList')).not.toContainText('Late stale');await expect(page.locator('#draftBody')).toHaveValue('Still unsaved');
});

// Finds a visible blank point 12-40 px outside a control where it is clearly the closest target.
async function nearbyPoint(locator) {
  return locator.evaluate(element => {
    const distance = (rect, x, y) => Math.hypot(Math.max(rect.left - x, 0, x - rect.right), Math.max(rect.top - y, 0, y - rect.bottom));
    const others = [...document.querySelectorAll('[data-gaze-target]')]
      .filter(node => node !== element && !node.disabled)
      .map(node => node.getBoundingClientRect())
      .filter(rect => rect.width > 0 && rect.height > 0);
    const own = element.getBoundingClientRect();
    for (let offset = 12; offset <= 40; offset += 4) {
      const cx = own.left + own.width / 2;
      const cy = own.top + own.height / 2;
      for (const [x, y] of [[cx, own.bottom + offset], [cx, own.top - offset], [own.left - offset, cy], [own.right + offset, cy]]) {
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
        if (document.elementFromPoint(x, y)?.closest('[data-gaze-target]')) continue;
        if (others.every(rect => distance(rect, x, y) > distance(own, x, y) + 24)) return { x, y };
      }
    }
    return null;
  });
}

test('nearby assist outlines and confirms a control just outside the pointer, and Off requires a direct hit', async ({ page }) => {
  await simulate(page);
  const compose = page.locator('#composeButton');
  await compose.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const point = await nearbyPoint(compose);
  expect(point, 'a blank point near Compose must exist').not.toBeNull();
  await lookAway(page);
  await page.clock.runFor(32);
  await page.mouse.move(point.x, point.y);
  await page.clock.runFor(400);
  await expect(compose).toHaveClass(/gaze-assisted/);
  await expect(page.locator('#composer')).toBeHidden();
  await page.clock.runFor(700);
  await expect(page.locator('#composer')).toBeVisible();

  await hold(page, page.locator('#cancelDraft'));
  await hold(page, page.locator('#assistOff'));
  await expect(page.locator('#assistOff')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#assistDescription')).toContainText('off');
  await compose.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const again = await nearbyPoint(compose);
  await lookAway(page);
  await page.clock.runFor(32);
  await page.mouse.move(again.x, again.y);
  await page.clock.runFor(2000);
  await expect(page.locator('#composer')).toBeHidden();
  await expect(compose).not.toHaveClass(/gaze-focus/);
});

test('gaze between two equally close controls abstains instead of guessing', async ({ page }) => {
  await simulate(page);
  const compose = page.locator('#composeButton');
  await compose.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const between = await page.evaluate(() => {
    const a = document.querySelector('#composeButton').getBoundingClientRect();
    const b = document.querySelector('#searchButton').getBoundingClientRect();
    const x = (a.left + a.right + b.left + b.right) / 4;
    const y = (a.top + a.bottom + b.top + b.bottom) / 4;
    const gap = Math.hypot(Math.max(a.left - x, 0, x - a.right), Math.max(a.top - y, 0, y - a.bottom));
    return { x, y, gap, blank: !document.elementFromPoint(x, y)?.closest('[data-gaze-target]') };
  });
  expect(between.blank).toBe(true);
  expect(between.gap).toBeLessThanOrEqual(48);
  await lookAway(page);
  await page.clock.runFor(32);
  await page.mouse.move(between.x, between.y);
  await page.clock.runFor(3000);
  await expect(page.locator('#gazeCursor')).toHaveClass(/ambiguous/);
  await expect(page.locator('#composer')).toBeHidden();
  await expect(page.locator('#result')).not.toContainText('confirmed');
});
