import {test,expect,type Page} from '@playwright/test';import {readFile} from 'node:fs/promises';
async function position(page:Page):Promise<number[]>{return(await page.locator('#position').innerText()).split(',').map(Number);}
async function move(page:Page,x:number,y:number){
  for(const axis of [0,1]){const p=await position(page),target=axis===0?x:y,delta=target-p[axis];if(Math.abs(delta)<3)continue;
    const key=axis===0?(delta>0?'d':'a'):(delta>0?'s':'w');await page.keyboard.down(key);await page.clock.runFor(Math.abs(delta)/130*1000+16);await page.keyboard.up(key);
  }
}
async function interact(page:Page,ms=100){await page.keyboard.down('e');await page.clock.runFor(ms);await page.keyboard.up('e');}
async function start(page:Page){await page.clock.install();await page.goto('/');await page.locator('#scares').uncheck();await page.getByRole('button',{name:'Calibrate & start',exact:true}).click();await page.clock.runFor(50);}
async function report(page:Page){const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download run report',exact:true}).click();const file=await pending;return JSON.parse(await readFile((await file.path())!,'utf8'));}

test('real keyboard escape exports simulated evidence and persists only preferences/best time',async({page,baseURL})=>{
  const errors:string[]=[],external:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(baseURL!).origin)external.push(r.url());});
  await start(page);await move(page,250,110);await interact(page);await expect(page.locator('#goal-fuse')).toHaveClass('done');
  await move(page,520,230);await interact(page);await expect(page.locator('#goal-power')).toHaveClass('done');
  await move(page,740,110);await interact(page);await expect(page.locator('#goal-key')).toHaveClass('done');
  await move(page,1030,160);await page.getByRole('button',{name:'Steady: off',exact:true}).click();await interact(page,4200);await expect(page.locator('#lock')).toHaveText('100%');
  await page.getByRole('button',{name:'Steady: on',exact:true}).click();await page.locator('canvas').focus();await move(page,1160,160);await interact(page);await expect(page.locator('#phase')).toHaveText('Escaped');
  const downloaded=await report(page);expect(downloaded.source).toBe('simulated');expect(downloaded.outcome).toBe('won');expect(downloaded.objectives).toEqual({fuse:true,power:true,key:true,unlocked:true});expect(downloaded.samples.length).toBeGreaterThan(5);expect(downloaded.events.map((e:{kind:string})=>e.kind)).toEqual(['start','fuse','power','key','unlock','win']);
  const saved=await page.evaluate(()=>localStorage.getItem('composure-settings-v1'));expect(saved).not.toContain('samples');expect(saved).not.toContain('events');expect(JSON.parse(saved!).bestSeconds).toBeGreaterThan(4);
  await page.reload();await expect(page.locator('#best')).toContainText('Best completed run');await expect(page.locator('#phase')).toHaveText('Ready to calibrate');expect(errors).toEqual([]);expect(external).toEqual([]);
});

test('stale signal, paused time, blur and focused settings never advance held controls',async({page})=>{
  await start(page);await page.locator('#sampling').uncheck();await page.locator('#reading').focus();await page.keyboard.press('End');await page.getByRole('button',{name:'Send one simulated sample',exact:true}).click();await page.clock.runFor(5000);await expect(page.locator('#tension')).not.toHaveText('0%');
  await page.getByRole('button',{name:'Pause',exact:true}).click();const before=await position(page);const time=await page.locator('#timer').innerText();await page.clock.runFor(30000);expect(await position(page)).toEqual(before);await expect(page.locator('#timer')).toHaveText(time);
  await page.getByRole('button',{name:'Resume',exact:true}).click();await page.clock.runFor(16000);await expect(page.locator('#sensor')).toContainText('stale');await expect(page.locator('#tension')).toHaveText('0%');
  await page.locator('#baseline').focus();await page.keyboard.down('ArrowRight');await page.clock.runFor(1000);await page.keyboard.up('ArrowRight');expect(await position(page)).toEqual(before);
  await page.locator('canvas').focus();await page.keyboard.down('d');await page.clock.runFor(100);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('d');await expect(page.locator('#phase')).toHaveText('Paused');
  await page.getByRole('button',{name:'Resume',exact:true}).click();const after=await position(page);await page.clock.runFor(1000);expect(await position(page)).toEqual(after);
  await page.getByRole('button',{name:'Restart',exact:true}).click();await page.clock.runFor(50);await expect(page.locator('#position')).toHaveText('80, 160');await expect(page.locator('#goal-fuse')).not.toHaveClass('done');
});

test('high simulated input can lose from noise while missing lock prerequisites stay locked',async({page})=>{
  await start(page);await move(page,1030,160);await interact(page,5000);await expect(page.locator('#lock')).toHaveText('0%');
  await page.getByRole('button',{name:'Restart',exact:true}).click();await page.locator('#reading').focus();await page.keyboard.press('End');await page.getByRole('button',{name:'Send one simulated sample',exact:true}).click();await page.locator('canvas').focus();await page.keyboard.down('d');await page.clock.runFor(15000);await page.keyboard.up('d');await expect(page.locator('#phase')).toHaveText('Run ended');
  expect((await report(page)).loss).toBe('noise');await page.getByRole('button',{name:'Restart',exact:true}).click();await page.clock.runFor(100);await expect(page.locator('#phase')).toHaveText('In the corridor');await expect(page.locator('#noise')).toHaveText('0 / 100');
});

test('mobile pointer cancellation, comfort preferences and corrupt storage preserve data',async({page})=>{
  await page.setViewportSize({width:390,height:844});await start(page);
  const right=page.getByRole('button',{name:'Move right',exact:true});await right.hover();await page.mouse.down();await page.clock.runFor(500);await page.mouse.up();const moved=await position(page);expect(moved[0]).toBeGreaterThan(100);await page.clock.runFor(500);expect(await position(page)).toEqual(moved);
  await right.hover();await page.mouse.down();await page.clock.runFor(100);await right.dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();const canceled=await position(page);await page.clock.runFor(500);expect(await position(page)).toEqual(canceled);
  await page.locator('#reduced').check();await page.locator('#baseline').fill('80');await page.getByRole('button',{name:'Save preferences',exact:true}).click();await expect(page.locator('#storage-status')).toContainText('saved locally');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.reload();await expect(page.locator('#reduced')).toBeChecked();await expect(page.locator('#baseline')).toHaveValue('80');
  await page.evaluate(()=>localStorage.setItem('composure-settings-v1','{broken'));await page.reload();await expect(page.locator('#storage-status')).toContainText('raw record is kept');await page.getByRole('button',{name:'Save preferences',exact:true}).click();expect(await page.evaluate(()=>localStorage.getItem('composure-settings-v1'))).toBe('{broken');
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Reset unreadable preferences',exact:true}).click();await expect(page.locator('#storage-status')).toContainText('reset');
});
