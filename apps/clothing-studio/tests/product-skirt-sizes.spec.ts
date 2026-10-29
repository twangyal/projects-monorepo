import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function download(page: Page, id: string) {
  const wait=page.waitForEvent('download'); await page.locator(id).click(); const file=await wait;
  return {name:file.suggestedFilename(),text:await readFile((await file.path())!,'utf8')};
}
async function backup(page: Page) { return JSON.parse((await download(page,'#backup')).text); }

for(const width of [1280,390]) test(`graded skirts keep their sample while preview and pattern export choose separate sizes at ${width}px`,async({page})=>{
  test.setTimeout(150000);await page.setViewportSize({width,height:900});await page.goto('/');
  page.on('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:/^Use the Flared skirt template/}).click();
  await page.getByLabel('Skirt waistband height (cm)',{exact:true}).fill('6');await page.locator('#apply-measurements').click();
  const sample=await backup(page),size=page.getByRole('combobox',{name:'Size shown',exact:true}),pattern=page.getByRole('combobox',{name:'Pattern export size',exact:true});
  await expect(size).toBeEnabled();await expect(pattern).toBeEnabled();
  await size.selectOption('L');await pattern.selectOption('S');
  await expect(size).toHaveValue('L');await expect(pattern).toHaveValue('S');
  const svg=await download(page,'#pattern-svg'),dxf=await download(page,'#pattern-dxf');
  expect(svg.name).toContain('-size-S-pattern.svg');expect(dxf.name).toContain('-size-S-pattern.dxf');
  const band=await page.evaluate(text=>{const d=new DOMParser().parseFromString(text,'image/svg+xml');const p=d.querySelector('g[data-piece="waistband"] polygon:nth-child(2)')!.getAttribute('points')!.split(' ').map(p=>p.split(',').map(Number));return {width:Math.max(...p.map(p=>p[0]))-Math.min(...p.map(p=>p[0])),height:Math.max(...p.map(p=>p[1]))-Math.min(...p.map(p=>p[1]))};},svg.text);
  expect(band).toEqual({width:76,height:12});expect(svg.text).toContain('size S');expect(dxf.text).toContain('size S');
  const sewing=dxf.text.split('0\nPOLYLINE\n8\nSEW\n').at(-1)!.split('0\nSEQEND')[0];
  const vertices=[...sewing.matchAll(/0\nVERTEX\n8\nSEW\n10\n([^\n]+)\n20\n([^\n]+)/g)].map(m=>[Number(m[1]),Number(m[2])]);
  expect(Math.max(...vertices.map(p=>p[0]))-Math.min(...vertices.map(p=>p[0]))).toBe(760);
  expect(Math.max(...vertices.map(p=>p[1]))-Math.min(...vertices.map(p=>p[1]))).toBe(120);
  expect(await page.locator('#techpack-preview tr').filter({hasText:'Waist circumference'}).locator('td').allTextContents()).toEqual(['A','Waist circumference','Around the waist seam','1','72','76','80','84','88']);
  expect(await backup(page)).toEqual(sample);
  // The real worker must receive the chosen size but keep the sample's default body.
  await page.evaluate(()=>{const Real=window.Worker;window.Worker=class extends Real {postMessage(message:unknown,options?: StructuredSerializeOptions | Transferable[]){const m=message as {product?:{base:string;measurements:unknown};bodyShape?:unknown};if(m.product?.base==='skirt')(window as unknown as {lastSkirt:unknown}).lastSkirt=structuredClone(m);if(Array.isArray(options))super.postMessage(message,options);else super.postMessage(message,options);}};});
  await page.locator('#garment-drape-on').click();
  await expect(page.locator('#garment-drape-status')).toContainText('Size L, graded from M.',{timeout:120000});
  await expect(page.locator('#garment-drape-status')).toContainText('held at the waistline');
  const request=await page.evaluate(()=>(window as unknown as {lastSkirt:{product:{measurements:unknown};bodyChest:number;bodyShape:unknown}}).lastSkirt);
  expect(request.product.measurements).toEqual({waist:84,hem:146,slant:60,waistbandHeight:6});expect(request.bodyChest).toBe(91);expect(request.bodyShape).toEqual({waist:78.26,hip:92.82000000000001});
  expect(await backup(page)).toEqual(sample);
  await expect(page.locator('#save-state')).toHaveText('Locally saved');await page.reload();expect(await backup(page)).toEqual(sample);await expect(size).toHaveValue('M');await expect(pattern).toHaveValue('M');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


test('a non-M skirt sample grades relatively; unsupported downloads refuse and an invalidated view returns to the sample with Undo',async({page})=>{
  await page.goto('/');page.on('dialog',d=>d.accept());
  const project=await backup(page);
  project.product={...(await import('../src/product.ts')).template('flared-skirt'),spec:{styleNumber:'SK1',season:'Summer',sampleSize:'S'}};
  const load=async()=>page.getByLabel('Import project backup',{exact:true}).setInputFiles({name:'skirt.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await load();const size=page.getByRole('combobox',{name:'Size shown',exact:true}),pattern=page.getByRole('combobox',{name:'Pattern export size',exact:true});
  await expect(size).toHaveValue('S');await pattern.selectOption('XL');
  const file=await download(page,'#pattern-svg');expect(file.name).toContain('-size-XL-pattern.svg');expect(file.text).toContain('size XL');
  const waist=page.locator('#techpack-preview tr').filter({hasText:'Waist circumference'}).locator('td');
  expect((await waist.allTextContents()).slice(4)).toEqual(['76','80','84','88','92']);expect(await backup(page)).toEqual(project);
  await size.selectOption('XL');
  await page.locator('#product-skirt-waist').fill('146');await page.locator('#product-skirt-hem').fill('200');await page.locator('#apply-measurements').click();
  await expect(size).toHaveValue('S');await expect(page.locator('#garment-size-status')).toContainText('Size XL was outside the supported measurements');
  const edited=await backup(page);expect(edited.product.measurements).toEqual({waist:146,hem:200,slant:60});
  const files:string[]=[];page.on('download',d=>files.push(d.suggestedFilename()));
  await page.locator('#pattern-svg').click();await expect(page.locator('#message')).toContainText('Size XL would be outside');
  await page.locator('#pattern-dxf').click();await expect(page.locator('#message')).toContainText('Size XL would be outside');expect(files).toEqual([]);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await backup(page)).toEqual(project);
  await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await backup(page)).toEqual(edited);
});
