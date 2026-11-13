import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';
import { patternSvg } from '../src/pattern-export.ts';
import { gradedProduct } from '../src/size-grades.ts';
async function download(page:Page,id:string) {
  const pending=page.waitForEvent('download'); await page.locator(id).click(); return readFile((await (await pending).path())!);
}
async function backup(page:Page) { return JSON.parse((await download(page,'#backup')).toString()); }
function unpack(bytes:Buffer) {
  const files=new Map<string,string>();let at=0;
  while(bytes.readUInt32LE(at)===0x04034b50) {
    const length=bytes.readUInt32LE(at+18),names=bytes.readUInt16LE(at+26),extra=bytes.readUInt16LE(at+28),start=at+30+names+extra;
    files.set(bytes.subarray(at+30,at+30+names).toString(),bytes.subarray(start,start+length).toString());at=start+length;
  }
  return files;
}
for(const width of [1280,390]) test(`all product cutting formats and outfit grades share the chosen allowance at ${width}px`,async({page})=>{
  test.setTimeout(90000);await page.setViewportSize({width,height:900});await page.goto('/');
  await page.locator('#product-editor').getByRole('button',{name:/^Use the Oxford shirt template/}).click();
  await page.getByRole('combobox',{name:'Wear with',exact:true}).selectOption({label:'Straight trousers'});
  const before=await backup(page),allowance=page.getByLabel('Pattern seam allowance (cm)',{exact:true});
  await allowance.fill('1.5');await page.getByRole('combobox',{name:'Pattern export size',exact:true}).selectOption('L');
  for(const id of ['#pattern-svg','#pattern-dxf','#pattern-a4','#pattern-letter']) {
    const text=(await download(page,id)).toString();expect(text).toContain('1.5 cm');expect(text).toMatch(/size L/);
    expect(text).not.toMatch(/NaN|Infinity/);
    if(id==='#pattern-a4'||id==='#pattern-letter') {expect(text).toContain('5 cm × 5 cm');expect(text).toContain('data-fold="collar"');}
  }
  await page.getByRole('combobox',{name:'Outfit export size',exact:true}).selectOption('S');
  const files=unpack(await download(page,'#outfit-bundle')),manifest=JSON.parse(files.get('manifest.json')!);
  expect(manifest.seamAllowanceCm).toBe(1.5);expect(manifest.garments).toHaveLength(2);
  for(const [index,garment] of [before.product,before.wornWith].entries()) {
    const entry=manifest.garments[index];expect(entry.exportSize).toBe('S');expect(files.get(entry.files.svg)).toBe(patternSvg(gradedProduct(garment,'S'),1.5));
  }
  expect(files.get('README.txt')).toContain('1.5 cm');expect(await backup(page)).toEqual(before);
  await allowance.fill('0');expect((await download(page,'#pattern-svg')).toString()).toContain('0 cm seam allowance');
  expect(await backup(page)).toEqual(before);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('#save-state')).toContainText('Locally saved');await page.reload();
  await expect(page.getByLabel('Pattern seam allowance (cm)',{exact:true})).toHaveValue('1');expect(await backup(page)).toEqual(before);
});
test('invalid allowance and pending pattern drafts refuse without a download or losing raw values',async({page})=>{
  await page.goto('/');await page.getByRole('combobox',{name:'Wear with',exact:true}).selectOption({label:'Straight trousers'});
  const before=await backup(page),allowance=page.getByLabel('Pattern seam allowance (cm)',{exact:true}),files:string[]=[];
  page.on('download',file=>files.push(file.suggestedFilename()));
  for(const value of ['', '-.1','2.01']) {
    await allowance.fill(value);await page.locator('#pattern-svg').click();await expect(page.locator('#message')).toContainText('seam allowance from 0 to 2 cm');await expect(allowance).toHaveValue(value);
  }
  await allowance.fill('1.25');const chest=page.getByLabel('Chest (cm)',{exact:true});await chest.fill('');
  for(const id of ['#pattern-a4','#outfit-bundle']) {await page.locator(id).click();await expect(page.locator('#message')).toContainText('Apply or discard');}
  await expect(chest).toHaveValue('');await expect(allowance).toHaveValue('1.25');expect(files).toEqual([]);
  expect(await backup(page)).toEqual(before);
});
