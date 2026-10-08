import {test,expect,type Page} from '@playwright/test';
const key='composure-settings-v1';
async function position(page:Page):Promise<number[]>{return(await page.locator('#position').innerText()).split(',').map(Number);}
async function move(page:Page,x:number,y:number){for(const axis of [0,1]){const delta=(axis?y:x)-(await position(page))[axis];if(Math.abs(delta)<3)continue;const control=axis?(delta>0?'s':'w'):(delta>0?'d':'a');await page.keyboard.down(control);await page.clock.runFor(Math.abs(delta)/130*1000+16);await page.keyboard.up(control);}}
async function interact(page:Page,ms=100){await page.keyboard.down('e');await page.clock.runFor(ms);await page.keyboard.up('e');}
async function win(page:Page){
 await page.clock.install();await page.locator('#scares').uncheck();await page.locator('#start').click();await page.clock.runFor(50);
 for(const [x,y]of [[250,110],[520,230],[740,110]]){await move(page,x,y);await interact(page);}
 await move(page,1030,160);await page.locator('#steady').click();await interact(page,4200);await expect(page.locator('#lock')).toHaveText('100%');
 await page.locator('#steady').click();await page.locator('canvas').focus();await move(page,1160,160);await interact(page);await expect(page.locator('#phase')).toHaveText('Escaped');
}
async function raw(page:Page){return page.evaluate(key=>localStorage.getItem(key),key);}
async function hold(page:Page){await page.evaluate(key=>new Promise<void>(ready=>{void navigator.locks.request(key,()=>{ready();return new Promise<void>(release=>{(window as unknown as {releaseSettingsLock:()=>void}).releaseSettingsLock=release;});});}),key);}
async function release(page:Page){await page.evaluate(()=>(window as unknown as {releaseSettingsLock:()=>void}).releaseSettingsLock());}

test('an older tab win preserves newer comfort preferences and stale manual saves retain its best',async({page,context})=>{
 await page.goto('/');const older=await context.newPage();await older.goto('/');
 await page.locator('#baseline').fill('90');await page.locator('#reduced').check();await page.locator('#save').click();await expect(page.locator('#storage-status')).toContainText('saved locally');
 const preferred=JSON.parse((await raw(page))!);await win(older);await expect(older.locator('#storage-status')).toContainText('Best completed time saved');
 const won=JSON.parse((await raw(page))!);expect(won).toEqual({...preferred,bestSeconds:won.bestSeconds});expect(won.bestSeconds).toBeGreaterThan(4);
 await page.locator('#save').click();await expect(page.locator('#storage-status')).toContainText('saved locally');expect(await raw(page)).toBe(JSON.stringify(won));
 await older.reload();await expect(older.locator('#baseline')).toHaveValue('90');await expect(older.locator('#reduced')).toBeChecked();await expect(older.locator('#best')).toContainText('Best completed run');
});

test('write-time corrupt bytes and raw fields survive; reset refuses a repaired peer record',async({page,context})=>{
 await page.goto('/');const peer=await context.newPage();await peer.goto('/');await peer.evaluate(key=>localStorage.setItem(key,'{original unreadable'),key);
 await page.locator('#baseline').fill('100');await page.locator('#save').click();await expect(page.locator('#storage-status')).toContainText('raw record was kept');expect(await raw(page)).toBe('{original unreadable');await expect(page.locator('#baseline')).toHaveValue('100');await expect(page.locator('#reset-settings')).toBeVisible();
 const repaired={schemaVersion:1,baseline:85,scares:false,reducedMotion:true,muted:true,bestSeconds:12};await peer.evaluate(({key,repaired})=>localStorage.setItem(key,JSON.stringify(repaired)),{key,repaired});
 page.once('dialog',dialog=>dialog.accept());await page.locator('#reset-settings').click();await expect(page.locator('#storage-status')).toContainText('now readable');expect(await raw(page)).toBe(JSON.stringify(repaired));await expect(page.locator('#baseline')).toHaveValue('100');
});

test('native shared write lock queues a preference save and cancels a stalled request before any write',async({page,context})=>{
 await page.goto('/');const holder=await context.newPage();await holder.goto('/');await hold(holder);
 try{
  await page.locator('#baseline').fill('80');await page.locator('#save').click();await expect(page.locator('#save')).toBeDisabled();expect(await raw(page)).toBeNull();
  await release(holder);await expect(page.locator('#storage-status')).toContainText('saved locally');expect(JSON.parse((await raw(page))!).baseline).toBe(80);
  await hold(holder);await page.locator('#baseline').fill('95');const before=await raw(page);await page.locator('#save').click();await expect(page.locator('#storage-status')).toContainText('waited too long',{timeout:8000});await expect(page.locator('#save')).toBeEnabled();expect(await raw(page)).toBe(before);
  await release(holder);await page.waitForTimeout(100);expect(await raw(page)).toBe(before);await expect(page.locator('#baseline')).toHaveValue('95');
 }finally{await release(holder);}
});

test('unavailable coordinated storage leaves preferences untouched and simulator usable',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'locks',{value:undefined}));await page.goto('/');await page.locator('#baseline').fill('85');await page.locator('#save').click();await expect(page.locator('#storage-status')).toContainText('saving is unavailable');expect(await raw(page)).toBeNull();await page.locator('#start').click();await expect(page.locator('#phase')).toHaveText('In the corridor');
});
