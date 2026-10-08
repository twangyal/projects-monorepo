/** Independent #118 original graph and native file/bitmap completion ownership oracle. */
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Project } from '../src/model.ts';

interface Gate { waiting: boolean; delivered: boolean; release: () => void }
interface ImportOracle {
  files: Record<string, Gate>;
  bitmap: Gate | null;
  bitmapCloses: number;
  bitmapPending: number;
  holdBitmap: () => void;
  holdFile: (name: string) => void;
  focused: Element | null;
}
declare global { interface Window { importOracle: ImportOracle } }

async function jpeg(page: Page, color: string) {
  return page.evaluate(color => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 400;
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' })!;
    ctx.fillStyle = color; ctx.fillRect(0, 0, 320, 400);
    ctx.fillStyle = '#eac644'; ctx.fillRect(260, 340, 50, 50);
    return canvas.toDataURL('image/jpeg', .9);
  }, color);
}
function original(dataUrl: string): Project {
  return {
    schemaVersion: 1, title: 'Original retained concept', note: 'Original note\nSecond literal line 🌿',
    garment: { bodyWidth: 210, bodyLength: 240, sleeveLength: 35, neckline: 'v', color: '#3f5468', pattern: 'stripe', patternColor: '#ebce9b' },
    strokes: [
      { id: 'literal-left-stroke', color: '#ef233c', width: 7, points: [{ x: .4, y: .4 }, { x: .48, y: .48 }] },
      { id: 'literal-right-stroke', color: '#fff3dc', width: 4, points: [{ x: .55, y: .42 }, { x: .6, y: .55 }] },
    ],
    placement: { x: .48, y: .43, width: .57, height: .49, rotation: 7, opacity: .85 },
    photo: { dataUrl, width: 320, height: 400, name: 'original-independent.jpg' },
  };
}
function incoming(base: Project): Project {
  const value = structuredClone(base); value.title = 'Pending foreign backup'; value.note = 'Must not replace newer work';
  value.garment = { bodyWidth: 250, bodyLength: 285, sleeveLength: 60, neckline: 'round', color:'#9051a0',pattern:'weave',patternColor:'#3be295' };
  value.strokes = [{ id:'incoming-only', color:'#00ff00', width:15, points:[{x:.3,y:.3},{x:.7,y:.65}] }];
  value.placement = { x:.7,y:.6,width:.9,height:.7,rotation:-30,opacity:.5 };
  value.photo = { ...base.photo!, name:'incoming-independent.jpg' }; return value;
}
async function upload(page: Page, project: Project, name = 'original.json') {
  await page.getByLabel('Import project backup').setInputFiles({ name, mimeType:'application/json', buffer:Buffer.from(JSON.stringify(project)) });
}
async function backup(page: Page): Promise<Project> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name:'Export project backup', exact:true }).click()]);
  return JSON.parse(await readFile((await download.path())!, 'utf8')) as Project;
}
async function stored(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('clothing-studio', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction('project', 'readonly'), request = tx.objectStore('project').get('current');
        let result: unknown;
        request.onsuccess = () => { result = request.result; };
        tx.oncomplete = () => resolve(result); tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  });
}
async function installGates(page: Page) {
  await page.evaluate(() => {
    const gate = (): Gate => {
      let release!: () => void;
      const promise = new Promise<void>(resolve => { release = resolve; });
      // A symbol-free private Promise is deliberately retained by the scheduling closure.
      const value = { waiting:false, delivered:false, release };
      promises.set(value, promise); return value;
    };
    const promises = new WeakMap<Gate, Promise<void>>(), text = File.prototype.text, bitmap = window.createImageBitmap, close = ImageBitmap.prototype.close;
    const tracked = new WeakSet<ImageBitmap>(), held = new WeakSet<ImageBitmap>();
    const state: ImportOracle = { files:{},bitmap:null,bitmapCloses:0,bitmapPending:0,focused:null,
      holdFile: name => { state.files[name] = gate(); }, holdBitmap: () => { state.bitmap = gate(); } };
    window.importOracle = state;
    File.prototype.text = async function () {
      const result = await text.call(this), own = state.files[this.name];
      if (own && !own.waiting) { own.waiting = true; await promises.get(own); own.delivered = true; }
      return result;
    };
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      const own = state.bitmap && !state.bitmap.waiting ? state.bitmap : null;
      if (own) own.waiting = true;
      state.bitmapPending++;
      try {
        const result = await Reflect.apply(bitmap, window, args) as ImageBitmap; tracked.add(result);
        if (own) { held.add(result); await promises.get(own); own.delivered = true; }
        return result;
      } catch (error) { state.bitmapPending--; throw error; }
    }) as typeof createImageBitmap;
    ImageBitmap.prototype.close = function () {
      if (tracked.delete(this)) state.bitmapPending--;
      if (held.delete(this)) state.bitmapCloses++;
      return close.call(this);
    };
  });
}
async function setup(page: Page) {
  await page.goto('/'); await expect(page.locator('#save-state')).toHaveText('Ready for your first idea');
  const base = original(await jpeg(page, '#2d7381'));
  await upload(page, base); await expect(page.locator('#message')).toContainText('Project backup restored');
  await expect(page.locator('#title')).toHaveValue(base.title); await expect(page.locator('#save-state')).toHaveText('Locally saved');
  expect(await backup(page)).toEqual(base);
  await installGates(page); return base;
}
async function heldFile(page: Page, value: Project | string, name = 'held.json') {
  await page.evaluate(name => window.importOracle.holdFile(name), name);
  await page.getByLabel('Import project backup').setInputFiles({ name, mimeType:'application/json', buffer:Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) });
  await expect.poll(() => page.evaluate(name => window.importOracle.files[name].waiting, name)).toBe(true);
}
async function releaseFile(page: Page, name = 'held.json') {
  await page.evaluate(name => window.importOracle.files[name].release(), name);
  await expect.poll(() => page.evaluate(name => window.importOracle.files[name].delivered, name)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.importOracle.bitmapPending)).toBe(0);
}
async function releaseBitmap(page: Page) {
  await page.evaluate(() => window.importOracle.bitmap!.release());
  await expect.poll(() => page.evaluate(() => window.importOracle.bitmapCloses)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.importOracle.bitmapPending)).toBe(0);
}
async function previewCorner(page: Page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name:'Export preview PNG', exact:true }).click()]);
  const bytes = await readFile((await download.path())!);
  return page.evaluate(async encoded => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], {type:'image/png'}));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap,0,0); const pixel = Array.from(ctx.getImageData(4,4,1,1).data);
    const result = { width:bitmap.width,height:bitmap.height,pixel }; bitmap.close(); return result;
  }, bytes.toString('base64'));
}

test('newer committed name and note survive delayed backup with focus and complete Undo history', async ({ page }) => {
  const base = await setup(page); await heldFile(page, incoming(base));
  await page.getByLabel('Concept name').fill('Newer committed name'); await page.getByLabel('Concept note').fill('Newer note with caret 🌿');
  await page.locator('#note').evaluate(node => { const area = node as HTMLTextAreaElement; area.setSelectionRange(6, 10); window.importOracle.focused = node; });
  await releaseFile(page);
  expect(await page.locator('#note').evaluate(node => ({ same:node === window.importOracle.focused,focused:document.activeElement === node,value:(node as HTMLTextAreaElement).value,start:(node as HTMLTextAreaElement).selectionStart,end:(node as HTMLTextAreaElement).selectionEnd }))).toEqual({same:true,focused:true,value:'Newer note with caret 🌿',start:6,end:10});
  const expected = { ...base,title:'Newer committed name',note:'Newer note with caret 🌿' };
  expect(await backup(page)).toEqual(expected);
  await page.getByRole('button',{name:'Undo',exact:true}).click(); expect(await backup(page)).toEqual({...base,title:expected.title});
  await page.getByRole('button',{name:'Undo',exact:true}).click(); expect(await backup(page)).toEqual(base);
  await page.getByRole('button',{name:'Redo',exact:true}).click(); await page.getByRole('button',{name:'Redo',exact:true}).click(); expect(await backup(page)).toEqual(expected);
  const pixel = await previewCorner(page); expect([pixel.width,pixel.height]).toEqual([320,400]);
  [45,115,129,255].forEach((channel,index) => expect(Math.abs(pixel.pixel[index]-channel)).toBeLessThanOrEqual(3));
});

test('changed-back raw placement input without blur retires pending backup and preserves its actual node', async ({ page }) => {
  const base = await setup(page); await heldFile(page, incoming(base));
  const field = page.getByLabel('Rotation', {exact:true}); await field.fill('17'); await field.fill('7');
  await field.evaluate(node => { window.importOracle.focused = node; });
  await releaseFile(page);
  expect(await field.evaluate(node => ({same:node===window.importOracle.focused,focused:document.activeElement===node,value:(node as HTMLInputElement).value}))).toEqual({same:true,focused:true,value:'7'});
  expect(await backup(page)).toEqual(base);
  const fresh = incoming(base); await upload(page,fresh,'fresh-after-raw.json'); await expect(page.locator('#title')).toHaveValue(fresh.title); expect(await backup(page)).toEqual(fresh);
  await page.getByRole('button',{name:'Undo',exact:true}).click(); expect(await backup(page)).toEqual(base);
});

test('changed-back decimal placement draft retains trailing zeros after a delayed backup', async ({ page }) => {
  const base = await setup(page); await heldFile(page, incoming(base));
  const field = page.getByLabel('Rotation', {exact:true}); await field.fill('17.250'); await field.fill('7.000');
  await field.evaluate(node => { window.importOracle.focused = node; });
  await releaseFile(page);
  expect(await field.evaluate(node => ({same:node===window.importOracle.focused,focused:document.activeElement===node,value:(node as HTMLInputElement).value}))).toEqual({same:true,focused:true,value:'7.000'});
  expect(await stored(page)).toEqual(base); expect(await backup(page)).toEqual(base);
});

test('delayed backup cannot cancel an active native sketch and its single release commit', async ({ page }) => {
  const base = await setup(page); await heldFile(page,incoming(base));
  const surface = page.locator('#sketch-surface'); await surface.scrollIntoViewIfNeeded(); const box = (await surface.boundingBox())!;
  await page.mouse.move(box.x+box.width*.46,box.y+box.height*.5); await page.mouse.down();
  await page.mouse.move(box.x+box.width*.52,box.y+box.height*.54,{steps:3});
  const before = await surface.innerHTML(); await releaseFile(page); expect(await surface.innerHTML()).toBe(before);
  await page.mouse.move(box.x+box.width*.57,box.y+box.height*.57,{steps:3}); await page.mouse.up();
  const saved = await backup(page); expect(saved.strokes).toHaveLength(3); expect({...saved,strokes:base.strokes}).toEqual(base); expect(saved.strokes.slice(0,2)).toEqual(base.strokes);
  expect(saved.strokes[2].points[0].x).toBeCloseTo(.46,2); expect(saved.strokes[2].points.at(-1)!.x).toBeCloseTo(.57,2);
  expect(saved.strokes[2].points.at(-1)!.y).toBeCloseTo(.57,2);
  await page.getByRole('button',{name:'Undo',exact:true}).click(); expect(await backup(page)).toEqual(base);
  await page.getByRole('button',{name:'Redo',exact:true}).click(); expect(await backup(page)).toEqual(saved);
});

test('delayed backup cannot replace an active native placement drag or its original full base', async ({ page }) => {
  const base = await setup(page); await heldFile(page,incoming(base));
  const surface = page.locator('#preview-surface'); await surface.scrollIntoViewIfNeeded(); const box = (await surface.boundingBox())!;
  await page.mouse.move(box.x+box.width*.4,box.y+box.height*.4); await page.mouse.down();
  await page.mouse.move(box.x+box.width*.45,box.y+box.height*.45,{steps:3}); const before = await surface.innerHTML();
  await releaseFile(page); expect(await surface.innerHTML()).toBe(before);
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5,{steps:3}); await page.mouse.up();
  const saved = await backup(page); expect({...saved,placement:base.placement}).toEqual(base);
  expect(saved.placement.x).toBeCloseTo(.58,2); expect(saved.placement.y).toBeCloseTo(.53,2);
  expect({...saved.placement,x:base.placement.x,y:base.placement.y}).toEqual(base.placement);
  await page.getByRole('button',{name:'Undo',exact:true}).click(); expect(await backup(page)).toEqual(base);
  await page.getByRole('button',{name:'Redo',exact:true}).click(); expect(await backup(page)).toEqual(saved);
});

test('real backup bitmap completing after a newer photo import closes without replacing newer complete work', async ({ page }) => {
  const base = await setup(page); await page.evaluate(() => window.importOracle.holdBitmap()); await upload(page,incoming(base),'held-bitmap.json');
  await expect.poll(() => page.evaluate(() => window.importOracle.bitmap!.waiting)).toBe(true);
  const photo = await jpeg(page,'#733c91'); await page.getByLabel('Upload body photo').setInputFiles({name:'newer-photo.jpg',mimeType:'image/jpeg',buffer:Buffer.from(photo.split(',')[1],'base64')});
  await expect(page.locator('#photo-name')).toHaveText('newer-photo.jpg'); const newer = await backup(page);
  expect({...newer,photo:base.photo}).toEqual(base); expect(newer.photo!.dataUrl).not.toBe(base.photo!.dataUrl);
  await releaseBitmap(page); expect(await backup(page)).toEqual(newer);
  const pixel = await previewCorner(page); [115,60,145,255].forEach((channel,index) => expect(Math.abs(pixel.pixel[index]-channel)).toBeLessThanOrEqual(4));
  await page.getByRole('button',{name:'Undo',exact:true}).click(); expect(await backup(page)).toEqual(base);
});

test('real photo bitmap finishing after committed note cannot erase note or replace original photo', async ({ page }) => {
  const base = await setup(page), image = await jpeg(page,'#ad2d5e'); await page.evaluate(() => window.importOracle.holdBitmap());
  await page.getByLabel('Upload body photo').setInputFiles({name:'old-pending-photo.jpg',mimeType:'image/jpeg',buffer:Buffer.from(image.split(',')[1],'base64')});
  await expect.poll(() => page.evaluate(() => window.importOracle.bitmap!.waiting)).toBe(true);
  await page.getByLabel('Concept note').fill('Note written after choosing photo'); await releaseBitmap(page);
  expect(await backup(page)).toEqual({...base,note:'Note written after choosing photo'});
  await page.getByRole('button',{name:'Undo',exact:true}).click(); expect(await backup(page)).toEqual(base);
});

test('real photo bitmap finishing after an empty raw placement draft preserves its field and complete saved concept', async ({ page }) => {
  const base = await setup(page), image = await jpeg(page,'#ad2d5e'); await page.evaluate(() => window.importOracle.holdBitmap());
  await page.getByLabel('Upload body photo').setInputFiles({name:'pending-raw-draft.jpg',mimeType:'image/jpeg',buffer:Buffer.from(image.split(',')[1],'base64')});
  await expect.poll(() => page.evaluate(() => window.importOracle.bitmap!.waiting)).toBe(true);
  const field = page.getByLabel('Rotation', {exact:true}); await field.fill('');
  await field.evaluate(node => { window.importOracle.focused = node; });
  await releaseBitmap(page);
  expect(await field.evaluate(node => ({same:node===window.importOracle.focused,focused:document.activeElement===node,value:(node as HTMLInputElement).value}))).toEqual({same:true,focused:true,value:''});
  expect(await stored(page)).toEqual(base); expect(await backup(page)).toEqual(base);
  expect(await stored(page)).toEqual(base);
});

test('old malformed read cannot overwrite status or release a newer pending import finalizer', async ({ page }) => {
  const base = await setup(page); await heldFile(page,'{not valid JSON','old-invalid.json');
  const fresh = incoming(base); fresh.title = 'Fresh explicit import'; await heldFile(page,fresh,'fresh-held.json');
  const status = await page.locator('#message').textContent(); await releaseFile(page,'old-invalid.json');
  await expect(page.locator('#load-state')).toBeVisible(); expect(await page.locator('#message').textContent()).toBe(status);
  await releaseFile(page,'fresh-held.json'); await expect(page.locator('#load-state')).toBeHidden(); await expect(page.locator('#title')).toHaveValue(fresh.title);
  expect(await backup(page)).toEqual(fresh); await page.getByRole('button',{name:'Undo',exact:true}).click(); expect(await backup(page)).toEqual(base);
});

test('explicit Cancel and controlled pagehide retire reads while same-file fresh retry remains available', async ({ page }) => {
  const base = await setup(page), next = incoming(base); await heldFile(page,next,'same-file.json');
  await page.getByRole('button',{name:'Cancel import',exact:true}).click(); const message = await page.locator('#message').textContent(); await releaseFile(page,'same-file.json');
  expect(await page.locator('#message').textContent()).toBe(message); expect(await backup(page)).toEqual(base);
  await upload(page,next,'same-file.json'); await expect(page.locator('#title')).toHaveValue(next.title); expect(await backup(page)).toEqual(next);
  await page.getByRole('button',{name:'Undo',exact:true}).click(); expect(await backup(page)).toEqual(base);
  await heldFile(page,next,'lifetime.json');
  // Explicit lifecycle policy injection, not a claim of physical navigation or real BFCache.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  await releaseFile(page,'lifetime.json'); await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  expect(await backup(page)).toEqual(base);
});
