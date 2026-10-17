import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function download(page:Page,name:string){const pending=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();return readFile((await(await pending).path())!);}
async function backup(page:Page){return JSON.parse((await download(page,'Export project backup')).toString());}
async function setup(page:Page){await page.goto('/');await page.getByRole('button',{name:'Templates',exact:true}).click();await page.getByRole('button',{name:/^Use the Blank tee template/}).click();await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();await page.locator('#fit-panel summary').click();}
const back=(page:Page)=>page.getByLabel('Back neck drop (cm)',{exact:true});
test('back neckline is independently editable in the actual pattern and GLB, history and recovery',async({page})=>{
 await setup(page);await expect(back(page)).toBeVisible({timeout:2500});const original=await backup(page);
 await back(page).fill('6');await page.getByLabel('Front neck drop (cm)',{exact:true}).fill('10');await page.locator('#apply-fit').click();await expect(page.locator('#message')).toContainText('Fit applied');
 const points=async(side:string)=>((await page.locator(`[data-piece="${side}"] polygon`).getAttribute('points'))!).split(' ').map(p=>p.split(',').map(Number));
 expect((await points('back')).some(([x,y])=>x===27&&y===6)).toBe(true);expect((await points('front')).some(([x,y])=>x===27&&y===10)).toBe(true);
 const saved=await backup(page);expect(saved.product.fit).toEqual({frontNeckDrop:10,backNeckDrop:6});
 await page.getByRole('button',{name:'Exports',exact:true}).click();const glb=await download(page,'Export 3D model (GLB) ↓'),length=glb.readUInt32LE(12),json=JSON.parse(glb.subarray(20,20+length).toString());
 const node=json.nodes.find((n:{name:string})=>n.name==='Back body'),a=json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION],v=json.bufferViews[a.bufferView],offset=28+length+(v.byteOffset??0)+(a.byteOffset??0),ys:number[]=[];
 for(let i=0;i<a.count;i++)if(Math.abs(glb.readFloatLE(offset+i*12))<1e-6)ys.push(glb.readFloatLE(offset+i*12+4));expect(Math.max(...ys)).toBeCloseTo(66,5);
 await page.getByRole('button',{name:'Tech pack',exact:true}).click();await expect(page.locator('#techpack-preview tr').filter({has:page.locator('td:first-child:text-is("H")')}).locator('td').nth(6)).toHaveText('6');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await backup(page)).product).toEqual(original.product);await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('#save-state')).toHaveText('Locally saved');await page.reload();expect((await backup(page)).product).toEqual(saved.product);
});

test('the back-piece handle edits by keyboard and pointer while raw fit drafts stay protected',async({page})=>{
 await setup(page);const handle=page.getByRole('slider',{name:'Back neck: Back neck drop',exact:true});await expect(handle).toHaveAttribute('aria-valuenow','2');
 const x=Number(await handle.getAttribute('cx')),frontMax=await page.locator('[data-piece="front"] polygon').evaluate(p=>(p as SVGGraphicsElement).getBBox().x+(p as SVGGraphicsElement).getBBox().width);expect(x).toBeGreaterThan(frontMax+6);
 await handle.focus();await page.keyboard.press('ArrowDown');await expect(handle).toHaveAttribute('aria-valuenow','2.5');await expect(handle).toBeFocused();expect((await backup(page)).product.fit).toEqual({backNeckDrop:2.5});
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(handle).toHaveAttribute('aria-valuenow','2');
 await back(page).fill('5.50');await handle.focus();await page.keyboard.press('ArrowDown');await expect(page.locator('#message')).toContainText('pending fit edits');await expect(back(page)).toHaveValue('5.50');await expect(handle).toHaveAttribute('aria-valuenow','2');
 await page.getByRole('button',{name:'Discard all product drafts',exact:true}).click();await handle.scrollIntoViewIfNeeded();const box=(await handle.boundingBox())!;
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2+9,{steps:3});await page.mouse.up();
 const value=Number(await handle.getAttribute('aria-valuenow'));expect(value).toBeGreaterThan(2);expect(value*2%1).toBe(0);expect((await backup(page)).product.fit).toEqual({backNeckDrop:value});
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(handle).toHaveAttribute('aria-valuenow','2');
});
test('phone back-neck drafts survive navigation and invalid application until reset',async({page},info)=>{
 await page.setViewportSize({width:390,height:900});await setup(page);const before=await backup(page);await back(page).fill('13');
 await page.getByRole('button',{name:'Materials & prints',exact:true}).click();await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();await expect(back(page)).toHaveValue('13');await page.locator('#apply-fit').click();await expect(page.locator('#message')).toContainText('Back neck drop');expect(await backup(page)).toEqual(before);
 await back(page).fill('6');await page.locator('#apply-fit').click();await expect(back(page)).toHaveValue('6');await page.screenshot({path:info.outputPath('back-neck-phone.png'),fullPage:true});
 await page.locator('#reset-fit').click();await expect(back(page)).toHaveValue('2');expect((await backup(page)).product.fit).toBeUndefined();await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(back(page)).toHaveValue('6');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('editing the back neck reruns actual top draping with the new committed fit',async({page})=>{
 test.setTimeout(90000);await page.addInitScript(()=>{const Native=Worker;window.Worker=class extends Native{constructor(...args:ConstructorParameters<typeof Worker>){super(...args);if(String(args[0]).includes('garment-drape.worker')){const native=this.postMessage.bind(this);this.postMessage=((message:unknown)=>{Object.assign(window,{lastNeckDrapeInput:structuredClone(message)});native(message);}) as typeof this.postMessage;}}};});
 await setup(page);await page.getByRole('button',{name:'Body & drape',exact:true}).click();await page.getByRole('button',{name:'Drape on a body',exact:true}).click();await expect(page.locator('#garment-drape-status')).toContainText('Draped on a body',{timeout:60000});
 await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();await back(page).fill('6');await page.locator('#apply-fit').click();await expect(page.locator('#garment-drape-status')).toContainText('Draped on a body',{timeout:60000});
 const input=await page.evaluate(()=>(window as unknown as{lastNeckDrapeInput:{product:{fit:{backNeckDrop:number}}}}).lastNeckDrapeInput);expect(input.product.fit.backNeckDrop).toBe(6);
});
