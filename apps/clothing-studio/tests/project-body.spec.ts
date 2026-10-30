import {pngUrl} from './helpers/raster.ts';
import {createProject} from '../src/model.ts';
import {template} from '../src/product.ts';
import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const chest=(p:Page)=>p.getByLabel('Body chest girth (cm)',{exact:true});
async function backup(page:Page){const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export project backup',exact:true}).click();return JSON.parse(await readFile((await(await download).path())!,'utf8'));}
for(const width of [1440,390])test(`project keeps applied fitting measurements and separate drafts at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('/');await page.getByRole('button',{name:'Templates',exact:true}).click();await page.getByRole('button',{name:/^Use the Blank tee template/}).click();await page.getByRole('button',{name:'Body & drape',exact:true}).click();
 expect((await backup(page)).topBody).toBeUndefined();await chest(page).fill('100');await page.getByText('Waist, hip, depth, height and arms (optional)',{exact:true}).click();await page.getByLabel('Body waist girth (cm, optional)',{exact:true}).fill('88');await page.getByLabel('Chest front-to-back depth (cm, optional)',{exact:true}).fill('22');
 expect((await backup(page)).topBody).toBeUndefined();await page.getByRole('button',{name:'Apply body settings',exact:true}).click();const applied=await backup(page);expect(applied.topBody).toEqual({chest:100,waist:88,hip:null,chestDepth:22});
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(chest(page)).toHaveValue('94');expect((await backup(page)).topBody).toBeUndefined();await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(chest(page)).toHaveValue('100');
 await chest(page).fill('105');await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(chest(page)).toHaveValue('105');await expect(page.locator('#message')).toContainText('Apply or discard');await page.getByRole('button',{name:'Discard all product drafts',exact:true}).click();await expect(chest(page)).toHaveValue('100');await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(chest(page)).toHaveValue('94');await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(chest(page)).toHaveValue('100');
 await expect(page.locator('#save-state')).toContainText('Locally saved');await page.reload();await page.getByRole('button',{name:'Body & drape',exact:true}).click();await expect(chest(page)).toHaveValue('100');await expect(page.getByLabel('Body waist girth (cm, optional)',{exact:true})).toHaveValue('88');expect((await backup(page)).topBody).toEqual(applied.topBody);
 const different={...applied,topBody:{chest:110,waist:null,hip:120,chestDepth:24}};await page.getByLabel('Import project backup',{exact:true}).setInputFiles({name:'body.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(different))});await expect(chest(page)).toHaveValue('110');await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(chest(page)).toHaveValue('100');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('a named design reopens its applied body independently of the current design and saved presets',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Body & drape',exact:true}).click();await chest(page).fill('100');await page.getByRole('button',{name:'Apply body settings',exact:true}).click();
 await page.getByRole('button',{name:'Saved designs',exact:true}).click();await page.getByLabel('Saved design name',{exact:true}).fill('Body 100');await page.getByRole('button',{name:'Save named copy',exact:true}).click();await expect(page.locator('#design-library-status')).toContainText('Saved');await page.keyboard.press('Escape');await page.getByRole('button',{name:'Body & drape',exact:true}).click();
 await chest(page).fill('110');await page.getByRole('button',{name:'Apply body settings',exact:true}).click();await page.getByRole('button',{name:'Saved designs',exact:true}).click();const id=await page.locator('#design-library-select option').evaluateAll(nodes=>(nodes as HTMLOptionElement[]).find(n=>n.textContent?.startsWith('Body 100 ·'))!.value);await page.locator('#design-library-select').selectOption(id);page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Open selected design',exact:true}).click();await expect(page.locator('#design-library-status')).toContainText('Opened');await page.keyboard.press('Escape');await page.getByRole('button',{name:'Body & drape',exact:true}).click();await expect(chest(page)).toHaveValue('100');await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(chest(page)).toHaveValue('110');
});

test('a rejected size-limit body edit keeps all applied data and body drafts',async({page})=>{
 test.setTimeout(90000);await page.goto('/');
 const incoming={...createProject(),product:template('blank')};incoming.title='Full design';
 incoming.product.motifs=Array.from({length:6},(_,i)=>({id:`m${i}`,name:'motif',dataUrl:pngUrl(768,768,500000),width:768,height:768}));
 incoming.product.artwork=(['front','back'] as const).map(part=>({part,name:'art',dataUrl:pngUrl(1024,1024,1500000),width:1024,height:1024,xCm:0,yCm:10,widthCm:20}));
 const size=()=>Buffer.byteLength(JSON.stringify(incoming,null,2)),cap=6*1024*1024;
 incoming.note+='a'.repeat((cap-size())%4);incoming.product.artwork[0].dataUrl=pngUrl(1024,1024,1500000+cap-size());expect(size()).toBe(cap);
 await page.getByLabel('Import project backup',{exact:true}).setInputFiles({name:'full.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});await expect(page.locator('#message')).toContainText('Project backup restored',{timeout:30000});
 await page.getByRole('button',{name:'Body & drape',exact:true}).click();await chest(page).fill('105');
 for(const name of ['Apply body settings','Drape on a body']){
  await page.getByRole('button',{name,exact:true}).click();await expect(page.locator('#message')).toContainText('6 MiB');await expect(page.locator('#product-draft-state')).toContainText('Unapplied');await expect(chest(page)).toHaveValue('105');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('#message')).toContainText('Apply or discard');expect((await backup(page)).topBody).toBeUndefined();
 }
 await page.getByRole('button',{name:'Materials & prints',exact:true}).click();await page.getByRole('button',{name:'Body & drape',exact:true}).click();await expect(chest(page)).toHaveValue('105');expect(await backup(page)).toEqual(incoming);
});
