import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';
import { png } from './helpers/raster.ts';
async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.locator('#backup').click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
for (const kind of ['motif', 'artwork'] as const) test(`small ${kind} uploads round-trip and huge headers are rejected before decode`, async ({ page }) => {
  await page.addInitScript(() => { const decode = window.createImageBitmap.bind(window); Object.assign(window, {fileDecodes:0}); window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => { if (args[0] instanceof File) (window as unknown as {fileDecodes:number}).fileDecodes++; return decode(...args); }) as typeof createImageBitmap; });
  await page.goto('/'); await page.locator('#product-editor').getByRole('button', {name:/^Use the Blank tee template/}).click();
  await page.locator(`#${kind}-file`).setInputFiles({name:'tiny.png',mimeType:'image/png',buffer:png(10,8)});
  await expect(page.locator('#message')).toContainText(kind === 'motif' ? 'repeats on' : 'Artwork placed');
  const before = await backup(page), asset = kind === 'motif' ? before.product.motifs[0] : before.product.artwork[0];
  expect(asset).toMatchObject({width:10,height:8});
  await expect(page.locator('#save-state')).toHaveText('Locally saved'); await page.reload();
  await expect(page.locator('#product-status')).toContainText('Editing Blank tee'); expect(await backup(page)).toEqual(before);
  await page.locator('#project-file').setInputFiles({name:'tiny.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(before))});
  await expect(page.locator('#message')).toContainText('Project backup restored'); expect(await backup(page)).toEqual(before);
  await page.locator(`#${kind}-file`).setInputFiles({name:'huge.png',mimeType:'image/png',buffer:png(9000,1)});
  await expect(page.locator('#message')).toContainText('8000');
  expect(await page.evaluate(() => (window as unknown as {fileDecodes:number}).fileDecodes)).toBe(0);
  expect(await backup(page)).toEqual(before);
});
for (const kind of ['motifs','artwork'] as const) test(`undecodable ${kind} backup and saved record cannot replace current work`, async ({page}) => {
  await page.goto('/'); await page.locator('#product-editor').getByRole('button',{name:/^Use the Ringer tee template/}).click();
  await page.getByLabel('Concept name',{exact:true}).fill('Kept concept'); await expect(page.locator('#save-state')).toHaveText('Locally saved');
  const before = await backup(page), broken = structuredClone(before), bytes = png(10,8); bytes[41] ^= 255;
  const asset = {name:'corrupt',dataUrl:`data:image/png;base64,${bytes.toString('base64')}`,width:10,height:8};
  broken.product[kind] = [kind === 'motifs' ? {...asset,id:'m1'} : {...asset,part:'front',xCm:0,yCm:10,widthCm:10}];
  await page.locator('#project-file').setInputFiles({name:'corrupt.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(broken))});
  await expect(page.locator('#message')).toContainText('could not be decoded'); expect(await backup(page)).toEqual(before);
  await page.evaluate(async record => {const db = await new Promise<IDBDatabase>(resolve => {const r = indexedDB.open('clothing-studio',1);r.onsuccess=()=>resolve(r.result);}); await new Promise<void>(resolve=> {const tx=db.transaction('project','readwrite');tx.objectStore('project').put(record,'current');tx.oncomplete=()=>resolve();});db.close();},broken);
  await page.reload(); await expect(page.locator('#save-state')).toContainText('previous concept protected');
  expect((await backup(page)).product).toBeUndefined();
  const stored = await page.evaluate(async () => {const db = await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('clothing-studio',1);r.onsuccess=()=>resolve(r.result);});const record=await new Promise(resolve=>{const r=db.transaction('project').objectStore('project').get('current');r.onsuccess=()=>resolve(r.result);});db.close();return record;});
  expect(stored).toEqual(broken);
});
