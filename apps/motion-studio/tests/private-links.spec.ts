import { writeFile } from 'node:fs/promises';
import { test, expect, originalProject, openOriginal, publish, view, frame, download, assertPng, assertGif, inspectLibrary, authorized, sha } from './private-links-fixtures.ts';

test('HTTPS snapshot exports original cels and poses and opens only an explicit independent local copy', async ({lan},info)=>{
  test.setTimeout(90000);
  const operator=await lan.browser.newContext(),recipient=await lan.browser.newContext(),owner=await operator.newPage(),viewer=await recipient.newPage();
  try{
    const original=originalProject();await openOriginal(owner,lan,original);const ownerBefore=await inspectLibrary(owner),links=await publish(owner,lan);
    expect(await owner.evaluate(key=>JSON.stringify({...localStorage,...sessionStorage}).includes(key),lan.setup)).toBe(false);
    await view(viewer,links.read);expect(await inspectLibrary(viewer)).toEqual({activeId:null,rows:[]});
    const project=await download(viewer,'#snapshot-project');expect(JSON.parse(project.toString())).toEqual(original);
    const received=await authorized(viewer,links.id,links.readToken);expect(received.status).toBe(200);expect(Buffer.from(received.bytes)).toEqual(project);
    for(const number of [0,5,6,11]){await frame(viewer,number);const png=await download(viewer,'#snapshot-png');assertPng(png,number);await writeFile(info.outputPath(`original-frame-${number}.png`),png);}
    const gif=await download(viewer,'#snapshot-gif');assertGif(gif);await writeFile(info.outputPath('original-private.gif'),gif);await writeFile(info.outputPath('original-private.motion.json'),project);
    await frame(viewer,0);await viewer.locator('#snapshot-play').click();await expect.poll(()=>viewer.locator('#snapshot-frame').inputValue()).not.toBe('0');await viewer.locator('#snapshot-play').click();
    await viewer.locator('#snapshot-open-local').click();await expect.poll(async()=>(await inspectLibrary(viewer)).rows.length).toBe(1);const local=await inspectLibrary(viewer);expect(local.rows[0].project).toEqual(original);expect(await inspectLibrary(owner)).toEqual(ownerBefore);
    await viewer.getByRole('link',{name:'Open local studio',exact:true}).click();await expect(viewer.locator('#project-title')).toHaveValue(original.title);await expect(viewer.locator('#save-status')).toHaveText('Saved in this browser');await viewer.locator('#project-title').fill('Recipient independent edit');await viewer.locator('#project-title').press('Tab');await expect(viewer.locator('#save-status')).toHaveText('Saved in this browser');expect(JSON.parse(Buffer.from((await authorized(owner,links.id,links.readToken)).bytes).toString())).toEqual(original);
    const localEdited=await inspectLibrary(viewer);await lan.restart();await view(viewer,links.read);expect(await download(viewer,'#snapshot-project')).toEqual(project);expect(await inspectLibrary(viewer)).toEqual(localEdited);
    expect(await viewer.evaluate(tokens=>tokens.some(token=>JSON.stringify({...localStorage,...sessionStorage}).includes(token)),[links.readToken,links.revokeToken])).toBe(false);expect(await recipient.cookies()).toEqual([]);
    await viewer.screenshot({path:info.outputPath('private-view-desktop.png'),fullPage:true});await viewer.setViewportSize({width:390,height:844});expect(await viewer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await viewer.screenshot({path:info.outputPath('private-view-390.png'),fullPage:true});
    await writeFile(info.outputPath('independent-media-receipt.json'),JSON.stringify({projectBytes:project.length,projectSha256:sha(project),gifBytes:gif.length,gifSha256:sha(gif),pngFrames:[0,5,6,11],gifFrames:12,delaysMs:[80,90,80,80,90,80,80,90,80,80,90,80],actualProcessRestart:true,physicalDevices:false},null,2));
  }finally{await operator.close();await recipient.close();}
});

test('read and revoke authorities differ, cancel preserves access and revocation survives restart',async({lan})=>{
  const context=await lan.browser.newContext(),owner=await context.newPage(),viewer=await context.newPage();
  try{
    await openOriginal(owner,lan);const links=await publish(owner,lan);
    expect((await authorized(owner,links.id,links.revokeToken)).status).toBe(404);expect((await authorized(owner,links.id,links.readToken,true)).status).toBe(404);expect((await authorized(owner,links.id,'f'.repeat(64))).status).toBe(404);expect((await authorized(owner,links.id,lan.setup)).status).toBe(404);
    await viewer.goto(links.revoke);await expect.poll(()=>new URL(viewer.url()).hash).toBe('');await expect(viewer.locator('#snapshot-revoke')).toBeEnabled();await expect(viewer.locator('#snapshot-project')).toBeDisabled();viewer.once('dialog',dialog=>dialog.dismiss());await viewer.locator('#snapshot-revoke').click();expect((await authorized(owner,links.id,links.readToken)).status).toBe(200);
    viewer.once('dialog',dialog=>dialog.accept());await viewer.locator('#snapshot-revoke').click();await expect.poll(async()=>(await authorized(owner,links.id,links.readToken)).status).toBe(404);await lan.restart();expect((await authorized(owner,links.id,links.readToken)).status).toBe(404);await viewer.goto(links.read);await expect(viewer.locator('#snapshot-status')).toContainText(/unavailable|not found|revoked|refused/i);await expect(viewer.locator('#snapshot-project')).toBeDisabled();
  }finally{await context.close();}
});

test('raw drafts block publication and late committed receipt preserves newer exact editor input',async({lan})=>{
  const context=await lan.browser.newContext(),page=await context.newPage();
  try{
    await openOriginal(page,lan);await page.locator('[data-layer-id=moving]').click();const raw=page.locator('#pose-x');await raw.evaluate(node=>node.setAttribute('data-native-pose','same'));await raw.fill('-');await page.locator('#private-link-setup').fill(lan.setup);let blockedPosts=0;const countPost=(request:import('@playwright/test').Request)=>{if(new URL(request.url()).pathname==='/api/snapshots'&&request.method()==='POST')blockedPosts++;};page.on('request',countPost);await raw.focus();await page.locator('#publish-snapshot').click();await expect(page.locator('#private-link-status')).toContainText('Apply or discard');await expect(raw).toHaveValue('-');await expect(raw).toHaveAttribute('data-native-pose','same');await expect(raw).toBeFocused();expect(blockedPosts).toBe(0);page.off('request',countPost);await page.locator('#discard-pose-edits').click();await raw.evaluate(node=>node.setAttribute('data-native-pose','same'));
    await page.evaluate(()=>{const state={entered:false,release:null as null|(()=>void),count:0};Object.assign(window,{private110:state});const native=window.fetch;window.fetch=async(...args)=>{const response=await native(...args);if(String(args[0])==='/api/snapshots'&&args[1]?.method==='POST'){state.count++;if(response.status!==201)throw Error('Actual publication did not succeed');state.entered=true;await new Promise<void>(done=>state.release=done);}return response;};});
    await page.locator('#publish-snapshot').click();await expect.poll(()=>page.evaluate(()=>(window as unknown as{private110:{entered:boolean}}).private110.entered)).toBe(true);await expect(page.locator('#private-link-setup')).toHaveValue('');await raw.fill('2-');await raw.focus();await raw.evaluate((node:HTMLInputElement)=>node.setSelectionRange(1,2));await page.evaluate(()=>(window as unknown as{private110:{release:()=>void}}).private110.release());
    await expect.poll(async()=>Boolean(await page.locator('#private-view-link').inputValue())).toBe(true);await expect(raw).toHaveValue('2-');await expect(raw).toHaveAttribute('data-native-pose','same');await expect(raw).toBeFocused();expect(await raw.evaluate((node:HTMLInputElement)=>[node.selectionStart,node.selectionEnd])).toEqual([1,2]);expect(await page.evaluate(()=>(window as unknown as{private110:{count:number}}).private110.count)).toBe(1);expect(JSON.parse((await download(page,'#backup')).toString())).toEqual(originalProject());
  }finally{await context.close();}
});

test('lost real publication response reports uncertainty without automatic retry',async({lan})=>{
  const context=await lan.browser.newContext(),page=await context.newPage();
  try{
    await openOriginal(page,lan);await page.evaluate(()=>{const state={count:0,committed:false};Object.assign(window,{lost110:state});const native=window.fetch;window.fetch=async(...args)=>{const response=await native(...args);if(String(args[0])==='/api/snapshots'&&args[1]?.method==='POST'){state.count++;state.committed=response.status===201;throw new TypeError('Controlled response loss after real publication');}return response;};});
    await page.locator('#private-link-setup').fill(lan.setup);await page.locator('#publish-snapshot').click();await expect(page.locator('#private-link-status')).toContainText(/may|uncertain|unknown/i);await expect(page.locator('#private-link-setup')).toHaveValue('');expect(await page.evaluate(()=>(window as unknown as{lost110:{count:number;committed:boolean}}).lost110)).toEqual({count:1,committed:true});expect(JSON.parse((await download(page,'#backup')).toString())).toEqual(originalProject());await page.locator('#project-title').fill('New memory after response loss');await page.locator('#project-title').press('Tab');await expect(page.locator('#save-status')).toHaveText('Saved in this browser');expect(await page.evaluate(()=>(window as unknown as{lost110:{count:number}}).lost110.count)).toBe(1);
  }finally{await context.close();}
});

test('new private fragment retires held earlier read and wrong authority cannot expose cached artwork',async({lan})=>{
  const context=await lan.browser.newContext(),owner=await context.newPage(),reader=await context.newPage();
  try{
    await openOriginal(owner,lan);const a=await publish(owner,lan);await owner.locator('#project-title').fill('Second independent snapshot');await owner.locator('#project-title').press('Tab');await expect(owner.locator('#save-status')).toHaveText('Saved in this browser');await owner.locator('#private-link-setup').fill(lan.setup);
    const response=owner.waitForResponse(r=>new URL(r.url()).pathname==='/api/snapshots'&&r.request().method()==='POST');await owner.locator('#publish-snapshot').click();expect((await response).status()).toBe(201);await expect.poll(async()=>await owner.locator('#private-view-link').inputValue()!==a.read).toBe(true);const b=await owner.locator('#private-view-link').inputValue();
    await reader.addInitScript(id=>{const native=window.fetch,state={entered:false,release:null as null|(()=>void)};Object.assign(window,{read110:state});window.fetch=async(...args)=>{const response=await native(...args);if(!state.entered&&String(args[0])===`/api/snapshots/${id}`){state.entered=true;await new Promise<void>(done=>state.release=done);}return response;};},a.id);
    await reader.goto(a.read);await expect.poll(()=>reader.evaluate(()=>(window as unknown as{read110:{entered:boolean}}).read110.entered)).toBe(true);await reader.evaluate(hash=>{location.hash=hash;},new URL(b).hash);await expect(reader.locator('#snapshot-title')).toHaveText('Second independent snapshot');await reader.evaluate(()=>(window as unknown as{read110:{release:()=>void}}).read110.release());expect(JSON.parse((await download(reader,'#snapshot-project')).toString()).title).toBe('Second independent snapshot');
    await reader.evaluate(hash=>{location.hash=hash;},`snapshot=${a.id}&read=${'f'.repeat(64)}`);await expect(reader.locator('#snapshot-status')).toContainText(/unavailable|not found|refused/i);await expect(reader.locator('#snapshot-project')).toBeDisabled();
  }finally{await context.close();}
});

test('unavailable service status disables only publication while local artwork remains editable and exportable',async({lan})=>{
  const context=await lan.browser.newContext(),page=await context.newPage();
  try{await page.route('**/api/status',route=>route.abort('failed'));await openOriginal(page,lan);await expect(page.locator('#publish-snapshot')).toBeDisabled();expect(JSON.parse((await download(page,'#backup')).toString())).toEqual(originalProject());assertPng(await download(page,'#png'),0);await page.locator('#project-title').fill('Local work without publishing service');await page.locator('#project-title').press('Tab');await expect(page.locator('#save-status')).toHaveText('Saved in this browser');}
  finally{await context.close();}
});

test('explicit local copy refuses full eight-entry library without changing records or captured artwork',async({lan})=>{
  const context=await lan.browser.newContext(),owner=await context.newPage(),reader=await context.newPage();
  try{await openOriginal(owner,lan);const links=await publish(owner,lan);for(let i=(await inspectLibrary(owner)).rows.length;i<8;i++){await owner.locator('#project-file').setInputFiles({name:`original-${i}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(originalProject(`Existing local ${i}`)))});await expect(owner.locator('#project-title')).toHaveValue(`Existing local ${i}`);await expect(owner.locator('#save-status')).toHaveText('Saved in this browser');}const before=await inspectLibrary(owner);expect(before.rows).toHaveLength(8);await view(reader,links.read);await reader.locator('#snapshot-open-local').click();await expect(reader.locator('#snapshot-local-status')).toContainText(/eight|full|room|limit/i);expect(await inspectLibrary(reader)).toEqual(before);expect(JSON.parse((await download(reader,'#snapshot-project')).toString())).toEqual(originalProject());}
  finally{await context.close();}
});

test('cancel and controlled pagehide retire late publication receipts without clearing newer raw work',async({lan})=>{
  const context=await lan.browser.newContext(),page=await context.newPage();
  try{
    await openOriginal(page,lan);await page.evaluate(()=>{const native=window.fetch,state={entered:false,release:null as null|(()=>void),count:0,finished:false};Object.assign(window,{cancel110:state});window.fetch=async(...args)=>{const response=await native(...args);if(String(args[0])==='/api/snapshots'&&args[1]?.method==='POST'){state.count++;if(response.status!==201)throw Error('Actual publication did not commit');state.entered=true;await new Promise<void>(done=>state.release=done);state.finished=true;}return response;};});
    await page.locator('#private-link-setup').fill(lan.setup);await page.locator('#publish-snapshot').click();await expect.poll(()=>page.evaluate(()=>(window as unknown as{cancel110:{entered:boolean}}).cancel110.entered)).toBe(true);await page.locator('#cancel-publication').click();await page.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
    const title=page.locator('#project-title');await title.fill('');await title.evaluate(node=>node.setAttribute('data-original-node','kept'));await title.focus();await page.evaluate(()=>(window as unknown as{cancel110:{release:()=>void}}).cancel110.release());await expect.poll(()=>page.evaluate(()=>(window as unknown as{cancel110:{finished:boolean}}).cancel110.finished)).toBe(true);await expect(title).toHaveValue('');await expect(title).toHaveAttribute('data-original-node','kept');await expect(title).toBeFocused();await expect(page.locator('#private-link-setup')).toHaveValue('');await expect(page.locator('#private-view-link')).toHaveValue('');expect(await page.evaluate(()=>(window as unknown as{cancel110:{count:number}}).cancel110.count)).toBe(1);expect(JSON.parse((await download(page,'#backup')).toString())).toEqual(originalProject());
  }finally{await context.close();}
});

test('corrupt local library refuses snapshot adoption without overwriting recovery bytes or the editor draft',async({lan})=>{
  const context=await lan.browser.newContext(),owner=await context.newPage(),reader=await context.newPage();
  try{
    await openOriginal(owner,lan);const links=await publish(owner,lan),before=await inspectLibrary(owner),corrupt={schemaVersion:999,preserved:'Original recovery bytes <literal> Ω'};
    await owner.evaluate(value=>new Promise<void>((resolve,reject)=>{const req=indexedDB.open('motion-studio');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction('library','readwrite');tx.objectStore('library').put(value,'current');tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};}),corrupt);
    const title=owner.locator('#project-title');await title.fill('');await title.evaluate(node=>node.setAttribute('data-recovery-draft','same'));
    await view(reader,links.read);await reader.locator('#snapshot-open-local').click();await expect(reader.locator('#snapshot-local-status')).toContainText(/recover|protect|corrupt|unsupported|invalid/i);await expect(title).toHaveValue('');await expect(title).toHaveAttribute('data-recovery-draft','same');expect((await inspectLibrary(reader)).rows).toEqual(before.rows);
    const durable=await reader.evaluate(()=>new Promise<unknown>((resolve,reject)=>{const req=indexedDB.open('motion-studio');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction('library','readonly'),value=tx.objectStore('library').get('current');tx.oncomplete=()=>{db.close();resolve(value.result);};tx.onabort=()=>{db.close();reject(tx.error);};};}));expect(durable).toEqual(corrupt);expect(JSON.parse((await download(reader,'#snapshot-project')).toString())).toEqual(originalProject());
  }finally{await context.close();}
});
