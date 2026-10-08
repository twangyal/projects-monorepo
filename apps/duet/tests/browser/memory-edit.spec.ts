import {test,expect,type Page} from '@playwright/test';
import {seats,cleanup,request,snapshot} from './saved-mixes-fixtures';
const roomId='a'.repeat(32),trackId='b'.repeat(32),memoryId='c'.repeat(32),token='d'.repeat(64);
const otherRoom='e'.repeat(32);
const original={id:memoryId,trackId,trackTitle:'Original song',date:'2026-10-01',text:'Original host words',author:'host',createdAt:1};
async function fixture(page:Page,corrupt: false | 'unreadable' | 'wrong-association' = false){
 let memory={...original},puts=0;
 await page.addInitScript(({roomId,otherRoom,token})=>localStorage.setItem('duet-participants-v1',JSON.stringify({[roomId]:{token,title:'Curated room'},[otherRoom]:{token,title:'Other room'}})),{roomId,otherRoom,token});
 const value=(id=roomId)=>({id,title:id===roomId?'Curated room':'Other room',createdAt:1,serverTime:Date.now(),myRole:'host',profiles:{host:{name:'Alex'},guest:{name:'Partner'}},tracks:[{id:trackId,title:'Original song',artist:'',duration:12,uploadedBy:'host',createdAt:1}],ratings:{[trackId]:{host:0,guest:0}},playlist:[],playlistRevision:0,playback:{trackId:null,playing:false,position:0,revision:0},memories:id===roomId?[memory]:[],blend:[],savedMixes:[],savedMixesRevision:0});
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/status'){await route.fulfill({json:{transport:{mode:'http-loopback',origin:'http://127.0.0.1:4220',setupRequired:false}}});return;}
  if(path.endsWith(`/memories/${memoryId}`)&&route.request().method()==='PUT'){
   puts++;const body=route.request().postDataJSON();if(body.expectedDate!==memory.date||body.expectedText!==memory.text){await route.fulfill({status:409,json:{error:'This memory changed. Your draft is kept.'}});return;}
   memory={...memory,date:body.date,text:body.text};await route.fulfill(corrupt==='unreadable'?{status:200,contentType:'application/json',body:'{"id":'}:{json:corrupt==='wrong-association'?{...value(),memories:[{...memory,trackTitle:'Other song'}]}:value()});return;
  }
  await route.fulfill({json:value(path.split('/')[3])});
 });
 await page.goto(`/?room=${roomId}`);await expect(page.locator('#memory-list')).toContainText(original.text);
 return {winner:(text:string)=>{memory={...memory,text};},puts:()=>puts,room:()=>value()};
}
test('polling and a stale-baseline conflict preserve the exact editing form and focus',async({page})=>{
 const state=await fixture(page);await page.getByRole('button',{name:'Edit memory',exact:true}).click();const text=page.getByLabel('Edit memory text',{exact:true});await text.fill('Literal <draft> café 🌓');const originalNode=await text.elementHandle();state.winner('Other tab winner');await expect(page.locator('#memory-list')).toContainText('Other tab winner');await expect(text).toHaveValue('Literal <draft> café 🌓');expect(await text.evaluate((node,previous)=>node===previous,originalNode)).toBe(true);await expect(text).toBeFocused();
 await page.getByRole('button',{name:'Save memory edit',exact:true}).click();await expect(page.locator('#notice')).toContainText('memory changed');await expect(text).toHaveValue('Literal <draft> café 🌓');expect(state.puts()).toBe(1);await page.getByRole('button',{name:'Cancel memory edit',exact:true}).click();await page.getByRole('button',{name:'Edit memory',exact:true}).click();await expect(text).toHaveValue('Other tab winner');
});
for(const corruption of ['unreadable','wrong-association'] as const)test(`a ${corruption} committed edit retains its draft and never repeats the PUT`,async({page})=>{
 const state=await fixture(page,corruption);await page.getByRole('button',{name:'Edit memory',exact:true}).click();await page.getByLabel('Edit memory text',{exact:true}).fill('Literal corrected café 🌓');await page.getByRole('button',{name:'Save memory edit',exact:true}).click();await expect(page.locator('#notice')).toContainText(/unconfirmed/i);await expect(page.locator('#memory-edit')).toBeVisible();await expect(page.getByLabel('Edit memory text',{exact:true})).toHaveValue('Literal corrected café 🌓');await expect(page.locator('#memory-list')).toContainText('Literal corrected café 🌓');await page.waitForTimeout(1200);expect(state.puts()).toBe(1);
});
test('390px editing corrects date/text and a declined departure retains raw words',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:844});const state=await fixture(page);await page.getByRole('button',{name:'Edit memory',exact:true}).click();await page.getByLabel('Edit memory text',{exact:true}).fill('Unsent words');page.once('dialog',dialog=>dialog.dismiss());await page.locator('#leave-room').click();await expect(page.getByLabel('Edit memory text',{exact:true})).toHaveValue('Unsent words');await page.getByLabel('Edit memory date',{exact:true}).fill('2026-10-08');await page.screenshot({path:testInfo.outputPath('memory-edit-mobile.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'Save memory edit',exact:true}).click();await expect(page.locator('#memory-edit')).toBeHidden();await expect(page.locator('#memory-list')).toContainText('Unsent words');await expect(page.locator('#memory-list')).toContainText('2026-10-08');expect(state.puts()).toBe(1);
});
for(const lifecycle of ['saved-room-navigation','pagehide-pageshow'] as const)test(`a pending edit retires its busy ownership on ${lifecycle} without late publication`,async({page})=>{
 const state=await fixture(page);let release!:()=>void,requested!:()=>void;const gate=new Promise<void>(r=>release=r),pending=new Promise<void>(r=>requested=r);
 await page.route(`**/api/rooms/${roomId}/memories/${memoryId}`,async route=>{requested();await gate;state.winner('Held corrected words');await route.fulfill({json:state.room()});});
 await page.getByRole('button',{name:'Edit memory',exact:true}).click();await page.getByLabel('Edit memory text',{exact:true}).fill('Held corrected words');await page.getByRole('button',{name:'Save memory edit',exact:true}).click();await pending;
 if(lifecycle==='saved-room-navigation'){page.once('dialog',dialog=>dialog.accept());await page.evaluate(id=>{history.replaceState(null,'',`?room=${id}#ignored`);dispatchEvent(new HashChangeEvent('hashchange'));},otherRoom);await expect(page.locator('#room-heading')).toHaveText('Other room');}
 else {await page.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});await expect(page.getByLabel('Edit memory text',{exact:true})).toBeEnabled();await expect(page.getByLabel('Edit memory text',{exact:true})).toHaveValue('Held corrected words');await expect(page.locator('#notice')).toContainText(/unconfirmed/i);}
 await expect(page.locator('#memory-text')).toBeEnabled();release();await page.waitForTimeout(150);
 if(lifecycle==='saved-room-navigation'){await expect(page.locator('#room-heading')).toHaveText('Other room');await expect(page.locator('#memory-edit')).toBeHidden();await expect(page.locator('#memory-list')).not.toContainText('Held corrected words');}else{await expect(page.locator('#memory-edit')).toBeVisible();await expect(page.getByLabel('Edit memory text',{exact:true})).toHaveValue('Held corrected words');}
});
test('real author edit survives both seats, export and removed audio without changing identity',async({page,browser,baseURL})=>{
 const state=await seats(page,browser,baseURL);
 try{
  const added=await request(page,'/memories','POST',{trackId:state.ids[0],date:'2026-10-01',text:'Original author memory'});expect(added.status).toBe(200);const before=(added.value.memories[0] as typeof original);await expect(page.locator('#memory-list')).toContainText(before.text);await expect(state.guest.getByRole('button',{name:'Edit memory',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Edit memory',exact:true}).click();await page.getByLabel('Edit memory text',{exact:true}).fill('Corrected literal <story> café 🌓');await page.getByLabel('Edit memory date',{exact:true}).fill('2026-10-08');await page.getByRole('button',{name:'Save memory edit',exact:true}).click();await expect(page.locator('#memory-edit')).toBeHidden();await expect(state.guest.locator('#memory-list')).toContainText('Corrected literal <story> café 🌓');const expected={...before,text:'Corrected literal <story> café 🌓',date:'2026-10-08'};expect((await snapshot(page)).memories).toEqual([expected]);
  expect((await request(state.guest,`/memories/${before.id}`,'PUT',{date:'2026-10-08',text:'Unauthorized',expectedDate:expected.date,expectedText:expected.text})).status).toBe(403);
  expect((await request(page,`/tracks/${state.ids[0]}`,'DELETE',{})).status).toBe(200);await expect(page.locator('#memory-list')).toContainText('Audio removed');await page.getByRole('button',{name:'Edit memory',exact:true}).click();await page.getByLabel('Edit memory text',{exact:true}).fill('Audio gone; this memory remains');await page.getByRole('button',{name:'Save memory edit',exact:true}).click();await expect(page.locator('#memory-edit')).toBeHidden();await page.reload();await expect(page.locator('#memory-list')).toContainText('Audio gone; this memory remains');expect((await request(page,'/export')).value.memories).toEqual([{...expected,text:'Audio gone; this memory remains'}]);
 }finally{await cleanup(page);await state.close();}
});
