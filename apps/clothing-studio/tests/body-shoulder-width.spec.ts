import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const shoulder = (page: Page) => page.getByLabel('Body shoulder width (cm, optional)', { exact: true });
const apply = (page: Page) => page.getByRole('button', { name: 'Apply body settings', exact: true }).click();
async function setup(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await page.getByRole('button', { name: 'Body & drape', exact: true }).click();
  await page.locator('#top-body-shape summary').click();
}
async function backup(page: Page) {
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export project backup', exact: true }).click();
  return JSON.parse(await readFile((await (await wait).path())!, 'utf8'));
}
for (const width of [1280,390]) test(`measured shoulders keep precise body drafts, profiles and history at ${width}px`, async ({page}) => {
  test.setTimeout(90000);
  page.on('dialog',dialog=>dialog.accept());
  await page.setViewportSize({width,height:900}); await setup(page);
  const before=await backup(page);
  await expect(shoulder(page)).toHaveValue('');
  await shoulder(page).fill('42.125');
  expect((await backup(page)).topBody).toEqual(before.topBody);
  await page.getByRole('button',{name:'Materials & prints',exact:true}).click();
  await page.getByRole('button',{name:'Body & drape',exact:true}).click();
  await expect(shoulder(page)).toHaveValue('42.125');
  await apply(page); const saved=await backup(page);
  expect(saved.topBody.shoulderWidth).toBe(42.125);expect(saved.product).toEqual(before.product);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(shoulder(page)).toHaveValue('');
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(shoulder(page)).toHaveValue('42.125');
  await shoulder(page).fill('29');await apply(page);
  await expect(page.locator('#message')).toContainText('Body shoulder width must be from 30 to 65');
  expect((await backup(page)).topBody).toEqual(saved.topBody);
  await page.locator('#discard-product-drafts').click();
  await page.getByText('Saved body profiles',{exact:true}).click();
  await page.getByLabel('Body profile name',{exact:true}).fill('Shoulders');
  await page.getByRole('button',{name:'Save body as new profile',exact:true}).click();
  await expect(page.locator('#body-profile-preview')).toContainText('42.125 shoulder width');
  await shoulder(page).fill('50');await apply(page);
  await page.getByRole('button',{name:'Use selected body profile',exact:true}).click();await expect(shoulder(page)).toHaveValue('42.125');
  await expect(page.locator('#save-state')).toHaveText('Locally saved');await page.reload();
  await page.getByRole('button',{name:'Body & drape',exact:true}).click();await expect(shoulder(page)).toHaveValue('42.125');
  await page.getByRole('button',{name:'Templates',exact:true}).click();
  await page.getByRole('button',{name:/^Use the Straight trousers template/}).click();
  await page.getByRole('button',{name:'Body & drape',exact:true}).click();
  if (!await page.locator('#top-body-shape').evaluate(node=>(node as HTMLDetailsElement).open)) await page.locator('#top-body-shape summary').click();
  await expect(shoulder(page)).toBeHidden();
  await page.getByLabel('Body waist girth (cm, optional)',{exact:true}).fill('80');await apply(page);
  expect((await backup(page)).topBody.shoulderWidth).toBe(42.125);
  await page.getByRole('button',{name:'Templates',exact:true}).click();
  await page.getByRole('button',{name:/^Use the Blank tee template/}).click();
  await page.getByRole('button',{name:'Body & drape',exact:true}).click();
  await expect(shoulder(page)).toBeVisible();await expect(shoulder(page)).toHaveValue('42.125');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('actual graded drape and fabric comparison workers retain measured shoulders',async({page})=>{
  test.setTimeout(150000);
  await page.addInitScript(()=>{
    const Native=Worker;window.Worker=class extends Native{
      constructor(...args:ConstructorParameters<typeof Worker>){super(...args);if(String(args[0]).includes('garment-drape.worker'))this.addEventListener('message',event=>{if(event.data.kind==='result')Object.assign(window,{shoulderWorkerBody:event.data.result.body});});}
    };
  });
  await setup(page);await shoulder(page).fill('42');await apply(page);
  await page.getByRole('combobox',{name:'Size shown',exact:true}).selectOption('L');
  await page.getByRole('button',{name:'Drape on a body',exact:true}).click();
  await expect(page.locator('#garment-drape-status')).toContainText('42 cm shoulder width',{timeout:60000});
  expect(await page.evaluate(()=>(window as unknown as {shoulderWorkerBody:{shoulderWidth:number}}).shoulderWorkerBody.shoulderWidth)).toBe(42);
  await page.getByText('Compare fabrics on this garment',{exact:true}).click();
  await page.getByRole('button',{name:'Compare garment fabrics',exact:true}).click();
  await expect(page.locator('#garment-comparison-status')).toContainText('42 cm shoulder width',{timeout:60000});
  const wait=page.waitForEvent('download');await page.locator('#garment-comparison-download').click();
  const data=JSON.parse(await readFile((await(await wait).path())!,'utf8'));
  expect(data.body.shoulderWidth).toBe(42);
  expect(data.candidates.map((c:{result:{body:{shoulderWidth:number}}})=>c.result.body.shoulderWidth)).toEqual([42,42]);
});
