import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pngUrl } from './helpers/raster.ts';
async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.locator('#backup').click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
test('reviewed product assets reopen at the exact canonical 6 MiB limit through native decode and storage', async ({page}) => {
  test.setTimeout(90000); await page.goto('/');
  await page.locator('#product-editor').getByRole('button',{name:/^Use the Ringer tee template/}).click();
  const incoming = await backup(page); incoming.title = 'Exact-cap product';
  incoming.product.motifs = Array.from({length:6}, (_,i)=>({id:`m${i}`,name:'motif',dataUrl:pngUrl(768,768,500000),width:768,height:768}));
  incoming.product.artwork = ['front','back'].map(part=>({part,name:'art',dataUrl:pngUrl(1024,1024,1500000),width:1024,height:1024,xCm:0,yCm:10,widthCm:20}));
  const size = () => Buffer.byteLength(JSON.stringify(incoming,null,2)), cap = 6*1024*1024;
  incoming.note += 'a'.repeat((cap-size())%4);
  incoming.product.artwork[0].dataUrl = pngUrl(1024,1024,1500000+cap-size());
  expect(size()).toBe(cap);
  await page.locator('#project-file').setInputFiles({name:'exact-cap.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});
  await expect(page.locator('#message')).toContainText('Project backup restored',{timeout:30000});
  expect(await backup(page)).toEqual(incoming);
  await expect(page.locator('#save-state')).toHaveText('Locally saved',{timeout:30000});
  await page.reload(); await expect(page.getByLabel('Concept name',{exact:true})).toHaveValue(incoming.title,{timeout:30000});
  expect(await backup(page)).toEqual(incoming);
});
test('drape fabric refuses a pending grading rule without erasing the raw increment or redo', async ({page}) => {
  await page.goto('/'); await page.getByRole('button',{name:'Apply measured pattern',exact:true}).click();
  await page.getByRole('button',{name:'Apply grading rule',exact:true}).click();
  const field = page.getByLabel('Waist increment per size (cm)',{exact:true});
  await field.fill('5'); await page.getByRole('button',{name:'Apply grading rule',exact:true}).click();
  await page.getByRole('button',{name:'Undo',exact:true}).click(); const before=await backup(page);
  await field.fill('7'); await page.getByLabel('Fabric',{exact:true}).selectOption('denim');
  await expect(field).toHaveValue('7'); expect(await backup(page)).toEqual(before);
  await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Discard grading edits',exact:true}).click();
  await page.getByLabel('Fabric',{exact:true}).selectOption('denim'); expect((await backup(page)).construction.fabric).toBe('denim');
});
