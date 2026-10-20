import {test,expect,type Page} from './helpers/expanded-workspace.ts';
import {readFile} from 'node:fs/promises';
async function backup(page:Page){const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Export project backup',exact:true}).click();const file=await wait;return JSON.parse(await readFile((await file.path())!,'utf8'));}
async function setup(page:Page){page.setDefaultTimeout(15000);await page.goto('/');await page.getByRole('button',{name:/^Use the Ringer tee template/}).click();for(const n of ['First','Second']){await page.getByLabel('Colorway name',{exact:true}).fill(n);await page.getByRole('button',{name:'Save as colorway',exact:true}).click();}}
test('saved colorway names and quantities apply atomically with undo, exports and reload',async({page})=>{
 test.setTimeout(120000);await setup(page);const original=await backup(page);
 await page.getByLabel('Saved name for First',{exact:true}).fill('Warm <red>');
 await page.getByLabel('Units for First',{exact:true}).fill('123');
 await page.getByLabel('Saved name for Second',{exact:true}).fill('Cool navy');
 await page.getByLabel('Units for Second',{exact:true}).fill('45');
 expect((await backup(page)).product).toEqual(original.product);
 await page.getByRole('button',{name:'Apply colorway details',exact:true}).click();
 const edited=(await backup(page)).product;
 expect(edited.colorways.map((c:{name:string;units:number})=>[c.name,c.units])).toEqual([['Warm <red>',123],['Cool navy',45]]);
 expect(edited.parts).toEqual(original.product.parts);expect(edited.colorways.map((c:{parts:unknown})=>c.parts)).toEqual(original.product.colorways.map((c:{parts:unknown})=>c.parts));
 await expect(page.locator('#range-table')).toContainText('Warm <red>');await expect(page.locator('.range-total')).toContainText('168');
 await expect(page.getByRole('img',{name:'Front render of Warm <red>'})).toBeVisible();
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await backup(page)).product).toEqual(original.product);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect((await backup(page)).product).toEqual(edited);
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Download range plan (Excel) ↓',exact:true}).click();const file=await dl;expect((await readFile((await file.path())!)).toString('utf8')).toContain('Cool navy');
 await expect(page.locator('#save-state')).toHaveText('Locally saved');await page.reload();expect((await backup(page)).product).toEqual(edited);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('invalid colorway drafts survive styling and block destructive or history actions until group discard',async({page})=>{
 test.setTimeout(120000);await setup(page);const original=(await backup(page)).product;
 await page.getByLabel('Saved name for First',{exact:true}).fill('');await page.getByLabel('Units for Second',{exact:true}).fill('1.5');
 await page.getByRole('button',{name:'Apply colorway details',exact:true}).click();expect((await backup(page)).product).toEqual(original);
 await expect(page.getByLabel('Saved name for First',{exact:true})).toHaveValue('');await expect(page.getByLabel('Units for Second',{exact:true})).toHaveValue('1.5');
 await page.getByRole('button',{name:'Apply color #1f2a4f',exact:true}).click();
 await expect(page.getByLabel('Saved name for First',{exact:true})).toHaveValue('');await expect(page.getByLabel('Units for Second',{exact:true})).toHaveValue('1.5');
 await page.getByRole('button',{name:'Delete First',exact:true}).click();expect((await backup(page)).product.colorways).toEqual(original.colorways);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('#message')).toContainText('Apply or discard');await expect(page.getByLabel('Saved name for First',{exact:true})).toHaveValue('');
 await page.getByRole('button',{name:'Discard colorway details',exact:true}).click();
 await expect(page.getByLabel('Saved name for First',{exact:true})).toHaveValue('First');await expect(page.getByLabel('Units for Second',{exact:true})).toHaveValue('0');
 for(const bad of ['', '-1','1.5','1000001']){
  await page.getByLabel('Saved name for First',{exact:true}).fill('Still pending');await page.getByLabel('Units for Second',{exact:true}).fill(bad);
  await page.getByRole('button',{name:'Apply colorway details',exact:true}).click();expect((await backup(page)).product.colorways).toEqual(original.colorways);
  await expect(page.getByLabel('Saved name for First',{exact:true})).toHaveValue('Still pending');
 }
 await page.getByRole('button',{name:'Discard colorway details',exact:true}).click();
 await page.getByRole('button',{name:'Delete First',exact:true}).click();expect((await backup(page)).product.colorways).toHaveLength(1);
});
test('a delayed motif decode keeps the focused saved-name draft and caret',async({page})=>{
 test.setTimeout(60000);
 await page.addInitScript(()=>{const decode=HTMLImageElement.prototype.decode;const state={armed:false,waiting:false,redraws:0,release:()=>{}};Object.assign(window,{rangeDecode:state});HTMLImageElement.prototype.decode=async function(){await decode.call(this);if(state.armed){state.armed=false;state.waiting=true;await new Promise<void>(resolve=>{state.release=resolve;});}};});
 await setup(page);
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=64;c.getContext('2d')!.fillRect(0,0,64,64);return c.toDataURL('image/png').split(',')[1]!;});
 await page.evaluate(()=>{(window as unknown as {rangeDecode:{armed:boolean}}).rangeDecode.armed=true;});
 await page.locator('#motif-file').setInputFiles({name:'held.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {rangeDecode:{waiting:boolean}}).rangeDecode.waiting)).toBe(true);
 const field=page.getByLabel('Saved name for First',{exact:true});await field.fill('Unfinished name');
 await field.evaluate(f=>(f as HTMLInputElement).setSelectionRange(4,7));
 await page.evaluate(()=>{const s=(window as unknown as {rangeDecode:{redraws:number}}).rangeDecode;new MutationObserver(()=>{s.redraws++;}).observe(document.getElementById('product-pieces')!,{childList:true});});
 await page.evaluate(()=>(window as unknown as {rangeDecode:{release:()=>void}}).rangeDecode.release());
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {rangeDecode:{redraws:number}}).rangeDecode.redraws)).toBeGreaterThan(0);
 await expect(field).toHaveValue('Unfinished name');await expect(field).toBeFocused();
 expect(await field.evaluate(f=>[(f as HTMLInputElement).selectionStart,(f as HTMLInputElement).selectionEnd])).toEqual([4,7]);
});
test('no-op apply preserves redo and applying colorways keeps other draft groups',async({page})=>{
 await setup(page);await page.getByLabel('Saved name for First',{exact:true}).fill('Renamed');await page.getByRole('button',{name:'Apply colorway details',exact:true}).click();
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await page.getByLabel('Saved name for First',{exact:true}).fill('First');await page.locator('#spec-style').fill('Pending spec');
 await page.getByRole('button',{name:'Apply colorway details',exact:true}).click();
 await expect(page.locator('#spec-style')).toHaveValue('Pending spec');
 await page.getByRole('button',{name:'Discard all product drafts',exact:true}).click();
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect((await backup(page)).product.colorways[0].name).toBe('Renamed');
});
test('phone range dialog retains drafts through close and deliberate apply',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);
 await page.getByRole('button',{name:'Focus on garment',exact:true}).click();
 await page.getByRole('button',{name:'Range plan',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Range plan',exact:true});await expect(dialog).toBeVisible();
 await dialog.getByLabel('Saved name for First',{exact:true}).fill('Phone edition');await dialog.getByLabel('Units for First',{exact:true}).fill('24');
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
 await page.getByRole('button',{name:'Range plan',exact:true}).click();await expect(dialog.getByLabel('Saved name for First',{exact:true})).toHaveValue('Phone edition');
 await dialog.getByRole('button',{name:'Apply colorway details',exact:true}).click();await expect(dialog.locator('#range-table')).toContainText('Phone edition');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await dialog.getByRole('button',{name:'Back to garment',exact:true}).click();await expect(page.getByRole('button',{name:'Range plan',exact:true})).toBeFocused();
 expect((await backup(page)).product.colorways[0]).toMatchObject({name:'Phone edition',units:24});
});
