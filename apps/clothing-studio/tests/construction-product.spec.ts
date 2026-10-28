import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const copyName='Replace 3D product with this skirt';
async function backup(page:Page){const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Export project backup',exact:true}).click();return JSON.parse(await readFile((await(await wait).path())!,'utf8'));}
async function openSkirt(page:Page){await page.getByRole('button',{name:'Skirt construction',exact:true}).click();return page.getByRole('dialog',{name:'Skirt construction',exact:true});}
async function apply(page:Page){for(const [key,v]of [['waist','90'],['hem','190'],['slant','65']])await page.locator(`#construction-${key}`).fill(v);await page.getByRole('button',{name:'Apply measured pattern',exact:true}).click();}
for(const width of [1280,390])test(`applied skirt enters product styling, Undo, saved reload and measured exports at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:800});await page.goto('/');
 await page.getByRole('button',{name:'Templates',exact:true}).click();await page.getByRole('button',{name:/^Use the Breton stripe template/}).click();await page.getByRole('button',{name:'Back to garment',exact:true}).click();
 let dialog=await openSkirt(page);await expect(dialog.getByRole('button',{name:copyName,exact:true})).toBeDisabled();
 await apply(page);await dialog.locator('#construction-waistband').check();await page.getByRole('button',{name:'Apply measured pattern',exact:true}).click();
 await page.keyboard.press('Escape');const before=await backup(page);dialog=await openSkirt(page);
 await expect(dialog.locator('#construction-product-help')).toContainText('not copied');await dialog.getByRole('button',{name:copyName,exact:true}).click();
 await expect(dialog.locator('#message')).toContainText('Copied applied skirt measurements');
 await dialog.getByRole('button',{name:'Back to garment',exact:true}).click();
 const copied=await backup(page);expect(copied.product.base).toBe('skirt');expect(copied.product.measurements).toEqual({waist:90,hem:190,slant:65,waistbandHeight:3});expect(copied.product.parts.waistband.material).toBe('linen-170');expect(copied.construction).toEqual(before.construction);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await backup(page)).toEqual(before);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await backup(page)).toEqual(copied);
 await page.getByRole('button',{name:'Materials & prints',exact:true}).click();await page.getByRole('button',{name:'Apply Denim twill',exact:true}).click();await page.getByRole('button',{name:'Back to garment',exact:true}).click();
 const styled=await backup(page);expect(styled.product.parts.front.material).toBe('denim-340');expect(styled.construction).toEqual(before.construction);
 await expect(page.locator('#save-state')).toContainText('Locally saved');await page.reload();expect(await backup(page)).toEqual(styled);
 await page.getByRole('button',{name:'Exports',exact:true}).click();const model=page.waitForEvent('download');await page.locator('#product-glb').click();expect((await readFile((await(await model).path())!)).subarray(0,4).toString()).toBe('glTF');await page.getByRole('button',{name:'Back to garment',exact:true}).click();await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();const download=page.waitForEvent('download');await page.locator('#pattern-svg').click();const svg=await readFile((await(await download).path())!,'utf8');expect(svg).toContain('<svg');expect(svg).toContain('Measured skirt');expect(svg).toContain('data-piece="waistband"');await expect(page.getByLabel('Skirt waistband height (cm)',{exact:true})).toHaveValue('3');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('unapplied pattern, grading, body and hidden product drafts refuse without losing work',async({page})=>{
 await page.goto('/');let dialog=await openSkirt(page);await apply(page);await dialog.locator('#construction-waist').fill('');await dialog.getByRole('button',{name:copyName,exact:true}).click();await expect(dialog.locator('#message')).toContainText('pattern and grading drafts');await expect(dialog.locator('#construction-waist')).toHaveValue('');
 await dialog.getByRole('button',{name:'Discard pattern edits',exact:true}).click();await dialog.locator('#grading-waistStep').fill('');await dialog.getByRole('button',{name:copyName,exact:true}).click();await expect(dialog.locator('#message')).toContainText('pattern and grading drafts');await expect(dialog.locator('#grading-waistStep')).toHaveValue('');await dialog.getByRole('button',{name:'Discard grading edits',exact:true}).click();
 await dialog.locator('#body-enabled').check();await dialog.locator('#body-waist').fill('');await dialog.getByRole('button',{name:copyName,exact:true}).click();await expect(dialog.locator('#message')).toContainText('raw concept fields');await expect(dialog.locator('#body-waist')).toHaveValue('');await dialog.getByRole('button',{name:'Discard body edits',exact:true}).click();
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();await page.getByLabel('Body length (cm)',{exact:true}).fill('');dialog=await openSkirt(page);await dialog.getByRole('button',{name:copyName,exact:true}).click();await expect(dialog.locator('#message')).toContainText('pending product edits');await page.keyboard.press('Escape');await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();await expect(page.getByLabel('Body length (cm)',{exact:true})).toHaveValue('');
});
