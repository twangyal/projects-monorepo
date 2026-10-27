import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';
import { partName, template, type Product, type PartId } from '../src/product.ts';

type Part = { part: PartId; positions: number[] };
type Captured = { parts: Part[]; companion: { parts: Part[] } };
async function download(page: Page, id: string) { const wait = page.waitForEvent('download'); await page.locator(id).click(); const file = await wait; return { name: file.suggestedFilename(), bytes: await readFile((await file.path())!) }; }
async function backup(page: Page) { return JSON.parse((await download(page, '#backup')).bytes.toString()); }
function glb(bytes: Buffer) {
  const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  return { json, positions(name: string): number[] {
    const node = json.nodes.find((n: { name?: string }) => n.name === name); expect(node, name).toBeTruthy();
    const a = json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION], v = json.bufferViews[a.bufferView];
    return Array.from({ length: a.count * 3 }, (_, i) => bytes.readFloatLE(28 + length + (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + Math.floor(i / 3) * (v.byteStride ?? 12) + (i % 3) * 4));
  } };
}
async function capture(page: Page) {
  await page.addInitScript(() => {
    const Native = Worker;
    window.Worker = class extends Native { constructor(...args: ConstructorParameters<typeof Worker>) { super(...args); if (String(args[0]).includes('garment-drape.worker')) this.addEventListener('message', event => {
      if (event.data.kind === 'result' && event.data.result.companion) {
        const copy = (parts: { part: string; positions: Float32Array }[]) => parts.map(p => ({ part: p.part, positions: Array.from(p.positions) }));
        Object.assign(window, { outfitResult: { parts: copy(event.data.result.parts), companion: { parts: copy(event.data.result.companion.parts) } } });
      }
    }); } };
  });
}
for (const primaryBottoms of [false, true]) test(`whole outfit exports actual settled geometry with ${primaryBottoms ? 'bottoms' : 'top'} as the design`, async ({ page }) => {
  test.setTimeout(150000); page.on('dialog', d => d.accept()); await capture(page);
  await page.setViewportSize({ width: primaryBottoms ? 390 : 1280, height: 900 }); await page.goto('/');
  const option = page.getByRole('checkbox', { name: 'Include worn garment in PNG and GLB', exact: true });
  await expect(option).not.toBeChecked(); await expect(option).toBeDisabled();
  const top = template('blank'), bottom = template('trousers');
  for (const style of Object.values(top.parts)) style.color = '#ff0000';
  for (const style of Object.values(bottom.parts)) style.color = '#0000ff';
  const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 16; const x = c.getContext('2d')!; x.fillStyle = '#00ff00'; x.fillRect(0,0,16,16); return c.toDataURL('image/png'); });
  top.artwork = [{ part: 'front', name: 'green.png', dataUrl: image, width: 16, height: 16, widthCm: 14, xCm: 0, yCm: 14 }];
  const design = await backup(page); design.product = primaryBottoms ? bottom : top; design.wornWith = primaryBottoms ? top : bottom;
  await page.getByLabel('Import project backup', { exact: true }).setInputFiles({ name: 'outfit.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(design)) });
  await expect(option).toBeEnabled(); await option.check();
  const downloads: string[] = []; page.on('download', file => downloads.push(file.suggestedFilename()));
  await page.locator('#product-glb').click(); await expect(page.locator('#message')).toContainText('Drape the outfit'); expect(downloads).toEqual([]);
  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  await expect(page.locator('#garment-drape-status')).toContainText(primaryBottoms ? 'Worn under' : 'Worn over', { timeout: 120000 });
  const result = await page.evaluate(() => (window as unknown as { outfitResult: Captured }).outfitResult);
  const model = await download(page, '#product-glb'); expect(model.name).toMatch(/-outfit\.glb$/);
  const parsed = glb(model.bytes), primary: Product = design.product, companion: Product = design.wornWith;
  for (const [product, parts, prefix] of [[primary, result.parts, ''], [companion, result.companion.parts, `${companion.name}: `]] as const) {
    for (const part of parts) expect(parsed.positions(prefix + partName(product, part.part))).toEqual(part.positions);
  }
  expect(parsed.json.nodes.some((n: { name?: string }) => n.name === 'Body')).toBe(false);
  expect(parsed.json.nodes.some((n: { name?: string }) => n.name?.endsWith('Front artwork'))).toBe(true);
  const png = await download(page, '#product-png-front'); expect(png.name).toMatch(/-outfit-front\.png$/);
  const colors = await page.evaluate(async base64 => {
    const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
    const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; const x = c.getContext('2d')!; x.drawImage(image,0,0); const pixels = x.getImageData(0,0,c.width,c.height).data;
    let red=0,blue=0,green=0; for(let i=0;i<pixels.length;i+=4) { if(pixels[i+3]<128)continue; if(pixels[i]>pixels[i+1]*1.5&&pixels[i]>pixels[i+2]*1.5)red++; if(pixels[i+2]>pixels[i]*1.5&&pixels[i+2]>pixels[i+1]*1.5)blue++; if(pixels[i+1]>pixels[i]*1.5&&pixels[i+1]>pixels[i+2]*1.5)green++; } return {red,blue,green};
  }, png.bytes.toString('base64'));
  expect(colors.red).toBeGreaterThan(100); expect(colors.blue).toBeGreaterThan(100); expect(colors.green).toBeGreaterThan(20);
  expect(await backup(page)).toEqual(design);
  await option.uncheck(); const single = glb((await download(page, '#product-glb')).bytes);
  expect(single.json.nodes.some((n: { name?: string }) => n.name?.startsWith(companion.name + ': '))).toBe(false);
  await expect(option).not.toBeChecked();
  await page.getByRole('combobox', { name: 'Wear with', exact: true }).selectOption('');
  await expect(option).toBeDisabled(); await expect(option).not.toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a held outfit render retains both garments and its title after the worn garment is removed', async ({ page }) => {
  test.setTimeout(150000); page.on('dialog', d => d.accept());
  await page.addInitScript(() => {
    const gate = { armed: false, waiting: false, release: () => {} }; Object.assign(window, { outfitGate: gate });
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
      if (!gate.armed) return encode.call(this, callback, type, quality);
      gate.armed = false; return encode.call(this, blob => { gate.waiting = true; gate.release = () => callback(blob); }, type, quality);
    };
  });
  await page.goto('/'); await page.getByLabel('Concept name', { exact: true }).fill('Kept outfit');
  await page.getByRole('combobox', { name: 'Wear with', exact: true }).selectOption({ label: 'Straight trousers' });
  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  await expect(page.locator('#garment-drape-status')).toContainText('Worn over', { timeout: 120000 });
  await page.getByRole('checkbox', { name: 'Include worn garment in PNG and GLB', exact: true }).check();
  const original = await download(page, '#product-png-front');
  await page.evaluate(() => { (window as unknown as { outfitGate: { armed: boolean } }).outfitGate.armed = true; });
  await page.locator('#product-png-front').click();
  await page.waitForFunction(() => (window as unknown as { outfitGate: { waiting: boolean } }).outfitGate.waiting);
  await page.getByRole('combobox', { name: 'Wear with', exact: true }).selectOption('');
  await page.getByLabel('Concept name', { exact: true }).fill('New single garment');
  const changed = await backup(page), wait = page.waitForEvent('download');
  await page.evaluate(() => (window as unknown as { outfitGate: { release: () => void } }).outfitGate.release());
  const file = await wait; expect(file.suggestedFilename()).toBe('Kept outfit-outfit-front.png');
  expect(await readFile((await file.path())!)).toEqual(original.bytes);
  expect(await backup(page)).toEqual(changed); await expect(page.locator('#product-png-front')).toBeEnabled();
});
