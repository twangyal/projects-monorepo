import {test,expect} from '@playwright/test';
test('entry centres the garment and task navigation preserves unapplied measurements',async({page})=>{
 await page.goto('/');
 await expect(page.getByRole('navigation',{name:'Garment tools'})).toBeVisible();
 if(process.env.WORKSPACE_SHOTS) await page.screenshot({path:`${process.env.WORKSPACE_SHOTS}/entry.png`});
 const canvas=page.locator('#product-canvas');await expect(canvas).toBeVisible();expect((await canvas.boundingBox())!.y).toBeLessThan(400);
 await expect(page.getByLabel('Concept name')).toBeHidden();await expect(page.locator('#techpack-preview')).toBeHidden();
 await page.getByRole('button',{name:'Templates',exact:true}).click();await page.getByRole('button',{name:/^Use the Blank tee template/}).click();
 await page.getByRole('button',{name:'Back to garment',exact:true}).click();
 await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();
 await page.getByLabel('Body length (cm)',{exact:true}).fill('');
 await page.getByRole('button',{name:'Artwork',exact:true}).click();await expect(page.getByLabel('Body length (cm)',{exact:true})).toBeHidden();
 await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();await expect(page.getByLabel('Body length (cm)',{exact:true})).toHaveValue('');
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Patterns & measurements',exact:true})).toBeFocused();
 await expect(canvas).toBeVisible();
});
test('secondary information is a keyboard-accessible dialog and phone styling returns to the garment',async({page})=>{
 await page.setViewportSize({width:390,height:740});await page.goto('/');
 await page.getByRole('button',{name:'Tech pack',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Tech pack',exact:true});await expect(dialog).toBeVisible();
 expect(await dialog.evaluate(d=>d.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(page.getByRole('button',{name:'Tech pack',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'Concept sketch',exact:true}).click();
 const concept=page.getByRole('dialog',{name:'Concept sketch',exact:true});
 expect(await concept.evaluate(d=>d.scrollWidth<=d.clientWidth)).toBe(true);
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Materials & prints',exact:true}).click();await page.getByRole('button',{name:'Apply color #b23a2e',exact:true}).click();
 await expect(page.locator('#part-color')).toHaveValue('#b23a2e');
 await page.getByRole('button',{name:'Back to garment',exact:true}).click();await expect(page.locator('#part-color')).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.locator('#product-canvas')).toBeInViewport();
});

test('modal validation is visible inside the active dialog',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Skirt construction',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Skirt construction',exact:true});
 await dialog.getByLabel('Waist circumference (cm)',{exact:true}).fill('');
 await dialog.getByRole('button',{name:'Apply measured pattern',exact:true}).click();
 await expect(dialog.locator('#message')).toBeVisible();await expect(dialog.locator('#message')).toContainText('waist is required');
 await page.keyboard.press('Escape');await expect(page.locator('#message')).toBeVisible();
});
test('tool navigation and Escape preserve a genuine pending artwork decode',async({page})=>{
 await page.addInitScript(()=>{const decode=window.createImageBitmap.bind(window);window.createImageBitmap=(async(...args:Parameters<typeof createImageBitmap>)=>{const bitmap=await decode(...args);if(args[0] instanceof File&&args[0].name==='held.png'){(window as unknown as {waiting:boolean}).waiting=true;await new Promise<void>(resolve=>{(window as unknown as {release:()=>void}).release=resolve;});}return bitmap;}) as typeof createImageBitmap;});
 await page.goto('/');await page.getByRole('button',{name:'Templates',exact:true}).click();await page.getByRole('button',{name:/^Use the Blank tee template/}).click();
 await page.getByRole('button',{name:'Artwork',exact:true}).click();
 const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=32;c.getContext('2d')!.fillRect(0,0,32,32);return c.toDataURL('image/png').split(',')[1];});
 await page.locator('#artwork-file').setInputFiles({name:'held.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {waiting:boolean}).waiting)).toBe(true);
 await page.getByRole('button',{name:'Materials & prints',exact:true}).click();await page.keyboard.press('Escape');
 await page.evaluate(()=>(window as unknown as {release:()=>void}).release());await expect(page.locator('#message')).toContainText('Artwork placed');
});
