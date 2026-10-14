import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function setup(page:Page){await page.addInitScript(()=>{
 const state={starts:0,terms:0,result:null as unknown};Object.assign(window,{topDrapeProbe:state});
 const Native=Worker;window.Worker=class extends Native{constructor(...args:ConstructorParameters<typeof Worker>){super(...args);state.starts++;this.addEventListener('message',e=>{if(e.data.kind==='result')state.result=e.data.result;});}terminate(){state.terms++;super.terminate();}};
});await page.goto('/');await page.locator('#product-editor').getByRole('button',{name:/^Use the Ringer tee template/}).click();}
async function download(page:Page,id:string){const wait=page.waitForEvent('download');await page.locator(`#${id}`).click();return readFile((await (await wait).path())!);}
async function drape(page:Page){await page.locator('#garment-drape-on').click();await expect(page.locator('#garment-drape-status')).toContainText('Draped on a body',{timeout:60000});}
test('unapplied body chest survives selection, blocks replacement, and discards deliberately',async({page})=>{
 await setup(page);const input=page.locator('#garment-drape-chest');await input.fill('');
 await page.getByRole('radio',{name:'Back body',exact:true}).check();await expect(input).toHaveValue('');
 await page.locator('#new-project').click();await expect(page.locator('#message')).toContainText('Apply or discard');await expect(input).toHaveValue('');
 await page.locator('#garment-drape-on').click();await expect(input).toHaveValue('');await expect(page.locator('#message')).toContainText('Body chest');
 await page.locator('#discard-product-drafts').click();await expect(input).toHaveValue('94');
});
test('page departure terminates the real owned drape worker synchronously',async({page})=>{
 await setup(page);await page.locator('#garment-drape-on').click();await expect.poll(()=>page.evaluate(()=>(window as unknown as {topDrapeProbe:{starts:number}}).topDrapeProbe.starts)).toBe(1);
 const terms=await page.evaluate(()=>{dispatchEvent(new Event('pagehide'));return (window as unknown as {topDrapeProbe:{terms:number}}).topDrapeProbe.terms;});expect(terms).toBe(1);
});
test('switching to bottoms retires pending top simulation before it finishes',async({page})=>{
 page.on('dialog',d=>d.accept());await setup(page);await page.locator('#garment-drape-on').click();await expect.poll(()=>page.evaluate(()=>(window as unknown as {topDrapeProbe:{starts:number}}).topDrapeProbe.starts)).toBe(1);
 await page.getByRole('button',{name:/^Use the Straight trousers template/}).click();expect(await page.evaluate(()=>(window as unknown as {topDrapeProbe:{terms:number}}).topDrapeProbe.terms)).toBe(1);
 await expect(page.locator('#garment-drape-status')).toContainText('available for tops');
});
test('settled PNG and GLB carry actual captured draped positions without the body',async({page})=>{
 test.setTimeout(90000);await setup(page);const shell=await download(page,'product-png-front');await drape(page);
 const actual=await download(page,'product-png-front');expect(actual.equals(shell)).toBe(false);
 const expected=await page.evaluate(()=>((window as unknown as {topDrapeProbe:{result:{parts:{part:string,positions:Float32Array}[]}}}).topDrapeProbe.result.parts.find(p=>p.part==='front')!.positions));
 const glb=await download(page,'product-glb'),jsonLength=glb.readUInt32LE(12),json=JSON.parse(glb.subarray(20,20+jsonLength).toString());
 expect(json.nodes.some((n:{name?:string})=>/Body|Neck|Head|Arm/.test(n.name??'')&&!/body|rib/i.test(n.name??''))).toBe(false);
 const node=json.nodes.find((n:{name:string})=>n.name==='Front body'), accessor=json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION],view=json.bufferViews[accessor.bufferView];
 const at=28+jsonLength+(view.byteOffset??0)+(accessor.byteOffset??0),positions=Array.from({length:accessor.count*3},(_,i)=>glb.readFloatLE(at+i*4));
 expect(positions).toEqual(Object.values(expected));
});
test('returning to a settled shape cancels the other shape worker and retains the cached result',async({page})=>{
 await setup(page);await drape(page);const field=page.getByLabel('Chest (cm)',{exact:true});await field.fill('112');await page.getByRole('button',{name:'Apply measurements',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {topDrapeProbe:{starts:number}}).topDrapeProbe.starts)).toBe(2);
 await field.fill('104');await page.getByRole('button',{name:'Apply measurements',exact:true}).click();
 expect(await page.evaluate(()=>(window as unknown as {topDrapeProbe:{terms:number}}).topDrapeProbe.terms)).toBe(2);
 await expect(page.locator('#garment-drape-status')).toContainText('10 cm of ease');
});
test('valid artwork at the lower side follows fabric into the draped GLB instead of disappearing',async({page})=>{
 test.setTimeout(90000);await setup(page);const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=64;c.getContext('2d')!.fillRect(0,0,64,64);return c.toDataURL('image/png').split(',')[1];});
 await page.locator('#artwork-file').setInputFiles({name:'edge-logo.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});await expect(page.locator('#message')).toContainText('Artwork placed');
 await page.locator('#artwork-width').fill('3');await page.locator('#artwork-x').fill('23');await page.locator('#artwork-y').fill('63.5');await page.getByRole('button',{name:'Apply placement',exact:true}).click();
 await drape(page);const glb=await download(page,'product-glb'),j=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString());expect(j.nodes.map((n:{name?:string})=>n.name)).toContain('Front artwork');
});
test('failed worker construction stays quiet across styling and permits an explicit genuine retry',async({page})=>{
 await page.addInitScript(()=>{const Native=Worker,state={attempts:0};Object.assign(window,{workerRetry:state});window.Worker=class extends Native{constructor(...args:ConstructorParameters<typeof Worker>){state.attempts++;if(state.attempts===1)throw new Error('Injected startup failure');super(...args);}};});
 await setup(page);await page.locator('#garment-drape-on').click();await expect(page.locator('#garment-drape-status')).toContainText('could not start');
 await page.getByRole('radio',{name:'Back body',exact:true}).check();expect(await page.evaluate(()=>(window as unknown as {workerRetry:{attempts:number}}).workerRetry.attempts)).toBe(1);
 await drape(page);expect(await page.evaluate(()=>(window as unknown as {workerRetry:{attempts:number}}).workerRetry.attempts)).toBe(2);
});
test('a held genuine retired result cannot restore the body after Show styling shell',async({page})=>{
 await page.addInitScript(()=>{const Native=Worker,state={hold:true,waiting:false,release:()=>{}};Object.assign(window,{lateDrape:state});window.Worker=class extends Native{constructor(...args:ConstructorParameters<typeof Worker>){super(...args);this.addEventListener('message',e=>{if(e.data.kind==='result'&&state.hold){state.hold=false;state.waiting=true;e.stopImmediatePropagation();const data=e.data;state.release=()=>this.dispatchEvent(new MessageEvent('message',{data}));}});}};});
 await setup(page);await page.locator('#garment-drape-on').click();await expect.poll(()=>page.evaluate(()=>(window as unknown as {lateDrape:{waiting:boolean}}).lateDrape.waiting),{timeout:60000}).toBe(true);
 await page.locator('#garment-drape-off').click();await page.evaluate(()=>(window as unknown as {lateDrape:{release:()=>void}}).lateDrape.release());
 await expect(page.locator('#garment-drape-status')).toContainText('styling shell');expect(await page.evaluate(()=>(window as unknown as {topDrapeProbe:{terms:number}}).topDrapeProbe.terms)).toBe(1);
});
