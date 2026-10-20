import {expect,test,type Page}from'@playwright/test';
import{readFile}from'node:fs/promises';
import type{Project}from'../src/model.ts';
declare global{interface Window{libraryDecode:{hold:boolean;waiting:boolean;release:()=>void}}}
async function decodeGate(page:Page){await page.addInitScript(()=>{window.libraryDecode={hold:false,waiting:false,release:()=>{}};const decode=createImageBitmap.bind(window);window.createImageBitmap=(async(...args:Parameters<typeof createImageBitmap>)=>{const bitmap=await decode(...args);if(window.libraryDecode.hold){window.libraryDecode.hold=false;window.libraryDecode.waiting=true;await new Promise<void>(resolve=>{window.libraryDecode.release=resolve;});}return bitmap;})as typeof createImageBitmap;});}
async function fixture(page:Page):Promise<Project>{
 await page.goto('/tests/storage-harness.html');await expect.poll(()=>page.evaluate(()=>!!window.clothingStorage)).toBe(true);
 return page.evaluate(()=>{
  const p=window.clothingStorage.createProject(),canvas=document.createElement('canvas');canvas.width=canvas.height=16;canvas.getContext('2d')!.fillRect(0,0,16,16);const png=canvas.toDataURL('image/png');
  p.title='Complete design 🌓';p.note='Original private note';p.photo={dataUrl:canvas.toDataURL('image/jpeg'),width:16,height:16,name:'private.jpg'};p.strokes=[{id:'s1',color:'#123456',width:2,points:[{x:.1,y:.2},{x:.4,y:.5}]}];
  p.construction={kind:'flared-skirt',waist:80,hem:140,slant:60,allowances:{seam:1,hem:2},waistband:{height:4,overlap:2},fabric:'cotton'};p.grading={waistStep:4,hemStep:6,slantStep:1,steps:1};p.bodyMeasurements={waist:76,hip:100,hipDepth:20};
  p.product=window.clothingStorage.template('breton');p.product.fit={backNeckDrop:4};p.product.spec={styleNumber:'A1',season:'Autumn',sampleSize:'M'};
  p.product.motifs=[{id:'m1',name:'Private motif',dataUrl:png,width:16,height:16}];p.product.parts.front.print={motif:'upload:m1',color:'#123456',scaleCm:8,layout:'half-drop'};
  p.product.artwork=[{part:'front',dataUrl:png,width:16,height:16,name:'Private art',xCm:0,yCm:8,widthCm:8,rotation:20}];p.product.colorways=[{id:'c1',name:'Navy',parts:structuredClone(p.product.parts),units:50}];p.product.costing={currency:'USD',retail:35,make:3,trims:.5,printPerArtwork:1,fabricPrices:{'jersey-240':8,'rib-220':9}};
  return p;
 });
}
async function importProject(page:Page,p:Project){await page.goto('/');await page.getByLabel('Import project backup',{exact:true}).setInputFiles({name:'complete.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});await expect(page.locator('#message')).toContainText('Project backup restored');await expect(page.locator('#save-state')).toHaveText('Locally saved');}
async function library(page:Page){await page.getByRole('button',{name:'Saved designs',exact:true}).click();await expect(page.getByRole('dialog',{name:'Saved designs',exact:true})).toBeVisible();}
async function saveCopy(page:Page,name:string){await page.getByRole('textbox',{name:'Saved design name',exact:true}).fill(name);await page.getByRole('button',{name:'Save named copy',exact:true}).click();await expect(page.locator('#design-library-status')).toContainText('Saved');}
async function chooseName(page:Page,name:string){const find=()=>page.locator('#design-library-select option').evaluateAll((nodes,name)=>(nodes as HTMLOptionElement[]).find(n=>n.textContent?.startsWith(name+' ·'))?.value,name);await expect.poll(find).toBeTruthy();const value=await find();await page.locator('#design-library-select').selectOption(value!);}
async function downloadCurrent(page:Page){const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export project backup',exact:true}).click();return JSON.parse(await readFile((await(await pending).path())!,'utf8'))as Project;}

test('named full designs round-trip through workspace open history reload downloads and confirmed deletion',async({page})=>{
 const p=await fixture(page);await importProject(page,p);await library(page);await saveCopy(page,'Version A');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'New concept',exact:true}).click();const newer=await downloadCurrent(page);
 await library(page);await chooseName(page,'Version A');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Open selected design',exact:true}).click();await expect(page.locator('#design-library-status')).toContainText('Opened');await page.keyboard.press('Escape');expect(await downloadCurrent(page)).toEqual(p);
 await page.locator('#undo').click();expect(await downloadCurrent(page)).toEqual(newer);await page.locator('#redo').click();expect(await downloadCurrent(page)).toEqual(p);await expect(page.locator('#save-state')).toHaveText('Locally saved');
 await page.reload();await expect(page.locator('#photo-name')).toHaveText('private.jpg');await library(page);await chooseName(page,'Version A');
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download selected backup',exact:true}).click();expect(JSON.parse(await readFile((await(await pending).path())!,'utf8'))).toEqual(p);
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Delete selected design',exact:true}).click();await expect(page.locator('#design-library-select option')).toHaveCount(2);
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Delete selected design',exact:true}).click();await expect(page.locator('#design-library-select option')).toHaveCount(1);await page.keyboard.press('Escape');expect(await downloadCurrent(page)).toEqual(p);
});

test('phone dialog keeps its name draft and refuses unapplied garment fields',async({page})=>{
 await page.setViewportSize({width:390,height:740});const p=await fixture(page);await importProject(page,p);
 await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();await page.getByLabel('Body length (cm)',{exact:true}).fill('');await page.keyboard.press('Escape');await library(page);await page.getByRole('textbox',{name:'Saved design name',exact:true}).fill('Phone version');await page.getByRole('button',{name:'Save named copy',exact:true}).click();await expect(page.locator('#message')).toContainText('draft');
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Saved designs',exact:true})).toBeFocused();await library(page);await expect(page.getByRole('textbox',{name:'Saved design name',exact:true})).toHaveValue('Phone version');
 expect(await page.getByRole('dialog',{name:'Saved designs',exact:true}).evaluate(d=>d.scrollWidth<=d.clientWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();await expect(page.getByLabel('Body length (cm)',{exact:true})).toHaveValue('');
 await page.getByRole('button',{name:'Discard all product drafts',exact:true}).click();await page.keyboard.press('Escape');await library(page);await saveCopy(page,'Phone version');await page.getByRole('dialog',{name:'Saved designs',exact:true}).screenshot({path:'/tmp/clothing295-phone.png'});
});

test('late library image admission cannot replace newer editing or steal focus',async({page})=>{
 await decodeGate(page);const p=await fixture(page);await page.evaluate(async p=>{await window.clothingDesignLibrary.saveDesign('Old image design',p);await window.clothingStorage.saveProject(window.clothingStorage.createProject());},p);await page.goto('/');await expect(page.locator('#save-state')).toHaveText('Locally saved');await library(page);await chooseName(page,'Old image design');
 await page.evaluate(()=>{window.libraryDecode.hold=true;});page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Open selected design',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.libraryDecode.waiting)).toBe(true);await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Concept sketch',exact:true}).click();await page.locator('#note').fill('Newer note wins');await page.evaluate(()=>window.libraryDecode.release());await expect(page.locator('#design-library-status')).toContainText('kept');await expect(page.locator('#note')).toHaveValue('Newer note wins');await expect(page.locator('#note')).toBeFocused();await expect(page.locator('#photo-name')).toHaveText('Sample silhouette');
});

test('pending save retains captured complete work while current note and newer library name stay editable',async({page})=>{
 await decodeGate(page);const p=await fixture(page);await importProject(page,p);await library(page);await page.getByRole('textbox',{name:'Saved design name',exact:true}).fill('Captured A');await page.evaluate(()=>{window.libraryDecode.hold=true;});await page.getByRole('button',{name:'Save named copy',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.libraryDecode.waiting)).toBe(true);
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Concept sketch',exact:true}).click();await page.locator('#note').fill('Newer note');await page.keyboard.press('Escape');await library(page);await page.getByRole('textbox',{name:'Saved design name',exact:true}).fill('Newer name');await page.evaluate(()=>window.libraryDecode.release());await expect(page.locator('#design-library-status')).toContainText('Saved');await expect(page.getByRole('textbox',{name:'Saved design name',exact:true})).toHaveValue('Newer name');
 await chooseName(page,'Captured A');const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download selected backup',exact:true}).click();expect(JSON.parse(await readFile((await(await pending).path())!,'utf8'))).toEqual(p);await page.keyboard.press('Escape');await page.getByRole('button',{name:'Concept sketch',exact:true}).click();await expect(page.locator('#note')).toHaveValue('Newer note');
});
