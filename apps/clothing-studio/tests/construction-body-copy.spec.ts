import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import type {GarmentDrapeResult} from '../src/garment-drape.ts';
const copyName='Replace 3D product with this skirt';
async function backup(page:Page){const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Export project backup',exact:true}).click();return JSON.parse(await readFile((await(await wait).path())!,'utf8'));}
async function measured(page:Page,waist='76'){
 await page.getByRole('button',{name:'Skirt construction',exact:true}).click();
 for(const [key,value] of [['waist','90'],['hem','190'],['slant','65']])await page.locator(`#construction-${key}`).fill(value);
 await page.getByRole('button',{name:'Apply measured pattern',exact:true}).click();
 await page.locator('#body-enabled').check();
 for(const [key,value] of [['waist',waist],['hip','102'],['hipDepth','18.5']])await page.locator(`#body-${key}`).fill(value);
 await page.getByRole('button',{name:'Apply body measurements',exact:true}).click();
}
async function bodyTools(page:Page){
 await page.getByRole('button',{name:'Body & drape',exact:true}).click();
 const depth=page.getByLabel('Waist-to-hip depth (cm, optional)',{exact:true});
 if(!await depth.isVisible())await page.getByText('Waist, hip, depth and height (optional)',{exact:true}).click();
 return depth;
}
for(const width of [1280,390])test(`copied measured skirt carries body into saved 3D drape with Undo at ${width}px`,async({page},info)=>{
 test.setTimeout(120000);await page.setViewportSize({width,height:900});
 await page.addInitScript(()=>{const Native=Worker;window.Worker=class extends Native{constructor(...args:ConstructorParameters<typeof Worker>){super(...args);if(String(args[0]).includes('garment-drape.worker'))this.addEventListener('message',event=>{if(event.data.kind==='result')Object.assign(window,{copiedBodyDrape:event.data.result});});}};});
 await page.goto('/');await measured(page);await page.keyboard.press('Escape');const before=await backup(page);
 await page.getByRole('button',{name:'Skirt construction',exact:true}).click();await page.getByRole('button',{name:copyName,exact:true}).click();
 await page.getByRole('button',{name:'Back to garment',exact:true}).click();
 const depth=await bodyTools(page);
 await expect(depth).toHaveValue('18.5');await expect(page.getByLabel('Body waist girth (cm, optional)',{exact:true})).toHaveValue('76');await expect(page.getByLabel('Body hip girth (cm, optional)',{exact:true})).toHaveValue('102');
 const copied=await backup(page);expect(copied.bodyMeasurements).toEqual(before.bodyMeasurements);expect(copied.product.measurements).toEqual({waist:90,hem:190,slant:65});
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await backup(page)).toEqual(before);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await backup(page)).toEqual(copied);
 await expect(page.locator('#save-state')).toContainText('Locally saved');await page.reload();await bodyTools(page);await expect(depth).toHaveValue('18.5');expect(await backup(page)).toEqual(copied);
 await page.getByRole('button',{name:'Drape on a body',exact:true}).click();
 await page.waitForFunction(()=>{const r=(window as unknown as {copiedBodyDrape?:GarmentDrapeResult}).copiedBodyDrape;return r?.body.waist===76&&r.body.hip===102;},null,{timeout:60000});
 const result=await page.evaluate(()=>(window as unknown as {copiedBodyDrape:GarmentDrapeResult}).copiedBodyDrape);
 expect(result.body.landmarks!.waist!-result.body.landmarks!.hip!).toBe(18.5);expect(result.parts.every(part=>Object.values(part.positions).every(Number.isFinite))).toBe(true);
 await page.screenshot({path:info.outputPath(`copied-body-${width}.png`),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'Skirt construction',exact:true}).click();await page.locator('#body-waist').fill('77');await page.getByRole('button',{name:'Apply body measurements',exact:true}).click();await page.keyboard.press('Escape');
 const independent=await backup(page);expect(independent.bodyMeasurements.waist).toBe(77);expect(independent.topBody.waist).toBe(76);
});
test('copy retains an incompatible measured waist while the product refuses its drape without changing the pattern',async({page})=>{
 await page.goto('/');await measured(page,'95');await page.getByRole('button',{name:copyName,exact:true}).click();await page.getByRole('button',{name:'Back to garment',exact:true}).click();await bodyTools(page);
 await expect(page.getByLabel('Body waist girth (cm, optional)',{exact:true})).toHaveValue('95');
 const before=await backup(page);await page.getByRole('button',{name:'Drape on a body',exact:true}).click();await expect(page.locator('#garment-drape-status')).toContainText('waist must be at least 1 cm smaller');expect(await backup(page)).toEqual(before);
});
