import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
async function download(page: Page, name: string) {
  const wait = page.waitForEvent('download'); await page.getByRole('button', {name,exact:true}).click();
  return readFile((await (await wait).path())!);
}
async function backup(page: Page) { return JSON.parse((await download(page,'Export project backup')).toString()); }
async function bounds(page: Page, png: Buffer) {
  return page.evaluate(async data => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))],{type:'image/png'}));
    try {
      const c = document.createElement('canvas'); c.width=image.width; c.height=image.height;
      const x=c.getContext('2d')!; x.drawImage(image,0,0); const pixels=x.getImageData(0,0,c.width,c.height).data;
      const blue:number[][]=[],red:number[][]=[];
      for(let y=0;y<c.height;y++) for(let x=0;x<c.width;x++) { const i=(y*c.width+x)*4;
        if(pixels[i]<70 && pixels[i+1]<70 && pixels[i+2]>150) blue.push([x,y]);
        if(pixels[i]>150 && pixels[i+1]<70 && pixels[i+2]<70) red.push([x,y]);
      }
      const box=(points:number[][])=>({count:points.length,minX:Math.min(...points.map(p=>p[0])),maxX:Math.max(...points.map(p=>p[0])),minY:Math.min(...points.map(p=>p[1])),maxY:Math.max(...points.map(p=>p[1]))});
      return {blue:box(blue),red:box(red)};
    } finally {image.close();}
  },png.toString('base64'));
}
for (const side of ['front','back'] as const) for (const angle of [90,-90]) test(`${side} artwork rotates ${angle} degrees in native PNG and persists through undo, backup and GLB`, async ({page}) => {
  test.setTimeout(90000); await page.goto('/'); const editor=page.locator('#product-editor');
  await editor.getByRole('button',{name:/^Use the Blank tee template/}).click();
  await expect(editor.locator('#artwork-side')).toBeVisible();
  await editor.locator('#artwork-side').selectOption(side);
  const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=160;c.height=40;const x=c.getContext('2d')!;x.fillStyle='#1010ed';x.fillRect(0,0,160,40);x.fillStyle='#ed1010';x.fillRect(0,0,30,15);return c.toDataURL('image/png').split(',')[1];}),'base64');
  await editor.locator('#artwork-file').setInputFiles({name:'angle.png',mimeType:'image/png',buffer:png});
  await expect(page.locator('#message')).toContainText('Artwork placed');
  const field=editor.getByLabel('Artwork rotation (degrees)',{exact:true}); await expect(field).toHaveValue('0');
  const button=`Export ${side} render PNG ↓`, before=await bounds(page,await download(page,button));
  expect(before.blue.count).toBeGreaterThan(100);
  expect(before.blue.maxX-before.blue.minX).toBeGreaterThan((before.blue.maxY-before.blue.minY)*2);
  await field.fill(String(angle));
  await editor.getByRole('radio',{name:'Back body',exact:true}).check(); await expect(field).toHaveValue(String(angle));
  expect((await backup(page)).product.artwork[0].rotation).toBeUndefined();
  await editor.getByRole('button',{name:'Apply placement',exact:true}).click();
  const after=await bounds(page,await download(page,button));
  expect(after.blue.count).toBeGreaterThan(100);
  expect(after.blue.maxY-after.blue.minY).toBeGreaterThan((after.blue.maxX-after.blue.minX)*2);
  expect(after.red.count).toBeGreaterThan(10);
  const dx=(after.red.minX+after.red.maxX-after.blue.minX-after.blue.maxX)/2, dy=(after.red.minY+after.red.maxY-after.blue.minY-after.blue.maxY)/2;
  expect(dx*Math.sign(angle)).toBeGreaterThan(0); expect(dy*Math.sign(angle)).toBeLessThan(0);
  expect((await backup(page)).product.artwork[0].rotation).toBe(angle);
  const pack=(await download(page,'Download printable tech pack ↓')).toString(); expect(pack).toContain(angle>0?'90° clockwise':'90° counterclockwise');
  const glb=await download(page,'Export 3D model (GLB) ↓'), length=glb.readUInt32LE(12), json=JSON.parse(glb.subarray(20,20+length).toString());
  const node=json.nodes.find((n:{name:string})=>n.name===`${side==='front'?'Front':'Back'} artwork`);
  expect(node).toBeTruthy();
  const a=json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION];
  expect(a.max[1]-a.min[1]).toBeGreaterThan((a.max[0]-a.min[0])*2);
  if(side==='front' && angle===90) {
    await editor.getByRole('button',{name:'Drape on a body',exact:true}).click();
    await expect(editor.locator('#garment-drape-status')).toContainText('Draped on a body',{timeout:60000});
    const draped=await bounds(page,await download(page,button));
    expect(draped.blue.count).toBeGreaterThan(100); expect(draped.red.count).toBeGreaterThan(10);
    await editor.getByRole('button',{name:'Show styling shell',exact:true}).click();
  }
  await page.getByRole('button',{name:'Undo',exact:true}).click(); await expect(field).toHaveValue('0');
  await page.getByRole('button',{name:'Redo',exact:true}).click(); await expect(field).toHaveValue(String(angle));
  await page.reload(); await expect(page.locator('#artwork-rotation')).toHaveValue(side==='front'?String(angle):'');
  if(side==='back') {await page.locator('#artwork-side').selectOption('back');await expect(page.locator('#artwork-rotation')).toHaveValue(String(angle));}
});
