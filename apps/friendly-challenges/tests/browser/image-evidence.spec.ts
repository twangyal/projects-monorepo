import {expect,type Page} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {imageTest as test,propose,claim,accept,originalPng,chooseImage,submitImage,retainedBytes,viewImage,credentials,snapshot,revision,command,uploadFrame,hash,checkNormalized,orientedJpeg,IMAGE_CAPTION,displayedImageBytes} from './image-evidence-fixtures';

async function pair(page:Page,browser:import('@playwright/test').Browser,baseURL:string){const invitation=await propose(page);const context=await browser.newContext({baseURL}),opponent=await context.newPage();await claim(opponent,invitation);await accept(opponent);await revision(page);return{context,opponent,invitation};}
async function exportHtml(page:Page){const waiting=page.waitForEvent('download');await page.locator('#export-images').click();const download=await waiting;const path=await download.path();expect(path).not.toBeNull();return{download,bytes:await readFile(path!)};}
async function imageReport(page:Page,html:Buffer){
  const text=html.toString('utf8');expect(text).not.toMatch(/<script\b/i);expect(text).not.toMatch(/\son\w+\s*=/i);
  return page.evaluate(text=>{const document=new DOMParser().parseFromString(text,'text/html');
    const images=[...document.querySelectorAll('img')].map(image=>image.getAttribute('src')??'');
    const records=[...document.querySelectorAll('pre')].flatMap(pre=>{try{return[JSON.parse(pre.textContent??'') as Record<string,unknown>];}catch{return[];}});
    return{images,records,text:document.body.textContent??'',scripts:document.scripts.length};
  },text);
}
async function holdBlob(page:Page){await page.evaluate(()=>{const native=Blob.prototype.arrayBuffer;const gate={waiting:[] as (()=>void)[],enabled:true};(window as unknown as {imageGate:typeof gate}).imageGate=gate;Blob.prototype.arrayBuffer=async function(){const bytes=await native.call(this);if(gate.enabled)await new Promise<void>(resolve=>gate.waiting.push(resolve));return bytes;};});}
async function releaseBlob(page:Page){await page.evaluate(()=>{const gate=(window as unknown as {imageGate:{waiting:(()=>void)[];enabled:boolean}}).imageGate;gate.enabled=false;gate.waiting.splice(0).forEach(resolve=>resolve());});}

test('two participants and a claimed arbiter retain exact reviewed pixels, terminal export and service restart',async({page,browser,baseURL,imageService},info)=>{
  test.setTimeout(90000);const errors:string[]=[],external:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).origin!==new URL(baseURL!).origin)external.push(r.url());});
  const{context,opponent,invitation}=await pair(page,browser,baseURL!);const arbiterContext=await browser.newContext({baseURL}),arbiter=await arbiterContext.newPage();
  try{
    await expect(page.getByLabel('Choose evidence image',{exact:true})).toBeVisible({timeout:2000});
    const preview=await chooseImage(page),expected=checkNormalized(preview),entry=await submitImage(page);
    expect(entry.image).toEqual({mime:'image/jpeg',...expected});expect(entry.text).toBe(IMAGE_CAPTION);expect(entry.author).toBe('proposer');
    expect(await retainedBytes(opponent,entry.id)).toEqual(preview);expect(await viewImage(opponent,entry.id)).toEqual(preview);
    const secondPreview=await chooseImage(opponent,'Sam supplied a larger original study.',originalPng(80,60));checkNormalized(secondPreview,80,60);const second=await submitImage(opponent);
    const result=await command(page,'result',{outcome:'proposer',reason:'I believe I finished first.'});expect(result.status()).toBe(200);
    const proposal=(await snapshot(page)).resultProposal!;expect((await command(opponent,'result/respond',{proposalId:proposal.id,accept:false,reason:'The ordering is disputed.'})).status()).toBe(200);
    expect((await command(page,'arbiter/nominate',{name:'Taylor',reason:'We trust Taylor to read our supplied evidence.'})).status()).toBe(200);
    const nomination=(await snapshot(page)).arbiterNomination!;expect((await command(opponent,'arbiter/respond',{nominationId:nomination.id,accept:true,reason:''})).status()).toBe(200);
    const invited=await command(page,'invite',{seat:'arbiter'});expect(invited.status()).toBe(200);const invitationData=await invited.json() as {inviteToken:string};const owner=await credentials(page);
    await claim(arbiter,`${baseURL}/?challenge=${owner.id}#arbiter=${invitationData.inviteToken}`,true);
    expect(await viewImage(arbiter,entry.id)).toEqual(preview);expect(await retainedBytes(arbiter,second.id)).toEqual(secondPreview);
    await expect(arbiter.getByRole('button',{name:'Add evidence with image',exact:true})).toHaveCount(0);
    const arbiterSeat=await credentials(arbiter);const forbiddenImage=await arbiter.request.post(`/api/challenges/${owner.id}/evidence/image`,{headers:{Authorization:`Bearer ${arbiterSeat.token}`,'Content-Type':'application/octet-stream'},data:uploadFrame((await snapshot(arbiter)).revision,preview,'Arbiter must not append')});expect(forbiddenImage.status()).toBe(403);
    await arbiter.locator('#decision-form [name=outcome]').selectOption('opponent');await arbiter.locator('#decision-form [name=reason]').fill('Decision based on the supplied, unverified record.');arbiter.once('dialog',d=>d.accept());await arbiter.getByRole('button',{name:'Record decision',exact:true}).click();
    await expect.poll(async()=>(await snapshot(page)).status).toBe('resolved');const final=await snapshot(arbiter);
    const terminalPost=await page.request.post(`/api/challenges/${owner.id}/evidence/image`,{headers:{Authorization:`Bearer ${owner.token}`,'Content-Type':'application/octet-stream'},data:uploadFrame(final.revision,preview,'Forbidden terminal append')});expect(terminalPost.status()).toBe(409);
    const exported=await exportHtml(arbiter),parsed=await imageReport(arbiter,exported.bytes);
    expect(parsed.scripts).toBe(0);expect(parsed.images).toHaveLength(2);const embedded=parsed.images.map(source=>{expect(source).toMatch(/^data:image\/jpeg;base64,/);return Buffer.from(source.split(',')[1],'base64');});expect(embedded).toEqual([preview,secondPreview]);embedded.forEach((bytes,i)=>checkNormalized(bytes,i?80:64,i?60:48));
    const plain=await arbiter.request.get(`/api/challenges/${owner.id}/export`,{headers:{Authorization:`Bearer ${(await credentials(arbiter)).token}`}});expect(plain.status()).toBe(200);const record=await plain.json() as {schemaVersion:number;challenge:unknown};expect(record.schemaVersion).toBe(2);expect(parsed.records.find(value=>Object.hasOwn(value,'challenge'))?.challenge).toEqual(record.challenge);
    for(const secret of [owner.token,(await credentials(opponent)).token,(await credentials(arbiter)).token,new URL(invitation).hash.slice(8),invitationData.inviteToken]){expect(exported.bytes.toString()).not.toContain(secret);expect(exported.bytes.toString()).not.toContain(hash(Buffer.from(secret)));}
    expect(exported.bytes.toString()).not.toContain('original-study.png');expect(parsed.text).toContain(IMAGE_CAPTION);
    const imagePath=`/api/challenges/${owner.id}/evidence/${entry.id}/image`;
    expect((await page.request.get(imagePath)).status()).toBe(401);expect((await page.request.get(imagePath,{headers:{Authorization:`Bearer ${'f'.repeat(64)}`}})).status()).toBe(401);
    await imageService.restart();await page.reload();await expect(page.locator('#challenge-status')).toContainText('resolved');expect(await retainedBytes(page,entry.id)).toEqual(preview);expect((await snapshot(page)).events).toEqual(final.events);expect(await viewImage(page,entry.id)).toEqual(preview);
    await exported.download.saveAs(info.outputPath('complete-image-record.html'));await writeFile(info.outputPath('reviewed.jpg'),preview);await writeFile(info.outputPath('image-evidence-verification.json'),JSON.stringify({first:entry.image,second:second.image,events:final.events.length,htmlBytes:exported.bytes.length,htmlSha256:hash(exported.bytes),restartExactBytes:true},null,2));
    await page.screenshot({path:info.outputPath('desktop-image-record.png'),fullPage:true});expect(errors).toEqual([]);expect(external).toEqual([]);
  }finally{await context.close();await arbiterContext.close();}
});

test('stale revision preserves reviewed bytes and raw caption until a deliberate retry',async({page,browser,baseURL})=>{
  const{context,opponent}=await pair(page,browser,baseURL!);try{
    const preview=await chooseImage(page,'A caption still owned by this editor.');const{id,token}=await credentials(page);const polling=`**/api/challenges/${id}`;
    await page.route(polling,route=>route.request().method()==='GET'?route.abort('failed'):route.continue());
    expect((await command(opponent,'evidence',{text:'Opposing statement changes revision.',url:null})).status()).toBe(200);
    let uploads=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/evidence/image'))uploads++;});
    await page.locator('#add-image-evidence').click();await expect(page.locator('#message')).toContainText(/changed|stale|revision|refresh/i);
    await expect(page.locator('#evidence-form [name=text]')).toHaveValue('A caption still owned by this editor.');
    expect(await displayedImageBytes(page.locator('#evidence-image-preview'))).toEqual(preview);
    await page.unroute(polling);await page.getByRole('button',{name:'Refresh challenge',exact:true}).click();await revision(page);expect(uploads).toBe(1);expect((await snapshot(page)).evidence).toHaveLength(1);
    const entry=await submitImage(page);expect(uploads).toBe(2);expect(await retainedBytes(page,entry.id)).toEqual(preview);
    const unrelated=await page.request.post('/api/challenges',{data:{name:'Other',terms:{...(await snapshot(page)).terms,title:'Unrelated challenge'}}});expect(unrelated.status()).toBe(201);const other=await unrelated.json() as {challengeId:string;token:string};
    expect((await page.request.get(`/api/challenges/${id}/evidence/${entry.id}/image`,{headers:{Authorization:`Bearer ${other.token}`}})).status()).toBe(401);
    expect((await page.request.get(`/api/challenges/${other.challengeId}/evidence/${entry.id}/image`,{headers:{Authorization:`Bearer ${token}`}})).status()).toBe(401);
  }finally{await context.close();}
});

test('lost real successful upload response retains draft and never replays automatically',async({page,browser,baseURL})=>{
  const{context}=await pair(page,browser,baseURL!);try{
    const preview=await chooseImage(page,'Delivery is uncertain, not permission to retry.');const{id}=await credentials(page);let count=0;
    await page.route(`**/api/challenges/${id}/evidence/image`,async route=>{count++;const actual=await route.fetch();expect(actual.status()).toBe(200);await route.abort('failed');});
    await page.locator('#add-image-evidence').click();await expect(page.locator('#message')).toContainText(/confirm|arriv|unknown|reach|network/i);
    await expect(page.locator('#evidence-form [name=text]')).toHaveValue('Delivery is uncertain, not permission to retry.');await expect(page.locator('#evidence-image-preview')).toBeVisible();
    await page.getByRole('button',{name:'Refresh challenge',exact:true}).click();await expect.poll(async()=>(await snapshot(page)).evidence.length).toBe(1);await revision(page);expect(count).toBe(1);
    const entry=(await snapshot(page)).evidence[0];expect(await retainedBytes(page,entry.id)).toEqual(preview);
    await page.unroute(`**/api/challenges/${id}/evidence/image`);
  }finally{await context.close();}
});

for(const intent of ['changed-back caption','remove'])test(`late genuine normalization cannot publish after ${intent}`,async({page,browser,baseURL})=>{
  const{context}=await pair(page,browser,baseURL!);try{
    const draft=page.locator('#evidence-form [name=text]');await draft.fill('Literal retained caption');await holdBlob(page);
    await page.locator('#evidence-image').setInputFiles({name:'delayed-original.png',mimeType:'image/png',buffer:originalPng()});
    await expect.poll(()=>page.evaluate(()=>(window as unknown as {imageGate:{waiting:unknown[]}}).imageGate.waiting.length)).toBeGreaterThan(0);
    if(intent==='remove')await page.locator('#remove-evidence-image').click();else{await draft.fill('Temporary caption');await draft.fill('Literal retained caption');await draft.evaluate(node=>(node as HTMLTextAreaElement).setSelectionRange(5,5));}
    await releaseBlob(page);await expect(page.locator('#evidence-image-preview')).toBeHidden();await expect(draft).toHaveValue('Literal retained caption');expect((await snapshot(page)).evidence).toHaveLength(0);
    if(intent==='changed-back caption'){await expect(draft).toBeFocused();expect(await draft.evaluate(node=>[(node as HTMLTextAreaElement).selectionStart,(node as HTMLTextAreaElement).selectionEnd])).toEqual([5,5]);}
  }finally{await context.close();}
});

test('an authenticated image fetch retired by a new seat never installs an old Blob URL',async({page,browser,baseURL})=>{
  const{context,opponent}=await pair(page,browser,baseURL!);let release!:()=>void;
  try{await chooseImage(page);const entry=await submitImage(page),guest=await credentials(opponent),owner=await credentials(page);let reached!:()=>void;const started=new Promise<void>(r=>{reached=r;}),gate=new Promise<void>(r=>{release=r;});
    await page.route(`**/api/challenges/${owner.id}/evidence/${entry.id}/image`,async route=>{const response=await route.fetch();reached();await gate;try{await route.fulfill({response});}catch{/* Real request can be aborted by seat retirement. */}});
    const row=page.locator(`[data-evidence-id="${entry.id}"]`);await row.getByRole('button',{name:'View retained image',exact:true}).click();await started;
    await page.goto(`${baseURL}/?challenge=${owner.id}#access=${guest.token}`);page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Use this private access link',exact:true}).click();await expect.poll(async()=>(await snapshot(page)).myRole).toBe('opponent');
    release();await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));await expect(page.getByAltText('Retained normalized evidence image',{exact:true})).toBeHidden();
    await page.unroute(`**/api/challenges/${owner.id}/evidence/${entry.id}/image`);await viewImage(page,entry.id);const image=page.getByAltText('Retained normalized evidence image',{exact:true});const url=await image.getAttribute('src');await page.getByRole('button',{name:'Close retained image',exact:true}).click();await expect(image).toBeHidden();
    expect(await page.evaluate(async url=>{try{const image=new Image();image.src=url!;await image.decode();return false;}catch{return true;}},url)).toBe(true);
  }finally{release?.();await context.close();}
});

test('all eight actual images export completely and ninth append cannot evict evidence on mobile',async({page,browser,baseURL},info)=>{
  test.setTimeout(90000);await page.setViewportSize({width:390,height:844});const{context}=await pair(page,browser,baseURL!);
  try{const images:Buffer[]=[];for(let i=0;i<8;i++){images.push(await chooseImage(page,`Original evidence image ${i+1}.`));await submitImage(page);}
    await expect(page.locator('#evidence-image-quota')).toContainText(/8\s*(?:of|\/)\s*8/);const before=await snapshot(page),{id,token}=await credentials(page);
    const ninth=await page.request.post(`/api/challenges/${id}/evidence/image`,{headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream'},data:uploadFrame(before.revision,images[0],'Ninth must not evict')});expect(ninth.status()).toBe(409);expect((await snapshot(page)).events).toEqual(before.events);
    const exported=await exportHtml(page),parsed=await imageReport(page,exported.bytes);expect(parsed.images).toHaveLength(8);expect(parsed.images.map(source=>Buffer.from(source.split(',')[1],'base64'))).toEqual(images);for(const image of images)checkNormalized(image);
    const last=page.locator(`[data-evidence-id="${before.evidence.at(-1)!.id}"]`);await last.getByRole('button',{name:'View retained image',exact:true}).focus();await page.keyboard.press('Enter');await expect(last.getByAltText('Retained normalized evidence image')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(await page.getByRole('button',{name:'Close link',exact:true}).isVisible())await page.getByRole('button',{name:'Close link',exact:true}).click();
    await page.screenshot({path:info.outputPath('eight-images-390px.png'),fullPage:true});await exported.download.saveAs(info.outputPath('eight-actual-images.html'));
  }finally{await context.close();}
});

test('late image receipt uses real server deadline and remains a supplied claim',async({page,browser,baseURL})=>{
  test.setTimeout(35000);const created=await page.request.post('/api/challenges',{data:{name:'Alex',terms:{title:'Real late image',description:'An original image supplied after time expires.',successCriteria:'Share the work.',evidenceRule:'Supplied images and captions.',stake:'bragging-rights',deadline:Date.now()+10000}}});expect(created.status()).toBe(201);const owner=await created.json() as {challengeId:string;token:string;inviteToken:string};
  await page.goto(`${baseURL}/?challenge=${owner.challengeId}#access=${owner.token}`);await page.getByRole('button',{name:'Use this private access link',exact:true}).click();const context=await browser.newContext({baseURL}),opponent=await context.newPage();
  try{await claim(opponent,`${baseURL}/?challenge=${owner.challengeId}#invite=${owner.inviteToken}`);await accept(opponent);const preview=await chooseImage(page,'Supplied after the deadline, not captured-time proof.');await expect.poll(async()=>(await snapshot(page)).deadlinePassed,{timeout:15000}).toBe(true);const entry=await submitImage(page);expect(entry.late).toBe(true);expect(entry.createdAt).toBeGreaterThanOrEqual((await snapshot(page)).terms.deadline);expect(await retainedBytes(opponent,entry.id)).toEqual(preview);await expect(page.locator(`[data-evidence-id="${entry.id}"]`)).toContainText(/late/i);
  }finally{await context.close();}
});

test('native JPEG orientation is applied once and the reviewed upload omits source metadata',async({page,browser,baseURL})=>{
  const {context,opponent}=await pair(page,browser,baseURL!);
  try{const original=orientedJpeg();expect(original.includes(Buffer.from('Exif\0\0'))).toBe(true);
    const preview=await chooseImage(page,'Clockwise orientation is reviewed before append.',original,'image/jpeg');
    checkNormalized(preview,60,40,true);expect(preview.includes(Buffer.from('Exif\0\0'))).toBe(false);
    const entry=await submitImage(page);expect(entry.image.width).toBe(60);expect(entry.image.height).toBe(40);
    expect(await retainedBytes(opponent,entry.id)).toEqual(preview);checkNormalized(await viewImage(opponent,entry.id),60,40,true);
  }finally{await context.close();}
});

test('same physical PNG can be chosen again after caption input cancels its normalization',async({page,browser,baseURL},info)=>{
  const {context}=await pair(page,browser,baseURL!);
  try{
    const path=info.outputPath('same-original.png');await writeFile(path,originalPng());
    const caption=page.locator('#evidence-form [name=text]');await caption.fill('Retained exact caption');await holdBlob(page);
    let chooser=page.waitForEvent('filechooser');await page.getByLabel('Choose evidence image',{exact:true}).click();await(await chooser).setFiles(path);
    await expect.poll(()=>page.evaluate(()=>(window as unknown as {imageGate:{waiting:unknown[]}}).imageGate.waiting.length)).toBeGreaterThan(0);
    await caption.fill('Changed during native read');await caption.fill('Retained exact caption');await releaseBlob(page);
    await expect(page.locator('#evidence-image-preview')).toBeHidden();
    chooser=page.waitForEvent('filechooser');await page.getByLabel('Choose evidence image',{exact:true}).click();await(await chooser).setFiles(path);
    await expect(page.locator('#evidence-image-preview')).toBeVisible();await expect(page.locator('#add-image-evidence')).toBeEnabled();
    await expect(caption).toHaveValue('Retained exact caption');expect((await snapshot(page)).evidence).toHaveLength(0);
  }finally{await context.close();}
});

test('late incoming-seat activation preserves a newer changed-back caption without silently switching',async({page,browser,baseURL})=>{
  const {context,opponent}=await pair(page,browser,baseURL!);let release!:()=>void;
  try{
    await revision(page);const owner=await credentials(page),guest=await credentials(opponent);let received!:()=>void;const started=new Promise<void>(r=>{received=r;}),gate=new Promise<void>(r=>{release=r;});
    await page.route(`**/api/challenges/${owner.id}`,async route=>{
      if(route.request().headers().authorization!==`Bearer ${guest.token}`){await route.continue();return;}
      const response=await route.fetch();expect(response.status()).toBe(200);received();await gate;try{await route.fulfill({response});}catch{/* The explicit seat operation may retire its own request. */}
    });
    await page.goto(`${baseURL}/?challenge=${owner.id}#access=${guest.token}`);page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Use this private access link',exact:true}).click();await started;
    const caption=page.locator('#evidence-form [name=text]');await caption.fill('New raw caption');await caption.fill('');await caption.evaluate(node=>(node as HTMLTextAreaElement).setSelectionRange(0,0));
    release();await expect(page.getByRole('button',{name:'Use this private access link',exact:true})).toBeEnabled();
    await expect(caption).toBeFocused();await expect(caption).toHaveValue('');expect(await credentials(page)).toEqual(owner);expect((await snapshot(page)).myRole).toBe('proposer');
    await page.unroute(`**/api/challenges/${owner.id}`);
  }finally{release?.();await context.close();}
});

test('late successful arbiter claim preserves the newer old-seat draft and exposes its issued credential',async({page,browser,baseURL})=>{
  const {context,opponent}=await pair(page,browser,baseURL!);let release!:()=>void;
  try{
    expect((await command(page,'result',{outcome:'proposer',reason:'Our ordering needs review.'})).status()).toBe(200);
    const proposal=(await snapshot(page)).resultProposal!;expect((await command(opponent,'result/respond',{proposalId:proposal.id,accept:false,reason:'I disagree about the ordering.'})).status()).toBe(200);
    expect((await command(page,'arbiter/nominate',{name:'Taylor',reason:'Please review the supplied record.'})).status()).toBe(200);
    const nomination=(await snapshot(page)).arbiterNomination!;expect((await command(opponent,'arbiter/respond',{nominationId:nomination.id,accept:true,reason:''})).status()).toBe(200);
    const invited=await command(page,'invite',{seat:'arbiter'});expect(invited.status()).toBe(200);const invitation=await invited.json() as {inviteToken:string};await revision(page);const owner=await credentials(page);
    let reached!:()=>void,issued='';const started=new Promise<void>(resolve=>{reached=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    await page.route(`**/api/challenges/${owner.id}/arbiter/join`,async route=>{const response=await route.fetch();expect(response.status()).toBe(200);issued=(await response.json() as {token:string}).token;reached();await gate;try{await route.fulfill({response});}catch{/* Successful one-use claim must remain recoverable if activation is retired. */}});
    await page.goto(`${baseURL}/?challenge=${owner.id}#arbiter=${invitation.inviteToken}`);await page.locator('#claim-form [name=name]').fill('Taylor');page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Claim arbiter seat',exact:true}).click();await started;
    const caption=page.locator('#evidence-form [name=text]');await caption.fill('New caption while a one-use claim completes.');await caption.evaluate(node=>(node as HTMLTextAreaElement).setSelectionRange(4,4));release();
    await expect.poll(async()=>(await credentials(page)).token).toBe(issued);await expect(page.locator('#shared-link')).toHaveValue(`${baseURL}/?challenge=${owner.id}#access=${issued}`);
    await expect(page.locator('#challenge-revision')).toContainText('proposer seat');await expect(caption).toHaveValue('New caption while a one-use claim completes.');await expect(caption).toBeFocused();expect(await caption.evaluate(node=>(node as HTMLTextAreaElement).selectionStart)).toBe(4);
    const claimed=await page.request.get(`/api/challenges/${owner.id}`,{headers:{Authorization:`Bearer ${issued}`}});expect(claimed.status()).toBe(200);expect((await claimed.json() as {myRole:string}).myRole).toBe('arbiter');
    await page.getByRole('button',{name:'My private access link',exact:true}).click();await expect(page.locator('#shared-link')).toHaveValue(`${baseURL}/?challenge=${owner.id}#access=${owner.token}`);
    await page.unroute(`**/api/challenges/${owner.id}/arbiter/join`);
  }finally{release?.();await context.close();}
});
