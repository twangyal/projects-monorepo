import {test,expect,type Page} from '@playwright/test';
import {cleanup} from './saved-mixes-fixtures';
const a='a'.repeat(32),b='b'.repeat(32),token='c'.repeat(64),invitation='d'.repeat(64);
async function rooms(page:Page){
 let joined=false;
 await page.addInitScript(({a,b,token})=>localStorage.setItem('duet-participants-v1',JSON.stringify({[a]:{token,title:'Room A'},[b]:{token,title:'Room B'}})),{a,b,token});
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/status'){await route.fulfill({json:{transport:{mode:'http-loopback',origin:'http://127.0.0.1:4220',setupRequired:false}}});return;}
  const id=path.split('/')[3];await route.fulfill({json:{id,title:id===a?'Room A':'Room B',createdAt:1,serverTime:Date.now(),myRole:'host',profiles:{host:{name:'Alex'},guest:joined?{name:'Partner'}:null},tracks:[],ratings:{},playlist:[],playlistRevision:0,playback:{trackId:null,playing:false,position:0,revision:0},memories:[],blend:[],savedMixes:[],savedMixesRevision:0}});
 });
 await page.goto(`/?room=${a}`);await expect(page.locator('#room-heading')).toHaveText('Room A');
 return {join:()=>{joined=true;}};
}
test('rotation serializes one private seat across duplicate clicks and Home/reopen',async({page})=>{
 await rooms(page);let posts=0,release!:()=>void,requested!:()=>void;const gate=new Promise<void>(r=>release=r),pending=new Promise<void>(r=>requested=r);
 await page.route(`**/api/rooms/${a}/invite`,async route=>{posts++;requested();await gate;await route.fulfill({json:{inviteToken:invitation}});});
 await page.locator('#invite').click();await pending;await expect(page.locator('#invite')).toBeDisabled();
 await page.locator('#invite').dispatchEvent('click');await page.locator('#leave-room').click();await page.getByRole('button',{name:'Room A',exact:true}).click();await expect(page.locator('#invite')).toBeDisabled();
 await page.locator('#invite').dispatchEvent('click');expect(posts).toBe(1);release();await expect(page.locator('#invite')).toBeEnabled();await expect(page.locator('#link-panel')).toBeHidden();
 await page.locator('#invite').click();await expect(page.locator('#share-link')).toHaveValue(new RegExp(`room=${a}#invite=${invitation}$`));expect(posts).toBe(2);
});
for(const reply of ['unreadable','bad-token','extra-field','network-error'])test(`a ${reply} rotation hides the previous invitation and never retries automatically`,async({page})=>{
 await rooms(page);let posts=0;
 await page.route(`**/api/rooms/${a}/invite`,async route=>{posts++;if(posts===1){await route.fulfill({json:{inviteToken:invitation}});return;}if(reply==='network-error'){await route.abort('failed');return;}await route.fulfill(reply==='unreadable'?{status:200,contentType:'application/json',body:'{"inviteToken":'}:{json:reply==='bad-token'?{inviteToken:'undefined'}:{inviteToken:invitation,extra:true}});});
 await page.locator('#invite').click();await expect(page.locator('#link-panel')).toBeVisible();await page.locator('#invite').click();await expect(page.locator('#notice')).toContainText(/unconfirmed/i);await expect(page.locator('#link-panel')).toBeHidden();await expect(page.locator('#share-link')).toHaveValue('');await page.waitForTimeout(1200);expect(posts).toBe(2);
});
test('a guest joining before a held rotation reply prevents publishing a consumed invitation',async({page})=>{
 const state=await rooms(page);let release!:()=>void,requested!:()=>void;const gate=new Promise<void>(r=>release=r),pending=new Promise<void>(r=>requested=r);
 await page.route(`**/api/rooms/${a}/invite`,async route=>{requested();await gate;await route.fulfill({json:{inviteToken:invitation}});});
 await page.locator('#invite').click();await pending;state.join();await expect(page.locator('#participants')).toContainText('Partner');release();await expect(page.locator('#notice')).toContainText('already joined');await expect(page.locator('#link-panel')).toBeHidden();
});
test('a pending first-room rotation does not lock or publish into another room',async({page})=>{
 await rooms(page);let release!:()=>void,requested!:()=>void;const gate=new Promise<void>(r=>release=r),pending=new Promise<void>(r=>requested=r);
 await page.route(`**/api/rooms/${a}/invite`,async route=>{requested();await gate;await route.fulfill({status:500,json:{error:'Late old failure'}});});
 await page.route(`**/api/rooms/${b}/invite`,route=>route.fulfill({json:{inviteToken:'e'.repeat(64)}}));
 await page.locator('#invite').click();await pending;await page.locator('#leave-room').click();await page.getByRole('button',{name:'Room B',exact:true}).click();await expect(page.locator('#invite')).toBeEnabled();await page.locator('#invite').click();await expect(page.locator('#share-link')).toHaveValue(new RegExp(`room=${b}#invite=${'e'.repeat(64)}$`));release();await page.waitForTimeout(150);await expect(page.locator('#notice')).not.toContainText('Late old failure');await expect(page.locator('#share-link')).toHaveValue(new RegExp(`room=${b}#invite=`));
});
test('a real rotated invitation can claim the second seat',async({page,browser,baseURL})=>{
 await page.goto('/');await page.locator('#host-name').fill('Host');await page.locator('#room-title').fill('Rotated real room');await page.getByRole('button',{name:'Create our room',exact:true}).click();await expect(page.locator('#room-view')).toBeVisible();await page.locator('#close-link').click();
 const context=await browser.newContext({baseURL});
 try{await page.locator('#invite').click();await expect(page.locator('#share-link')).toHaveValue(/#invite=[a-f0-9]{64}$/);const link=await page.locator('#share-link').inputValue(),guest=await context.newPage();await guest.goto(link);await guest.locator('#guest-name').fill('Partner');await guest.getByRole('button',{name:'Join the room',exact:true}).click();await expect(guest.locator('#room-view')).toBeVisible();await expect(guest.locator('#participants')).toContainText('Partner');}finally{await cleanup(page);await context.close();}
});
