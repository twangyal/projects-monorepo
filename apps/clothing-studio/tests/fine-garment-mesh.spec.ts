import {test,expect,type Page} from './helpers/expanded-workspace.ts';
import {readFile} from 'node:fs/promises';
import Delaunator from 'delaunator';
import {teeMesh,template} from '../src/product.ts';
import type {GarmentDrapeResult} from '../src/garment-drape.ts';

test.setTimeout(120000);
async function setup(page:Page){
 await page.addInitScript(()=>{
  const probe={result:null as unknown,starts:0,stops:0};Object.assign(window,{fineProbe:probe});const Native=Worker;
  window.Worker=class extends Native{constructor(...args:ConstructorParameters<typeof Worker>){super(...args);probe.starts++;this.addEventListener('message',e=>{if(e.data.kind==='result')probe.result=e.data.result;});}terminate(){probe.stops++;super.terminate();}};
 });
 await page.goto('/');await page.locator('#product-editor').getByRole('button',{name:/^Use the Ringer tee template/}).click();
 await expect(page.locator('#garment-drape-quality')).toHaveValue('standard');
}
async function download(page:Page,id:string){const [file]=await Promise.all([page.waitForEvent('download',{timeout:60000}),page.locator(`#${id}`).click({timeout:10000})]);return readFile((await file.path())!);}
function glbJson(bytes:Buffer){return JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());}
async function result(page:Page){return page.evaluate(()=>(window as unknown as {fineProbe:{result:GarmentDrapeResult}}).fineProbe.result);}

test('Fine drape reaches preview, captured GLB positions and PNG without changing the cut pattern',async({page})=>{
 await setup(page);const before=await download(page,'pattern-svg');await page.locator('#garment-drape-quality').selectOption('fine');await page.locator('#garment-drape-on').click();
 await expect(page.locator('#garment-drape-status')).toContainText('Draped on a body',{timeout:100000});await expect(page.locator('#garment-drape-status')).toContainText('Fine');
 const settled=await result(page);expect(settled.settings.meshQuality).toBe('fine');expect(settled.settings.substeps).toBe(48);expect(Number.isFinite(settled.metrics.maxStrain)).toBe(true);expect(settled.metrics.minClearance).toBeGreaterThan(0);
 const mesh=teeMesh(template('ringer'),Delaunator,'fine').find(p=>p.part==='front')!;
 expect(Object.keys(settled.parts.find(p=>p.part==='front')!.positions)).toHaveLength(mesh.positions.length);
 const glb=await download(page,'product-glb'),json=glbJson(glb),node=json.nodes.find((n:{name:string})=>n.name==='Front body'),primitive=json.meshes[node.mesh].primitives[0],accessor=json.accessors[primitive.attributes.POSITION];
 expect(accessor.count).toBe(mesh.positions.length/3);expect(json.accessors[primitive.indices].count).toBe(mesh.indices.length);
 const view=json.bufferViews[accessor.bufferView],at=28+glb.readUInt32LE(12)+(view.byteOffset??0)+(accessor.byteOffset??0),positions=Object.values(settled.parts.find(p=>p.part==='front')!.positions);
 expect(Array.from({length:accessor.count*3},(_,i)=>glb.readFloatLE(at+i*4))).toEqual(positions);
 const png=await download(page,'product-png-front');expect(png.readUInt32BE(16)).toBeGreaterThan(100);expect(await download(page,'pattern-svg')).toEqual(before);await page.reload();await expect(page.locator('#garment-drape-quality')).toHaveValue('standard');
});

test('Fine outfit exports refine the primary and worn garment together',async({page})=>{
 await setup(page);await page.getByRole('combobox',{name:'Wear with',exact:true}).selectOption({label:'Straight trousers'});await page.locator('#garment-drape-quality').selectOption('fine');await page.locator('#garment-drape-on').click();
 await expect(page.locator('#garment-drape-status')).toContainText('Draped on a body',{timeout:100000});const settled=await result(page);expect(settled.companion?.settings.meshQuality).toBe('fine');expect(settled.companion?.settings.substeps).toBe(48);
 await page.locator('#export-outfit').check();const json=glbJson(await download(page,'product-glb'));
 const primary=json.nodes.find((n:{name:string})=>n.name==='Front body'),worn=json.nodes.find((n:{name:string})=>n.name?.includes('Straight trousers: Front legs'));
 expect(primary).toBeTruthy();expect(worn).toBeTruthy();
 for(const [node,parts] of [[primary,settled.parts],[worn,settled.companion!.parts]] as const){const a=json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION];expect(a.count*3).toBe(Object.keys(parts.find(p=>p.part==='front')!.positions).length);}
});

test('changing mesh quality retires an in-flight solve and shell mode cancels the replacement',async({page})=>{
 await setup(page);await page.locator('#garment-drape-on').click();await expect.poll(()=>page.evaluate(()=>(window as unknown as {fineProbe:{starts:number}}).fineProbe.starts)).toBe(1);
 await page.locator('#garment-drape-quality').selectOption('fine');await expect.poll(()=>page.evaluate(()=>(window as unknown as {fineProbe:{stops:number}}).fineProbe.stops)).toBeGreaterThan(0);
 await page.locator('#garment-drape-off').click();await expect(page.locator('#garment-drape-on')).toBeVisible();await expect(page.locator('#garment-drape-status')).not.toContainText('Draping on the body');
});

test('an unfinished product measurement keeps its draft and refuses a mesh change',async({page})=>{
 await setup(page);const chest=page.getByLabel('Chest (cm)',{exact:true});await chest.fill('');await page.locator('#garment-drape-quality').selectOption('fine');
 await expect(page.locator('#garment-drape-quality')).toHaveValue('standard');await expect(chest).toHaveValue('');await expect(page.locator('#message')).toContainText('Apply or discard');
});
