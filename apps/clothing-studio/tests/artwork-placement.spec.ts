import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function backup(page:Page){const p=page.waitForEvent('download');await page.getByRole('button',{name:'Export project backup',exact:true}).click();return JSON.parse(await readFile((await(await p).path())!,'utf8'));}
async function setup(page:Page,side:'front'|'back'='front'){
 await page.goto('/');await page.getByRole('button',{name:'Templates',exact:true}).click();await page.getByRole('button',{name:/^Use the Blank tee template/}).click();await page.getByRole('button',{name:'Artwork',exact:true}).click();await page.locator('#artwork-side').selectOption(side);
 const image=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=160;c.height=80;c.getContext('2d')!.fillRect(0,0,160,80);return c.toDataURL('image/png').split(',')[1];}),'base64');
 await page.locator('#artwork-file').setInputFiles({name:'centre.png',mimeType:'image/png',buffer:image});await expect(page.locator('#message')).toContainText('Artwork placed');
}
for(const side of ['front','back'] as const)test(`${side} artwork picks the visible garment centre into drafts before one undoable edit`,async({page})=>{
 await setup(page,side);const before=await backup(page);await page.locator('#artwork-width').fill('20');await page.locator('#artwork-rotation').fill('30');
 await page.getByRole('button',{name:'Pick artwork centre in 3D',exact:true}).click();await expect(page.locator('#pick-artwork')).toHaveAttribute('aria-pressed','true');
 const box=(await page.locator('#product-canvas').boundingBox())!;await page.mouse.click(box.x+box.width*.45,box.y+box.height*.5);
 await expect(page.locator('#artwork-placement-status')).toContainText('Apply placement');await expect(page.locator('#pick-artwork')).toHaveAttribute('aria-pressed','false');
 const x=Number(await page.locator('#artwork-x').inputValue()),y=Number(await page.locator('#artwork-y').inputValue());expect(x).toBeLessThan(0);expect(y).toBeGreaterThan(0);expect(await backup(page)).toEqual(before);
 await page.locator('#apply-artwork').click();const after=await backup(page);expect(after.product.artwork[0]).toMatchObject({part:side,xCm:x,yCm:y,widthCm:20,rotation:30});
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await backup(page)).product.artwork).toEqual(before.product.artwork);
});
test('placement mode cancels on Escape and refuses empty space or an invalid width without erasing drafts',async({page})=>{
 await setup(page);await page.locator('#artwork-width').fill('1');await page.locator('#pick-artwork').click();await expect(page.locator('#artwork-placement-status')).toContainText('width');await expect(page.locator('#artwork-width')).toHaveValue('1');
 await page.locator('#artwork-width').fill('20');await page.locator('#pick-artwork').click();const box=(await page.locator('#product-canvas').boundingBox())!;
 await page.mouse.click(box.x+5,box.y+5);await expect(page.locator('#artwork-placement-status')).toContainText('visible front');await expect(page.locator('#pick-artwork')).toHaveAttribute('aria-pressed','true');
 await page.keyboard.press('Escape');await expect(page.locator('#pick-artwork')).toHaveAttribute('aria-pressed','false');await expect(page.locator('#artwork-width')).toHaveValue('20');
});
test('phone placement works on the draped surface and retires when the committed design changes',async({page},info)=>{
 test.setTimeout(90000);await page.setViewportSize({width:390,height:900});await setup(page);await page.getByRole('button',{name:'Body & drape',exact:true}).click();await page.getByRole('button',{name:'Drape on a body',exact:true}).click();await expect(page.locator('#garment-drape-status')).toContainText('Draped on a body',{timeout:60000});await page.getByRole('button',{name:'Artwork',exact:true}).click();
 await page.locator('#pick-artwork').click();const box=(await page.locator('#product-canvas').boundingBox())!;await page.mouse.click(box.x+box.width*.52,box.y+box.height*.5);
 await expect(page.locator('#artwork-placement-status')).toContainText('Apply placement');await page.locator('#apply-artwork').click();const before=await backup(page);
 await page.locator('#pick-artwork').click();await page.getByRole('button',{name:'Materials & prints',exact:true}).click();await page.getByRole('button',{name:'Apply Cotton piqué',exact:true}).click();await expect(page.locator('#pick-artwork')).toHaveAttribute('aria-pressed','false');expect((await backup(page)).product.artwork).toEqual(before.product.artwork);
 await page.screenshot({path:info.outputPath('point-placement-phone.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('leaving the artwork tool cancels picking without changing placement drafts',async({page})=>{
 await setup(page);await page.locator('#pick-artwork').click();await page.locator('#workspace-artwork').getByRole('button',{name:'Back to garment',exact:true}).click();
 await expect(page.locator('#pick-artwork')).toHaveAttribute('aria-pressed','false');await page.getByRole('button',{name:'Artwork',exact:true}).click();await expect(page.locator('#artwork-x')).toHaveValue('0');await expect(page.locator('#artwork-y')).toHaveValue('10');
});

for(const side of ['front','back'] as const)test(`${side} lower canvas picks move the artwork centre downward`,async({page})=>{
 await setup(page,side);await page.locator('#artwork-width').fill('20');
 const pick=async(y:number)=>{await page.locator('#pick-artwork').click();const box=(await page.locator('#product-canvas').boundingBox())!;await page.mouse.click(box.x+box.width*.48,box.y+box.height*y);await expect(page.locator('#artwork-placement-status')).toContainText('Apply placement');return Number(await page.locator('#artwork-y').inputValue());};
 const upper=await pick(.45),lower=await pick(.60);expect(lower).toBeGreaterThan(upper+5);
});
