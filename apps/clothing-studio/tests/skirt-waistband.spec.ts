import {test,expect} from './helpers/expanded-workspace.ts';
import {readFile} from 'node:fs/promises';
import type {Page} from '@playwright/test';

async function backup(page:Page){const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'Export project backup',exact:true}).click();return JSON.parse(await readFile((await(await waiting).path())!,'utf8'));}
function positions(bytes:Buffer,name:string):number[]{const length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length).toString()),node=json.nodes.find((n:{name?:string})=>n.name===name);expect(node,name).toBeTruthy();const a=json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION],v=json.bufferViews[a.bufferView];return Array.from({length:a.count*3},(_,i)=>bytes.readFloatLE(28+length+(v.byteOffset??0)+(a.byteOffset??0)+Math.floor(i/3)*(v.byteStride??12)+(i%3)*4));}
async function download(page:Page,id:string){const waiting=page.waitForEvent('download');await page.locator(id).click();return readFile((await(await waiting).path())!);}

for(const phone of [false,true])test(`a skirt waistband stays linked through drafts, style, history, reload and exports${phone?' on a phone':''}`,async({page})=>{
  test.setTimeout(120000);if(phone)await page.setViewportSize({width:390,height:740});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
  const editor=page.locator('#product-editor');await editor.getByRole('button',{name:/^Use the Flared skirt template/}).click();
  await editor.getByLabel('Colorway name',{exact:true}).fill('Original linen');await editor.getByRole('button',{name:'Save as colorway',exact:true}).click();
  const original=await backup(page);const height=editor.getByLabel('Skirt waistband height (cm)',{exact:true});
  await expect(height).toHaveValue('0');await height.fill('6');
  await editor.getByRole('radio',{name:'Back body',exact:true}).check();await expect(height).toHaveValue('6');
  expect((await backup(page)).product).toEqual(original.product); // still a draft
  await editor.locator('#apply-measurements').click();
  await editor.getByRole('radio',{name:'Waistband',exact:true}).check();
  await editor.getByRole('button',{name:'Apply Denim twill',exact:true}).click();
  await editor.locator('#part-color').fill('#ff0000');
  const saved=await backup(page);expect(saved.product.measurements).toEqual({waist:80,hem:140,slant:60,waistbandHeight:6});
  expect(saved.product.parts.waistband.material).toBe('denim-340');expect(saved.product.parts.front.material).toBe('linen-170');expect(saved.product.colorways[0].parts.waistband).toEqual(original.product.parts.front);
  await expect(editor.locator('#techpack-preview')).toContainText('Waistband height');
  // Actual downloaded sewing rectangle is 80 x 12 cm; the cutting outline adds 1 cm on each edge.
  const svg=(await download(page,'#pattern-svg')).toString();
  const dimensions=await page.evaluate(text=>{const doc=new DOMParser().parseFromString(text,'image/svg+xml'),g=doc.querySelector('[data-piece="waistband"]')!;return [...g.querySelectorAll('polygon')].map(p=>{const pts=p.getAttribute('points')!.split(' ').map(pair=>pair.split(',').map(Number));return [Math.max(...pts.map(p=>p[0]))-Math.min(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))-Math.min(...pts.map(p=>p[1]))];});},svg);
  expect(dimensions).toEqual([[82,14],[80,12]]);
  expect((await download(page,'#pattern-dxf')).toString()).toContain('Waistband');
  const glb=await download(page,'#product-glb');expect(glb.subarray(0,4).toString()).toBe('glTF');
  const ys=positions(glb,'Waistband').filter((_,i)=>i%3===1),seam=Math.sqrt(60**2-(60/(2*Math.PI))**2);expect(Math.min(...ys)).toBeCloseTo(seam,4);expect(Math.max(...ys)).toBeCloseTo(seam+6,4);
  const png=await download(page,'#product-png-front');const red=await page.evaluate(async base64=>{const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const x=c.getContext('2d')!;x.drawImage(image,0,0);const pixels=x.getImageData(0,0,c.width,c.height).data;let red=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>128&&pixels[i]>pixels[i+1]*1.5&&pixels[i]>pixels[i+2]*1.5)red++;return red;},png.toString('base64'));expect(red).toBeGreaterThan(100);
  await expect(page.locator('#save-state')).toContainText('saved');await page.reload();expect((await backup(page)).product).toEqual(saved.product);
  await height.fill('1');await editor.locator('#apply-measurements').click();await expect(editor.locator('#product-draft-state')).toContainText('Unapplied');expect((await backup(page)).product).toEqual(saved.product);
  await height.fill('0');await editor.locator('#apply-measurements').click();expect((await backup(page)).product.parts.waistband).toBeUndefined();
  await expect(editor.getByRole('radio',{name:'Waistband',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await backup(page)).product).toEqual(saved.product);
  await page.getByRole('button',{name:'Redo',exact:true}).click();expect((await backup(page)).product).toEqual(original.product);
  expect(errors).toEqual([]);
});

test('the worker drapes a banded skirt and exports its settled waistband',async({page})=>{
  test.setTimeout(120000);await page.addInitScript(()=>{const Native=Worker;window.Worker=class extends Native{constructor(...args:ConstructorParameters<typeof Worker>){super(...args);if(String(args[0]).includes('garment-drape.worker'))this.addEventListener('message',event=>{if(event.data.kind==='result')Object.assign(window,{bandResult:event.data.result.parts.map((p:{part:string;positions:Float32Array})=>({part:p.part,positions:Array.from(p.positions)}))});});}};});await page.goto('/');const editor=page.locator('#product-editor');
  await editor.getByRole('button',{name:/^Use the Flared skirt template/}).click();
  await editor.getByLabel('Skirt waistband height (cm)',{exact:true}).fill('4');await editor.locator('#apply-measurements').click();
  await editor.getByRole('combobox',{name:'Wear with',exact:true}).selectOption('t:blank');
  await editor.locator('#garment-drape-on').click();await expect(editor.locator('#garment-drape-status')).toContainText('held at the waistline',{timeout:60000});
  await editor.getByRole('checkbox',{name:'Include worn garment in PNG and GLB',exact:true}).check();
  const glb=await download(page,'#product-glb');expect(glb.subarray(0,4).toString()).toBe('glTF');
  const actual=await page.evaluate(()=>(window as unknown as {bandResult:{part:string;positions:number[]}[]}).bandResult.find(p=>p.part==='waistband')!.positions);expect(positions(glb,'Waistband')).toEqual(actual);
});
