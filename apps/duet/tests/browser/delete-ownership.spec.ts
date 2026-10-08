import {test,expect,type Page,type Route} from '@playwright/test';
const key='duet-participants-v1';
async function create(page:Page,title:string){
 await page.locator('#host-name').fill('Synthetic host');await page.locator('#room-title').fill(title);await page.getByRole('button',{name:'Create our room',exact:true}).click();await expect(page.locator('#room-heading')).toHaveText(title);await page.locator('#close-link').click();return new URL(page.url()).searchParams.get('room')!;
}
async function cleanup(page:Page){
 const entries=await page.evaluate(key=>Object.entries(JSON.parse(localStorage.getItem(key)||'{}')) as [string,{token:string}][],key);
 for(const [id,auth] of entries)await page.request.delete(`/api/rooms/${id}`,{headers:{Authorization:`Bearer ${auth.token}`},data:{}});
}
async function heldDelete(page:Page,id:string,success:boolean){
 let release!:()=>void,admitted!:()=>void;const ready=new Promise<void>(r=>admitted=r),wait=new Promise<void>(r=>release=r);
 const pattern=`**/api/rooms/${id}`,handler=async(route:Route)=>{
  if(route.request().method()!=='DELETE'){await route.continue();return;}
  const result=success?await route.fetch():null;admitted();await wait;
  if(result)await route.fulfill({response:result});else await route.fulfill({status:500,json:{error:'Synthetic delayed deletion failure'}});
 };
 await page.route(pattern,handler);return{ready,release,close:async()=>{release();await page.unroute(pattern,handler);}};
}
for(const scenario of ['success-b','error-b','error-a','success-home'] as const)test(`late deletion ${scenario} keeps newer generation and drafts`,async({page})=>{
 await page.goto('/');const a=await create(page,'Synthetic A');await page.locator('#leave-room').click();const b=await create(page,'Synthetic B');await page.locator('#leave-room').click();await page.locator('.saved-room').filter({hasText:'Synthetic A'}).click();await expect(page.locator('#room-heading')).toHaveText('Synthetic A');
 const success=scenario.startsWith('success'),gate=await heldDelete(page,a,success);
 try{
  page.once('dialog',d=>d.accept());await page.locator('#delete-room').click();await gate.ready;await page.locator('#leave-room').click();
  const home=scenario==='success-home',target=scenario==='error-a'?a:b,title=scenario==='error-a'?'Synthetic A':'Synthetic B';
  if(!home){await page.locator('.saved-room').filter({hasText:title}).click();await expect(page.locator('#room-heading')).toHaveText(title);await page.locator('#memory-text').fill('Unsaved newer memory');await page.locator('#mix-name').fill('Unsaved newer mix');await page.locator('#room-export').click();await expect(page.locator('#notice')).toContainText('Room notes exported');}
  const notice=await page.locator('#notice').textContent(),response=page.waitForResponse(r=>r.request().method()==='DELETE'&&new URL(r.url()).pathname===`/api/rooms/${a}`);gate.release();await(await response).finished();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(await page.locator('#notice').textContent()).toBe(notice);
  if(home){await expect(page.locator('#welcome')).toBeVisible();await expect(page.locator('.saved-room').filter({hasText:'Synthetic A'})).toHaveCount(0);await expect(page.locator('.saved-room').filter({hasText:'Synthetic B'})).toHaveCount(1);}
  else{await expect(page.locator('#room-view')).toBeVisible();await expect(page.locator('#room-heading')).toHaveText(title);expect(new URL(page.url()).searchParams.get('room')).toBe(target);await expect(page.locator('#memory-text')).toHaveValue('Unsaved newer memory');await expect(page.locator('#mix-name')).toHaveValue('Unsaved newer mix');}
  const ids=await page.evaluate(key=>Object.keys(JSON.parse(localStorage.getItem(key)||'{}')),key);expect(ids.includes(a)).toBe(!success);expect(ids).toContain(b);
 }finally{await gate.close();await cleanup(page);}
});
test('current deletion still removes only its original synthetic room and returns home',async({page})=>{
 await page.goto('/');const a=await create(page,'Current deletion');page.once('dialog',d=>d.accept());await page.locator('#delete-room').click();await expect(page.locator('#welcome')).toBeVisible();await expect(page.locator('#notice')).toContainText('selected room was deleted');expect(await page.evaluate(key=>Object.keys(JSON.parse(localStorage.getItem(key)||'{}')),key)).not.toContain(a);
});
