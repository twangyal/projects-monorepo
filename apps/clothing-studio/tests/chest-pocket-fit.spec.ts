import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function download(page:Page,name:string){const pending=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();return readFile((await(await pending).path())!);}
async function backup(page:Page){return JSON.parse((await download(page,'Export project backup')).toString());}
async function setup(page:Page){await page.goto('/');await page.getByRole('button',{name:'Templates',exact:true}).click();await page.getByRole('button',{name:/^Use the Blank tee template/}).click();await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();await page.locator('#fit-panel summary').click();}
const width=(page:Page)=>page.getByLabel('Chest pocket width (cm)',{exact:true});
async function edit(page:Page){for(const [label,value] of [['Chest pocket width','10'],['Chest pocket height','16'],['Pocket centre offset','-8'],['Pocket top placement','20']])await page.getByLabel(`${label} (cm)`,{exact:true}).fill(value);await page.locator('#apply-fit').click();}

test('pocket dimensions and side placement link real pattern, GLB, tech pack and recovery',async({page})=>{
 test.setTimeout(90000);await setup(page);await expect(width(page)).toBeHidden();await page.locator('#product-chest-pocket').check();await expect(width(page)).toBeVisible({timeout:2500});const original=await backup(page);await edit(page);await expect(page.locator('#message')).toContainText('Fit applied');
 const box=await page.locator('[data-piece="chestPocket"] polygon').evaluate(p=>{const b=(p as SVGGraphicsElement).getBBox();return{width:b.width,height:b.height};});expect(box).toEqual({width:10,height:18.5});
 const saved=await backup(page);expect(saved.product.fit).toEqual({chestPocketWidth:10,chestPocketHeight:16,chestPocketX:-8,chestPocketY:20});
 await page.getByRole('button',{name:'Exports',exact:true}).click();const glb=await download(page,'Export 3D model (GLB) ↓'),length=glb.readUInt32LE(12),json=JSON.parse(glb.subarray(20,20+length).toString()),node=json.nodes.find((n:{name:string})=>n.name==='Chest pocket'),a=json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION],v=json.bufferViews[a.bufferView],offset=28+length+(v.byteOffset??0)+(a.byteOffset??0),xs:number[]=[];
 for(let i=0;i<a.count;i++)xs.push(glb.readFloatLE(offset+i*12));expect(Math.min(...xs)).toBeCloseTo(-13,5);expect(Math.max(...xs)).toBeCloseTo(-3,5);
 await page.getByRole('button',{name:'Tech pack',exact:true}).click();for(const [code,value] of [['P','10'],['Q','16'],['R','20'],['V','-8']])await expect(page.locator('#techpack-preview tr').filter({has:page.locator(`td:first-child:text-is("${code}")`)}).locator('td').nth(6)).toHaveText(value);await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await backup(page)).product).toEqual(original.product);await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('#save-state')).toHaveText('Locally saved');await page.reload();expect((await backup(page)).product).toEqual(saved.product);
});
test('pocket edits refuse crossing the front panel atomically and preserve raw drafts and disabled settings',async({page})=>{
 test.setTimeout(90000);await setup(page);await page.locator('#product-chest-pocket').check();const original=await backup(page);await width(page).fill('20');await page.getByLabel('Pocket centre offset (cm)',{exact:true}).fill('22');await page.locator('#apply-fit').click();await expect(page.locator('#message')).toContainText('front panel');expect((await backup(page)).product).toEqual(original.product);
 await page.getByRole('button',{name:'Materials & prints',exact:true}).click();await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();await expect(width(page)).toHaveValue('20');await page.locator('#product-chest-pocket').click();await expect(page.locator('#product-chest-pocket')).toBeChecked();await expect(page.locator('#message')).toContainText('Apply or discard');
 await page.getByRole('button',{name:'Discard all product drafts',exact:true}).click();await edit(page);const fit=(await backup(page)).product.fit;await page.locator('#product-chest-pocket').uncheck();await expect(width(page)).toBeHidden();expect((await backup(page)).product.fit).toEqual(fit);await page.locator('#product-chest-pocket').check();await expect(width(page)).toHaveValue('10');await page.locator('#reset-fit').click();await expect(width(page)).toHaveValue('12');expect((await backup(page)).product.fit).toBeUndefined();await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(width(page)).toHaveValue('10');
});
test('phone pocket construction controls are contextual and rerun the actual drape input',async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width:390,height:900});await page.addInitScript(()=>{const Native=Worker;window.Worker=class extends Native{constructor(...args:ConstructorParameters<typeof Worker>){super(...args);if(String(args[0]).includes('garment-drape.worker')){const native=this.postMessage.bind(this);this.postMessage=((message:unknown)=>{Object.assign(window,{lastPocketInput:structuredClone(message)});native(message);}) as typeof this.postMessage;}}};});
 await setup(page);await page.locator('#product-chest-pocket').check();await page.getByRole('button',{name:'Body & drape',exact:true}).click();await page.getByRole('button',{name:'Drape on a body',exact:true}).click();await expect(page.locator('#garment-drape-status')).toContainText('Draped on a body',{timeout:60000});await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();await edit(page);await expect(page.locator('#garment-drape-status')).toContainText('Draped on a body',{timeout:60000});
 const input=await page.evaluate(()=>(window as unknown as{lastPocketInput:{product:{fit:Record<string,number>}}}).lastPocketInput);expect(input.product.fit).toEqual({chestPocketWidth:10,chestPocketHeight:16,chestPocketX:-8,chestPocketY:20});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('untouched pocket placement remains derived through repeated and simultaneous fit edits',async({page})=>{
 test.setTimeout(90000);await setup(page);await page.locator('#product-chest-pocket').check();
 await page.getByLabel('Shoulder drop (cm)',{exact:true}).fill('6');await page.locator('#apply-fit').click();
 await page.locator('#apply-fit').click();expect((await backup(page)).product.fit).toEqual({shoulderDrop:6});
 await page.getByLabel('Shoulder drop (cm)',{exact:true}).fill('7');await page.getByLabel('Pocket centre offset (cm)',{exact:true}).fill('-8');await page.locator('#apply-fit').click();
 expect((await backup(page)).product.fit).toEqual({shoulderDrop:7,chestPocketX:-8});await expect(page.getByLabel('Pocket top placement (cm)',{exact:true})).toHaveValue('20');
 await page.getByLabel('Pocket top placement (cm)',{exact:true}).fill('22');await page.locator('#apply-fit').click();await page.getByLabel('Shoulder drop (cm)',{exact:true}).fill('6');await page.locator('#apply-fit').click();
 expect((await backup(page)).product.fit).toEqual({shoulderDrop:6,chestPocketX:-8,chestPocketY:22});
});
