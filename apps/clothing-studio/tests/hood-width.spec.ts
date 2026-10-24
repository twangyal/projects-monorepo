import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
async function download(page: Page, name: string) {
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click();
  return readFile((await (await waiting).path())!);
}
async function backup(page: Page) { return JSON.parse((await download(page, 'Export project backup')).toString()); }
async function setup(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: /^Use the Pullover hoodie template/ }).click();
  await page.getByRole('button', { name: 'Patterns & measurements', exact: true }).click();
  await page.locator('#fit-panel summary').click();
}
const width = (page: Page) => page.getByLabel('Hood side width (cm)', { exact: true });
function hoodPositions(glb: Buffer) {
  const length = glb.readUInt32LE(12), json = JSON.parse(glb.subarray(20, 20 + length).toString());
  const node = json.nodes.find((n: { name: string }) => n.name === 'Hood');
  const accessor = json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION];
  const view = json.bufferViews[accessor.bufferView], offset = 28 + length + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return Array.from({ length: accessor.count * 3 }, (_, i) => glb.readFloatLE(offset + i * 4));
}
test('hood side width reaches pattern GLB POM and complete saved history',async({page})=>{
 await setup(page);await expect(width(page)).toBeVisible();const original=await backup(page);
 await page.getByRole('button',{name:'Exports',exact:true}).click();const prior=hoodPositions(await download(page,'Export 3D model (GLB) ↓'));
 await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();await width(page).fill('34');await page.locator('#apply-fit').click();await expect(page.locator('#message')).toContainText('Fit applied');
 const saved=await backup(page);expect(saved.product.fit).toEqual({hoodWidth:34});expect(await page.locator('[data-piece="hood"] polygon').evaluate(p=>(p as SVGGraphicsElement).getBBox().width)).toBe(34);
 const svg=(await download(page,'Download printable pattern (SVG, 1:1) ↓')).toString();
 const sewnWidth=await page.evaluate(svg=>{const doc=new DOMParser().parseFromString(svg,'image/svg+xml'),polygon=doc.querySelector('[data-piece="hood"]')!.querySelectorAll('polygon')[1];const xs=polygon.getAttribute('points')!.trim().split(/\s+/).map(p=>Number(p.split(',')[0]));return Math.max(...xs)-Math.min(...xs);},svg);expect(Math.abs(sewnWidth-34)).toBeLessThan(.011);
 await page.getByRole('button',{name:'Exports',exact:true}).click();const changed=hoodPositions(await download(page,'Export 3D model (GLB) ↓'));expect(changed.length).toBe(prior.length);expect(changed).not.toEqual(prior);
 const columns=prior.length/3/17;for(let i=0;i<prior.length;i++){if(i%3!==2||i<columns*3)expect(changed[i]).toBe(prior[i]);}
 await page.getByRole('button',{name:'Tech pack',exact:true}).click();await expect(page.locator('#techpack-preview tr').filter({has:page.locator('td:first-child:text-is("N")')}).locator('td').nth(6)).toHaveText('34');
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await backup(page)).product).toEqual(original.product);await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('#save-state')).toHaveText('Locally saved');await page.reload();expect((await backup(page)).product).toEqual(saved.product);
});
test('phone width drafts remain raw refuse invalid values and reset only hood overrides',async({page})=>{
 await page.setViewportSize({width:390,height:900});await setup(page);await expect(width(page)).toBeVisible();const before=await backup(page);
 await width(page).fill('34.5');await page.getByRole('button',{name:'Materials & prints',exact:true}).click();await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();await expect(width(page)).toHaveValue('34.5');await page.locator('#apply-fit').click();await expect(page.locator('#message')).toContainText('Hood side width');expect(await backup(page)).toEqual(before);
 await width(page).fill('20');await page.locator('#apply-fit').click();await page.locator('#reset-fit').click();await expect(width(page)).toHaveValue('26');
 await page.getByRole('button',{name:'Templates',exact:true}).click();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:/^Use the Blank tee template/}).click();await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();await expect(width(page)).toBeHidden();expect((await backup(page)).product.fit?.hoodWidth).toBeUndefined();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('edited hood width reaches real drape and finite captured GLB',async({page})=>{
 test.setTimeout(90000);await setup(page);await width(page).fill('34');await page.locator('#apply-fit').click();await page.getByRole('button',{name:'Body & drape',exact:true}).click();await page.getByRole('button',{name:'Drape on a body',exact:true}).click();await expect(page.locator('#garment-drape-status')).toContainText('Draped on a body',{timeout:60000});
 await page.getByRole('button',{name:'Exports',exact:true}).click();const a=hoodPositions(await download(page,'Export 3D model (GLB) ↓'));expect(a.length).toBeGreaterThan(100);expect(a.every(Number.isFinite)).toBe(true);expect((await backup(page)).product.fit).toEqual({hoodWidth:34});
 await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();await width(page).fill('20');await page.locator('#apply-fit').click();await expect(page.locator('#garment-drape-status')).toContainText('Draped on a body',{timeout:60000});await page.getByRole('button',{name:'Exports',exact:true}).click();const b=hoodPositions(await download(page,'Export 3D model (GLB) ↓'));expect(b.length).toBe(a.length);expect(b.every(Number.isFinite)).toBe(true);expect(b).not.toEqual(a);
});
