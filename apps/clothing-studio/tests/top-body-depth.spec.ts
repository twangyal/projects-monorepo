import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import type {GarmentDrapeResult} from '../src/garment-drape.ts';

async function setup(page:Page){
 await page.addInitScript(()=>{const Native=Worker;window.Worker=class extends Native{
  constructor(...args:ConstructorParameters<typeof Worker>){super(...args);if(String(args[0]).includes('garment-drape.worker'))this.addEventListener('message',event=>{if(event.data.kind==='result')Object.assign(window,{depthResult:event.data.result});});}
 };});
 await page.goto('/');await page.getByRole('button',{name:'Templates',exact:true}).click();await page.getByRole('button',{name:/^Use the Blank tee template/}).click();
 await page.getByRole('button',{name:'Body & drape',exact:true}).click();await page.getByText('Waist, hip and depth (optional)',{exact:true}).click();
}
async function backup(page:Page){const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export project backup',exact:true}).click();return readFile((await(await pending).path())!,'utf8');}
const depth=(page:Page)=>page.getByLabel('Chest front-to-back depth (cm, optional)',{exact:true});
for(const width of [1440,390])test(`entered chest depth reaches actual garment worker and captured GLB at ${width}px`,async({page},info)=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:900});await setup(page);const before=await backup(page);
 await depth(page).fill('20');await page.getByRole('button',{name:'Drape on a body',exact:true}).click();
 await expect(page.locator('#garment-drape-status')).toContainText('20 cm chest depth',{timeout:60000});
 const result=await page.evaluate(()=>(window as unknown as{depthResult:GarmentDrapeResult}).depthResult);
 expect(result.body.chest).toBe(94);expect(result.body.chestDepth).toBe(20);expect(result.body.torso[1]!.halfDepth*2).toBeCloseTo(20,10);
 const section=result.body.torso[1]!;expect(4*(section.halfWidth-section.halfDepth)+2*Math.PI*section.halfDepth).toBeCloseTo(94,9);
 expect(await backup(page)).toBe(before);await page.screenshot({path:info.outputPath(`chest-depth-${width}.png`),fullPage:true});
 await page.getByRole('button',{name:'Exports',exact:true}).click();const pending=page.waitForEvent('download');await page.locator('#product-glb').click();
 const glb=await readFile((await(await pending).path())!),length=glb.readUInt32LE(12),json=JSON.parse(glb.subarray(20,20+length).toString()),node=json.nodes.find((n:{name:string})=>n.name==='Front body'),accessor=json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION],view=json.bufferViews[accessor.bufferView],at=28+length+(view.byteOffset??0)+(accessor.byteOffset??0);
 expect(Array.from({length:accessor.count*3},(_,i)=>glb.readFloatLE(at+i*4))).toEqual(Object.values(result.parts.find(p=>p.part==='front')!.positions));
 await page.getByRole('button',{name:'Body & drape',exact:true}).click();await expect(depth(page)).toHaveValue('20');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('impossible depth/girth refuses atomically and raw depth drafts survive until deliberate discard',async({page})=>{
 await setup(page);const before=await backup(page);await page.getByLabel('Body chest girth (cm)',{exact:true}).fill('70');await depth(page).fill('30');
 await page.getByRole('button',{name:'Apply body settings',exact:true}).click();await expect(page.locator('#message')).toContainText('Chest depth cannot exceed');
 await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();await page.getByRole('button',{name:'Body & drape',exact:true}).click();await expect(depth(page)).toHaveValue('30');
 await page.getByRole('button',{name:'New concept',exact:true}).click();await expect(page.locator('#message')).toContainText('Apply or discard');
 await page.getByRole('button',{name:'Discard all product drafts',exact:true}).click();await expect(depth(page)).toHaveValue('');await expect(page.getByLabel('Body chest girth (cm)',{exact:true})).toHaveValue('94');expect(await backup(page)).toBe(before);
 await depth(page).pressSequentially('1e');expect(await depth(page).evaluate(e=>(e as HTMLInputElement).validity.badInput)).toBe(true);
 await page.getByRole('button',{name:'Apply body settings',exact:true}).click();await expect(page.locator('#message')).toContainText('complete body');
 await page.getByRole('button',{name:'Discard all product drafts',exact:true}).click();expect(await depth(page).evaluate(e=>(e as HTMLInputElement).validity.badInput)).toBe(false);
});

test('changing only chest depth retires an actual held older drape result',async({page})=>{
 test.setTimeout(90000);await page.addInitScript(()=>{const Native=Worker;let first=true;window.Worker=class extends Native{
  constructor(...args:ConstructorParameters<typeof Worker>){super(...args);if(String(args[0]).includes('garment-drape.worker'))this.addEventListener('message',event=>{if(event.data.kind==='result'&&first){first=false;event.stopImmediatePropagation();Object.assign(window,{depthWaiting:true,releaseDepth:()=>this.dispatchEvent(new MessageEvent('message',{data:event.data}))});}});}
 };});
 await setup(page);await page.getByRole('button',{name:'Drape on a body',exact:true}).click();await page.waitForFunction(()=>(window as unknown as{depthWaiting:boolean}).depthWaiting,null,{timeout:60000});
 await depth(page).fill('20');await page.getByRole('button',{name:'Apply body settings',exact:true}).click();await expect(page.locator('#garment-drape-status')).toContainText('20 cm chest depth',{timeout:60000});
 await page.evaluate(()=>(window as unknown as{releaseDepth:()=>void}).releaseDepth());await expect(page.locator('#garment-drape-status')).toContainText('20 cm chest depth');
});

test('matched fabric receipt captures depth and changing that depth invalidates the comparison',async({page})=>{
 test.setTimeout(90000);await setup(page);await depth(page).fill('20');await page.getByRole('button',{name:'Apply body settings',exact:true}).click();
 await page.getByText('Compare fabrics on this garment',{exact:true}).click();await page.getByRole('button',{name:'Compare garment fabrics',exact:true}).click();await expect(page.locator('#garment-comparison-status')).toContainText('20 cm chest depth',{timeout:60000});
 const pending=page.waitForEvent('download');await page.locator('#garment-comparison-download').click();const data=JSON.parse(await readFile((await(await pending).path())!,'utf8'));
 expect(data.body.chestDepth).toBe(20);expect(data.candidates.map((c:{result:GarmentDrapeResult})=>c.result.body.chestDepth)).toEqual([20,20]);
 await depth(page).fill('22');await page.getByRole('button',{name:'Apply body settings',exact:true}).click();await expect(page.locator('#garment-comparison-download')).toBeDisabled();await expect(page.locator('#garment-comparison-results')).toBeEmpty();
});
