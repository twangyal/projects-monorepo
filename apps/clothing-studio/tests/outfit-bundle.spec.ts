import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { png, pngUrl } from './helpers/raster.ts';
async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button',{name:'Export project backup',exact:true}).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
function unpack(bytes: Buffer) {
  const files = new Map<string, Buffer>(); let at = 0;
  while (bytes.readUInt32LE(at) === 0x04034b50) {
    const length = bytes.readUInt32LE(at+18), names = bytes.readUInt16LE(at+26), extra = bytes.readUInt16LE(at+28), start = at+30+names+extra;
    files.set(bytes.subarray(at+30,at+30+names).toString(),bytes.subarray(start,start+length)); at=start+length;
  }
  expect(bytes.readUInt32LE(at)).toBe(0x02014b50); return files;
}
for (const width of [1280,390]) test(`outfit bundle downloads applied samples without disturbing drafts, size views or history at ${width}px`, async ({page})=>{
  await page.setViewportSize({width,height:900}); await page.goto('/');
  await page.getByRole('button',{name:'Exports',exact:true}).click();
  const bundle=page.getByRole('button',{name:'Download outfit patterns and tech packs (ZIP) ↓',exact:true}); await expect(bundle).toBeDisabled();
  await page.getByRole('button',{name:'Templates',exact:true}).click(); await page.getByRole('button',{name:/^Use the Ringer tee template/}).click();
  await page.getByRole('button',{name:'Body & drape',exact:true}).click(); await page.getByRole('combobox',{name:'Wear with',exact:true}).selectOption({label:'Flared skirt'});
  const project=await backup(page), original=structuredClone(project); project.product.spec={styleNumber:'TOP',season:'Summer',sampleSize:'L'};project.wornWith.spec={styleNumber:'SKIRT',season:'Summer',sampleSize:'S'};
  project.product.artwork=[{part:'front',name:'Print',dataUrl:pngUrl(8,4),width:8,height:4,xCm:0,yCm:12,widthCm:18,rotation:12}];
  project.wornWith.motifs=[{id:'tile',name:'Repeat',dataUrl:pngUrl(5,5),width:5,height:5}];
  project.wornWith.parts.front.print={motif:'upload:tile',color:'#aabbcc',scaleCm:8,layout:'mirror'};
  await page.getByLabel('Import project backup',{exact:true}).setInputFiles({name:'samples.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await expect(page.locator('#message')).toContainText('Project backup restored');
  const before=await backup(page);
  await page.getByRole('combobox',{name:'Size shown',exact:true}).selectOption('XL');
  await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();
  await page.getByRole('combobox',{name:'Pattern export size',exact:true}).selectOption('XS'); await page.getByLabel('Chest (cm)',{exact:true}).fill('115');
  await page.getByRole('button',{name:'Exports',exact:true}).click(); await bundle.click(); await expect(page.locator('#message')).toContainText('Apply or discard');
  await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click(); await expect(page.getByLabel('Chest (cm)',{exact:true})).toHaveValue('115');
  await page.getByRole('button',{name:'Discard all product drafts',exact:true}).click();
  await page.getByRole('button',{name:'Exports',exact:true}).click();
  const undo=await page.getByRole('button',{name:'Undo',exact:true}).isEnabled(), wait=page.waitForEvent('download'); await bundle.click(); const download=await wait;
  expect(download.suggestedFilename()).toMatch(/-outfit-patterns-tech-packs\.zip$/);
  const files=unpack(await readFile((await download.path())!)), manifest=JSON.parse(files.get('manifest.json')!.toString());
  expect(manifest.garments.map((g:{sampleSize:string})=>g.sampleSize)).toEqual(['L','S']); expect(files.size).toBe(12);
  const art=manifest.garments[0].artwork[0], repeat=manifest.garments[1].repeatMotifs[0];
  expect(art).toMatchObject({part:'front',widthCm:18,heightCm:9,rotation:12});
  expect(files.get(art.file)).toEqual(png(8,4));
  expect(repeat.parts).toEqual([{part:'front',scaleCm:8,layout:'mirror'}]);
  expect(files.get(repeat.file)).toEqual(png(5,5));
  expect(files.get(manifest.garments[0].files.html)!.toString()).toContain('<dd>TOP</dd>');
  expect(files.get(manifest.garments[1].files.html)!.toString()).toContain('<dd>SKIRT</dd>');
  expect(await backup(page)).toEqual(before); expect(await page.getByRole('button',{name:'Undo',exact:true}).isEnabled()).toBe(undo);
  await page.getByRole('button',{name:'Body & drape',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Size shown',exact:true})).toHaveValue('XL');
  await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click(); await expect(page.getByRole('combobox',{name:'Pattern export size',exact:true})).toHaveValue('XS');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Undo',exact:true}).click(); expect(await backup(page)).toEqual(original);
});

test('default-tee outfits download complete bundles without applying a template', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Body & drape', exact: true }).click();
  await page.getByRole('combobox', { name: 'Wear with', exact: true }).selectOption({ label: 'Straight trousers' });
  for (const three of [false, true]) {
    if (three) await page.getByRole('combobox', { name: 'And with', exact: true }).selectOption({ label: 'Crew sweatshirt' });
    const before = await backup(page);
    expect(before.product).toBeUndefined();
    const undo = await page.getByRole('button', { name: 'Undo', exact: true }).isEnabled();
    await page.getByRole('button', { name: 'Exports', exact: true }).click();
    const wait = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download outfit patterns and tech packs (ZIP) ↓', exact: true }).click();
    const files = unpack(await readFile((await (await wait).path())!));
    const manifest = JSON.parse(files.get('manifest.json')!.toString());
    expect(manifest.garments.map((g: { name: string }) => g.name)).toEqual(three ? ['Blank tee', 'Straight trousers', 'Crew sweatshirt'] : ['Blank tee', 'Straight trousers']);
    expect(files.get('01-tee/pattern.svg')!.toString()).toContain('<svg');
    expect(files.get('01-tee/tech-pack.xlsx')!.length).toBeGreaterThan(100);
    expect(await backup(page)).toEqual(before);
    expect(await page.getByRole('button', { name: 'Undo', exact: true }).isEnabled()).toBe(undo);
    await page.getByRole('button', { name: 'Body & drape', exact: true }).click();
  }
});
