import {test,expect} from '@playwright/test';
for(const width of [1440,390]) test(`no typing visual taste to personal inspiration at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.goto('/');
 await expect(page.getByRole('heading',{name:'Find your starting point'})).toBeVisible();
 await expect(page.locator('#piece-form')).toBeHidden();await expect(page.locator('#profile-form')).toBeHidden();
 await page.getByRole('button',{name:'Choose pictured styles',exact:true}).click();
 const cards=page.locator('.inspiration-choice');await expect(cards).toHaveCount(12);
 await expect(cards.first().getByRole('img')).toBeVisible();
 await cards.nth(0).getByRole('button',{name:'Like',exact:true}).click();
 await cards.nth(1).getByRole('button',{name:'Pass',exact:true}).click();
 await page.getByRole('button',{name:'See inspiration',exact:true}).click();
 await expect(page.getByRole('heading',{name:'A few directions for you'})).toBeVisible();
 await expect(page.locator('#inspiration-results .inspiration-result')).toHaveCount(3);
 await expect(page.locator('#inspiration-evidence')).toContainText('2');
 await expect(page.locator('#inspiration-evidence')).toContainText('tag');
 await expect(page.locator('#inspiration-results')).toContainText('Example outfit');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`inspiration-${width}.png`),fullPage:true});
 await page.getByRole('button',{name:'Profile & backup',exact:true}).click();
 const d=page.waitForEvent('download');await page.locator('#export-profile').click();const download=await d;
 const stream=await download.createReadStream(),chunks:Buffer[]=[];for await(const c of stream!)chunks.push(Buffer.from(c));
 const profile=JSON.parse(Buffer.concat(chunks).toString());expect(profile.examples).toHaveLength(2);expect(profile.examples.map((x:{label:string})=>x.label).sort()).toEqual(['like','pass']);expect(profile.pieces).toHaveLength(0);
 await expect(page.locator('#save-status')).toContainText('Saved on this device');await page.reload();
 await expect(page.getByRole('heading',{name:'A few directions for you'})).toBeVisible();
 await page.getByRole('button',{name:'Picture preferences',exact:true}).click();
 await expect(page.locator('.inspiration-choice').nth(0).getByRole('button',{name:'Like',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.inspiration-choice').nth(1).getByRole('button',{name:'Pass',exact:true})).toHaveAttribute('aria-pressed','true');
});
test('keyboard skip reveals its named workspace and focused navigation retains raw form identity',async({page})=>{
 await page.goto('/');await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to wardrobe',exact:true})).toBeFocused();await page.keyboard.press('Enter');
 await expect(page.locator('#wardrobe')).toBeVisible();await expect(page.getByRole('heading',{name:'Your wardrobe',exact:true})).toBeFocused();const field=page.locator('#piece-name');await field.fill('Keep this unsubmitted shirt');
 await field.evaluate(n=>{n.dataset.journeyIdentity='same';(n as HTMLInputElement).setSelectionRange(4,8);});
 await page.getByRole('button',{name:'Picture preferences',exact:true}).click();await page.keyboard.press('Escape');
 await expect(page.getByRole('button',{name:'Inspiration',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'Wardrobe',exact:true}).click();await expect(field).toHaveValue('Keep this unsubmitted shirt');await expect(field).toHaveAttribute('data-journey-identity','same');
 expect(await field.evaluate(n=>[(n as HTMLInputElement).selectionStart,(n as HTMLInputElement).selectionEnd])).toEqual([4,8]);
});
test('skipping onboarding creates no opinion or owned piece and does not repeat on return',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Skip to inspiration',exact:true}).click();await expect(page.locator('#inspiration-evidence')).toContainText('unranked');
 await page.reload();await expect(page.getByRole('heading',{name:'A few directions for you'})).toBeVisible();await page.getByRole('button',{name:'Picture preferences',exact:true}).click();
 await expect(page.locator('#picture-preferences')).toContainText('0 of 12');
});
test('sample and imported labels keep their provenance in focused inspiration after reload',async({page})=>{
 page.on('dialog',d=>d.accept());await page.goto('/');await page.getByRole('button',{name:'Profile & backup',exact:true}).click();await page.locator('#load-sample').click();
 await page.getByRole('button',{name:'Inspiration',exact:true}).click();await expect(page.locator('#inspiration-evidence')).toContainText('sample labels');await expect(page.locator('#inspiration-evidence')).toContainText('not your preferences');
 await expect(page.locator('#save-status')).toContainText('Saved on this device');await page.reload();await expect(page.locator('#inspiration-evidence')).toContainText('sample labels');
});
test('phone inspiration reaches its first picture before advanced tools and healthy recovery controls',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'Skip to inspiration',exact:true}).click();
 const image=page.locator('#inspiration-results').getByRole('img').first();await expect(image).toBeVisible();expect((await image.boundingBox())!.y).toBeLessThan(600);
 await expect(page.locator('#retry-load')).toBeHidden();await page.getByText('More tools',{exact:true}).click();await expect(page.getByRole('button',{name:'Your taste',exact:true})).toBeVisible();
});
test('focused picture votes correct one opinion and keep Undo and Redo complete',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Choose pictured styles',exact:true}).click();const card=page.locator('.inspiration-choice').first();
 await card.getByRole('button',{name:'Like',exact:true}).click();await card.getByRole('button',{name:'Pass',exact:true}).click();await expect(card.getByRole('button',{name:'Pass',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(card.getByRole('button',{name:'Like',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(card.getByRole('button',{name:'Pass',exact:true})).toHaveAttribute('aria-pressed','true');
 await card.getByRole('button',{name:'Clear',exact:true}).click();await expect(page.locator('#picture-preferences')).toContainText('0 of 12');
});
test('a pending real profile read survives navigation while global cancellation refuses late replacement',async({page})=>{
 page.on('dialog',d=>d.accept());await page.goto('/');await page.getByRole('button',{name:'Profile & backup',exact:true}).click();
 await page.evaluate(()=>{const native=File.prototype.text;Object.assign(window,{style264Reading:false,style264Release:()=>{}});File.prototype.text=async function(){const text=await native.call(this);(window as unknown as{style264Reading:boolean}).style264Reading=true;await new Promise<void>(resolve=>{(window as unknown as{style264Release:()=>void}).style264Release=resolve;});return text;};});
 const incoming={schemaVersion:1,title:'Held imported preference profile',pieces:[],examples:[],looks:[],photos:[]};
 const load=async()=>{await page.evaluate(()=>(window as unknown as{style264Reading:boolean}).style264Reading=false);await page.locator('#profile-import').setInputFiles({name:'held.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});await page.waitForFunction(()=>(window as unknown as{style264Reading:boolean}).style264Reading);};
 await load();await page.waitForFunction(()=>(window as unknown as{style264Reading:boolean}).style264Reading);await page.getByRole('button',{name:'Wardrobe',exact:true}).click();await expect(page.locator('#cancel-operation')).toBeVisible();expect((await page.locator('#cancel-operation').boundingBox())!.y).toBeLessThan(600);
 await page.evaluate(()=>(window as unknown as{style264Release:()=>void}).style264Release());await expect(page.locator('#cancel-operation')).toBeHidden();await page.getByRole('button',{name:'Profile & backup',exact:true}).click();await expect(page.locator('#profile-title')).toHaveValue(incoming.title);
 await page.locator('#profile-title').fill('Keep current profile');await page.locator('#profile-form button').click();await load();await page.getByRole('button',{name:'Wardrobe',exact:true}).click();await page.locator('#cancel-operation').click();await page.evaluate(()=>(window as unknown as{style264Release:()=>void}).style264Release());await page.getByRole('button',{name:'Profile & backup',exact:true}).click();await expect(page.locator('#profile-title')).toHaveValue('Keep current profile');
});
test('choosing a screen during real restored-photo decoding does not jump away when restore finishes',async({page})=>{
 page.on('dialog',d=>d.accept());await page.goto('/');await page.getByRole('button',{name:'Profile & backup',exact:true}).click();
 const photo=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=720;c.getContext('2d')!.fillRect(0,0,720,720);return c.toDataURL('image/jpeg');});
 const p={schemaVersion:1,title:'A returning photo wardrobe',pieces:[{id:'1'.repeat(32),name:'Actual owned shirt',category:'top',tags:{palette:'neutral',fit:'regular',style:'minimal',formality:'casual'},photoId:'2'.repeat(32)}],examples:[],looks:[],photos:[{id:'2'.repeat(32),mime:'image/jpeg',width:720,height:720,dataUrl:photo}]};
 await page.locator('#profile-import').setInputFiles({name:'photo-profile.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});await expect(page.locator('#save-status')).toContainText('Saved on this device');
 await page.addInitScript(()=>{const native=createImageBitmap;Object.assign(window,{style264DecodeStarted:false,style264ReleaseDecode:()=>{}});globalThis.createImageBitmap=(async(...args:unknown[])=>{const bitmap=await Reflect.apply(native,globalThis,args);(window as unknown as{style264DecodeStarted:boolean}).style264DecodeStarted=true;await new Promise<void>(resolve=>(window as unknown as{style264ReleaseDecode:()=>void}).style264ReleaseDecode=resolve);return bitmap;}) as typeof createImageBitmap;});
 await page.reload();await page.waitForFunction(()=>(window as unknown as{style264DecodeStarted:boolean}).style264DecodeStarted);await page.getByRole('button',{name:'Profile & backup',exact:true}).click();await expect(page.locator('#profile-form')).toBeVisible();
 await page.evaluate(()=>(window as unknown as{style264ReleaseDecode:()=>void}).style264ReleaseDecode());await expect(page.locator('#save-status')).toContainText('Saved on this device');await expect(page.locator('#profile-form')).toBeVisible();await expect(page.locator('#profile-title')).toHaveValue(p.title);
});
