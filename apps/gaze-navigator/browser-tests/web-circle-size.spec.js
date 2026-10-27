import {test,expect} from '@playwright/test';
const panel=page=>page.locator('#gaze-web-navigator section');
async function say(page,text){await panel(page).getByLabel('Typed instruction').fill(text);await panel(page).getByRole('button',{name:'Do it',exact:true}).click();}
async function setup(page){await page.goto('/practice-site/contact.html');await page.evaluate(()=>{const host=document.getElementById('gaze-web-navigator');for(const e of [...document.body.children])if(e!==host)e.remove();const a=document.createElement('a');a.textContent='Nearby page';a.href='#recovered';a.style.cssText='position:fixed;left:240px;top:20px';document.body.append(a);window.clicks=0;a.onclick=()=>window.clicks++;});await page.mouse.move(20,30);}
test('a bigger circle recovers a named missed target only after a fresh instruction',async({page})=>{
 await setup(page);await say(page,'use a small circle');await expect(panel(page).locator('.status')).toContainText('Small');await expect(page.locator('#gaze-web-navigator .circle')).toHaveCSS('width','120px');
 // Beyond the small circle's reach the link is only offered for confirmation; resizing retires that offer.
 await say(page,'open nearby page');await expect(panel(page).locator('.status')).toContainText('not near your gaze');expect(await page.evaluate(()=>window.clicks)).toBe(0);
 await say(page,'make the circle bigger');await expect(panel(page).locator('.status')).toContainText('Medium');await expect(page.locator('#gaze-web-navigator .circle')).toHaveCSS('width','180px');await expect(panel(page).locator('.prompt button')).toHaveCount(0);expect(await page.evaluate(()=>window.clicks)).toBe(0);
 await say(page,'open nearby page');await expect(page).toHaveURL(/#recovered$/);expect(await page.evaluate(()=>window.clicks)).toBe(1);
});
test('size stays bounded, persists, works while paused and manual changes retire confirmation',async({page})=>{
 await setup(page);await page.evaluate(()=>{const b=document.createElement('button');b.textContent='Delete page';b.style.cssText='position:fixed;left:20px;top:20px';b.onclick=()=>window.clicks++;document.body.append(b);});
 await say(page,'click delete page');await expect(panel(page).locator('.prompt')).toContainText('Confirm');
 await panel(page).locator('details.settings').evaluate(d=>{d.open=true;});await panel(page).getByLabel('Circle size').selectOption('large');await expect(panel(page).locator('.prompt button')).toHaveCount(0);await say(page,'confirm');await expect(panel(page).locator('.status')).toContainText('nothing waiting');expect(await page.evaluate(()=>window.clicks)).toBe(0);
 await say(page,'make the circle bigger');await expect(panel(page).getByLabel('Circle size')).toHaveValue('large');await expect(page.locator('#gaze-web-navigator .circle')).toHaveCSS('width','260px');
 await say(page,'pause');await say(page,'use a small circle');await say(page,'make the circle smaller');await expect(panel(page).getByRole('button',{name:'Resume',exact:true})).toHaveAttribute('aria-pressed','true');await expect(panel(page).getByLabel('Circle size')).toHaveValue('small');expect(await page.evaluate(()=>window.clicks)).toBe(0);
 await page.reload();await expect(panel(page).getByLabel('Circle size')).toHaveValue('small');
});
