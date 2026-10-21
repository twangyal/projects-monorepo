import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function download(page:Page,name:string){const pending=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();return readFile((await(await pending).path())!);}
async function backup(page:Page){return JSON.parse((await download(page,'Export project backup')).toString());}
async function setup(page:Page){await page.goto('/');await page.getByRole('button',{name:'Templates',exact:true}).click();await page.getByRole('button',{name:/^Use the Blank tee template/}).click();await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();await page.locator('#fit-panel summary').click();}
const field=(page:Page)=>page.getByLabel('Shoulder drop (cm)',{exact:true});
const handle=(page:Page)=>page.getByRole('slider',{name:'Shoulder height: Shoulder drop',exact:true});
test('shoulder drop updates actual patterns, GLB, tech pack, history and recovery',async({page})=>{
 await setup(page);await expect(field(page)).toBeVisible({timeout:2500});const original=await backup(page);
 await field(page).fill('6');await page.locator('#apply-fit').click();await expect(page.locator('#message')).toContainText('Fit applied');
 for(const side of ['front','back']){const points=((await page.locator(`[data-piece="${side}"] polygon`).getAttribute('points'))!).split(' ').map(p=>p.split(',').map(Number));expect(points.some(([x,y])=>x===51.22&&y===6)).toBe(true);}
 const saved=await backup(page);expect(saved.product.fit).toEqual({shoulderDrop:6});
 await page.getByRole('button',{name:'Exports',exact:true}).click();const glb=await download(page,'Export 3D model (GLB) ↓'),length=glb.readUInt32LE(12),json=JSON.parse(glb.subarray(20,20+length).toString());
 const node=json.nodes.find((n:{name:string})=>n.name==='Front body'),a=json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION],v=json.bufferViews[a.bufferView],offset=28+length+(v.byteOffset??0)+(a.byteOffset??0);let endpoint=false;
 for(let i=0;i<a.count;i++)if(Math.abs(glb.readFloatLE(offset+i*12)-24.22)<1e-4&&Math.abs(glb.readFloatLE(offset+i*12+4)-66)<1e-4)endpoint=true;expect(endpoint).toBe(true);
 await page.getByRole('button',{name:'Tech pack',exact:true}).click();await expect(page.locator('#techpack-preview tr').filter({has:page.locator('td:first-child:text-is("U")')}).locator('td').nth(6)).toHaveText('6');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await backup(page)).product).toEqual(original.product);await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('#save-state')).toHaveText('Locally saved');await page.reload();expect((await backup(page)).product).toEqual(saved.product);
});
test('shoulder-height handle supports keyboard and pointer without overwriting pending fit drafts',async({page})=>{
 await setup(page);await expect(handle(page)).toHaveAttribute('aria-valuenow','4');await expect(handle(page)).toHaveAttribute('aria-orientation','vertical');
 const width=page.getByRole('slider',{name:'Shoulder point: Shoulder width',exact:true});expect(Number(await handle(page).getAttribute('cx'))).toBeGreaterThan(Number(await width.getAttribute('cx')));
 await handle(page).focus();await page.keyboard.press('ArrowDown');await expect(handle(page)).toHaveAttribute('aria-valuenow','4.5');await expect(handle(page)).toBeFocused();expect((await backup(page)).product.fit).toEqual({shoulderDrop:4.5});
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(handle(page)).toHaveAttribute('aria-valuenow','4');
 await field(page).fill('5.50');await handle(page).focus();await page.keyboard.press('ArrowDown');await expect(page.locator('#message')).toContainText('pending fit edits');await expect(field(page)).toHaveValue('5.50');await expect(handle(page)).toHaveAttribute('aria-valuenow','4');
 await page.getByRole('button',{name:'Discard all product drafts',exact:true}).click();await handle(page).scrollIntoViewIfNeeded();const box=(await handle(page).boundingBox())!;
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2+9,{steps:3});await page.mouse.up();
 const value=Number(await handle(page).getAttribute('aria-valuenow'));expect(value).toBeGreaterThan(4);expect(value*2%1).toBe(0);expect((await backup(page)).product.fit).toEqual({shoulderDrop:value});
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(handle(page)).toHaveAttribute('aria-valuenow','4');
});
test('phone shoulder-drop drafts survive navigation and invalid Apply until reset',async({page},info)=>{
 await page.setViewportSize({width:390,height:900});await setup(page);const before=await backup(page);await field(page).fill('9');
 await page.getByRole('button',{name:'Materials & prints',exact:true}).click();await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();await expect(field(page)).toHaveValue('9');await page.locator('#apply-fit').click();await expect(page.locator('#message')).toContainText('Shoulder drop');expect(await backup(page)).toEqual(before);
 await field(page).fill('6');await page.locator('#apply-fit').click();await expect(field(page)).toHaveValue('6');await page.screenshot({path:info.outputPath('shoulder-drop-phone.png'),fullPage:true});
 await page.locator('#reset-fit').click();await expect(field(page)).toHaveValue('4');expect((await backup(page)).product.fit).toBeUndefined();await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(field(page)).toHaveValue('6');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('editing shoulder drop reruns actual top draping with the committed fit',async({page})=>{
 test.setTimeout(90000);await page.addInitScript(()=>{const Native=Worker;window.Worker=class extends Native{constructor(...args:ConstructorParameters<typeof Worker>){super(...args);if(String(args[0]).includes('garment-drape.worker')){const native=this.postMessage.bind(this);this.postMessage=((message:unknown)=>{Object.assign(window,{lastShoulderDrapeInput:structuredClone(message)});native(message);}) as typeof this.postMessage;}}};});
 await setup(page);await page.getByRole('button',{name:'Body & drape',exact:true}).click();await page.getByRole('button',{name:'Drape on a body',exact:true}).click();await expect(page.locator('#garment-drape-status')).toContainText('Draped on a body',{timeout:60000});
 await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();await field(page).fill('6');await page.locator('#apply-fit').click();await expect(page.locator('#garment-drape-status')).toContainText('Draped on a body',{timeout:60000});
 const input=await page.evaluate(()=>(window as unknown as{lastShoulderDrapeInput:{product:{fit:{shoulderDrop:number}}}}).lastShoulderDrapeInput);expect(input.product.fit.shoulderDrop).toBe(6);
});
