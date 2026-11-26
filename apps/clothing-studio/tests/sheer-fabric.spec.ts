import {test,expect,type Page} from './helpers/expanded-workspace.ts';
import {readFile} from 'node:fs/promises';
import {template,withOptions,optionsOf,type Product} from '../src/product.ts';

async function download(page:Page,id:string){const wait=page.waitForEvent('download',{timeout:120000});await page.locator(id).click();return readFile((await(await wait).path())!);}
let fixture=0;
async function load(page:Page,product:Product){
  const saved=JSON.parse((await download(page,'#backup')).toString());saved.product={...product,name:`${product.name} fixture ${++fixture}`};
  await page.getByLabel('Import project backup',{exact:true}).setInputFiles({name:'sheer.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
  await expect(page.locator('#product-status')).toContainText(saved.product.name);
}
function chiffon(product:Product){for(const style of Object.values(product.parts)){style.material='chiffon-50';style.color='#c81e1e';}return product;}
const files=new WeakMap<Glb,Buffer>();
interface Glb {accessors:{bufferView:number;byteOffset?:number;count:number}[];bufferViews:{byteOffset?:number;byteStride?:number}[];nodes:{name?:string;mesh?:number}[];meshes:{primitives:{material:number;attributes:Record<string,number>}[]}[];materials:{alphaMode?:string;doubleSided?:boolean;pbrMetallicRoughness?:{baseColorFactor?:number[]}}[]}
async function glb(page:Page){const bytes=await download(page,'#product-glb');const doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString())as Glb;files.set(doc,bytes);return doc;}
function surface(doc:Glb,name:string){const node=doc.nodes.find(n=>n.name===name);expect(node,`mesh ${name}`).toBeTruthy();return doc.materials[doc.meshes[node!.mesh!]!.primitives[0]!.material]!;}
function vectors(doc:Glb,name:string,kind='POSITION'){
  const bytes=files.get(doc)!,node=doc.nodes.find(n=>n.name===name)!;
  const a=doc.accessors[doc.meshes[node.mesh!]!.primitives[0]!.attributes[kind]!]!,v=doc.bufferViews[a.bufferView]!;
  return Array.from({length:a.count*3},(_,i)=>bytes.readFloatLE(28+bytes.readUInt32LE(12)+(v.byteOffset??0)+(a.byteOffset??0)+Math.floor(i/3)*(v.byteStride??12)+(i%3)*4));
}
function innerGap(doc:Glb,name:string){
  const outer=vectors(doc,'Front body'),normals=vectors(doc,'Front body','NORMAL'),inside=vectors(doc,name);expect(inside.length).toBe(outer.length);
  let sum=0;for(let i=0;i<outer.length;i++)sum+=(outer[i]!-inside[i]!)*normals[i]!;return sum/(outer.length/3);
}
async function pixels(page:Page,bytes:Buffer){return page.evaluate(async base64=>{
  const image=new Image();image.src=`data:image/png;base64,${base64}`;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);
  const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let covered=0,partial=0,opaque=0;
  for(let i=3;i<data.length;i+=4){if(data[i]!>10)covered++;if(data[i]!>10&&data[i]!<240)partial++;if(data[i]!>250)opaque++;}
  return {covered,partial,opaque,width:image.width,height:image.height,corner:[...data.slice(0,4)]};
},bytes.toString('base64'));}

for(const width of [1280,390])test(`chiffon is visibly sheer in the live garment and PNG/GLB at ${width}px`,async({page})=>{
  test.setTimeout(150000);await page.setViewportSize({width,height:900});await page.goto('/');
  const opaque=template('blank');for(const style of Object.values(opaque.parts)){style.material='poplin-120';style.color='#c81e1e';}
  await load(page,opaque);const solid=await pixels(page,await download(page,'#product-png-front'));expect(solid.covered).toBeGreaterThan(10000);expect(solid.partial/solid.covered).toBeLessThan(.05);
  await load(page,chiffon(template('blank')));
  const live=await page.locator('#product-canvas').evaluate(c=>(c as HTMLCanvasElement).toDataURL());const liveStats=await pixels(page,Buffer.from(live.split(',')[1]!,'base64'));expect(liveStats.partial/liveStats.covered).toBeGreaterThan(.5);
  const sheer=await pixels(page,await download(page,'#product-png-front'));expect(sheer.partial/sheer.covered).toBeGreaterThan(.5);
  const doc=await glb(page),front=surface(doc,'Front body');expect(front.alphaMode).toBe('BLEND');expect(front.pbrMetallicRoughness?.baseColorFactor?.[3]).toBeGreaterThan(0);expect(front.pbrMetallicRoughness?.baseColorFactor?.[3]).toBeLessThan(1);expect(front.doubleSided).toBe(true);
  await page.locator('#part-material').selectOption('poplin-120');expect(surface(await glb(page),'Front body').alphaMode??'OPAQUE').toBe('OPAQUE');
  await page.locator('#undo').click();expect(surface(await glb(page),'Front body').alphaMode).toBe('BLEND');
  await page.locator('#redo').click();expect(surface(await glb(page),'Front body').alphaMode??'OPAQUE').toBe('OPAQUE');await page.locator('#undo').click();
  await expect(page.locator('#fabric-optics-help')).toContainText('illustrative');
  await expect(page.locator('#save-state')).toHaveText('Locally saved');await page.reload();expect(surface(await glb(page),'Front body').alphaMode).toBe('BLEND');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('an opaque lining and fused front stay opaque behind a sheer coat, with distinct inner surfaces',async({page})=>{
  test.setTimeout(150000);await page.goto('/');
  const coat=withOptions(chiffon(template('blazer')),{...optionsOf(template('blazer')),lining:true,interfacing:true});
  coat.parts.lining!.material='lining-90';coat.parts.lining!.color='#305a90';await load(page,coat);
  const doc=await glb(page);expect(surface(doc,'Front body').alphaMode).toBe('BLEND');expect(surface(doc,'Front body lining').alphaMode??'OPAQUE').toBe('OPAQUE');expect(surface(doc,'Front body fused support').alphaMode??'OPAQUE').toBe('OPAQUE');expect(surface(doc,'Lapels fused support').alphaMode??'OPAQUE').toBe('OPAQUE');
  expect(surface(doc,'Front body lining').doubleSided).toBe(true);
  const support=innerGap(doc,'Front body fused support'),lining=innerGap(doc,'Front body lining');expect(support).toBeGreaterThan(.01);expect(support).toBeLessThan(.07);expect(lining).toBeGreaterThan(support+.01);expect(lining).toBeLessThan(.15);
  const photo=await pixels(page,await download(page,'#product-png-front'));expect(photo.opaque/photo.covered).toBeGreaterThan(.5);
  coat.parts.lining!.material='chiffon-50';await load(page,coat);const sheer=await glb(page);expect(surface(sheer,'Front body lining').alphaMode).toBe('BLEND');expect(surface(sheer,'Front body fused support').alphaMode??'OPAQUE').toBe('OPAQUE');
});

test('studio PNG keeps transparent cloth alpha and composites a white backdrop',async({page})=>{
  test.setTimeout(240000);await page.goto('/');await load(page,chiffon(template('blank')));await page.getByLabel('Backdrop').selectOption('transparent',{timeout:5000});
  const clear=await pixels(page,await download(page,'#product-studio'));expect([clear.width,clear.height]).toEqual([1600,2000]);expect(clear.covered).toBeGreaterThan(100000);expect(clear.partial/clear.covered).toBeGreaterThan(.5);expect(clear.corner[3]).toBe(0);
  await page.getByLabel('Backdrop').selectOption('white',{timeout:5000});const white=await pixels(page,await download(page,'#product-studio'));expect(white.opaque).toBe(1600*2000);expect(white.corner).toEqual([255,255,255,255]);
});

test('renderer-free GLB retains sheer material and opaque support',async({page})=>{
  await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,kind:string,...args:unknown[]){if(kind==='webgl'||kind==='webgl2'||kind==='experimental-webgl')return null;return original.apply(this,[kind,...args]as Parameters<typeof original>);}as typeof original;});
  await page.goto('/');const coat=withOptions(chiffon(template('blazer')),{...optionsOf(template('blazer')),interfacing:true});await load(page,coat);await expect(page.locator('#product-preview-unavailable')).toBeVisible();const doc=await glb(page);expect(surface(doc,'Front body').alphaMode).toBe('BLEND');expect(surface(doc,'Front body fused support').alphaMode??'OPAQUE').toBe('OPAQUE');
});


test('an outfit exports its opaque inner garment and artwork through a sheer outer layer',async({page})=>{
  test.setTimeout(180000);await page.goto('/');await load(page,chiffon(template('blazer')));
  await page.getByRole('combobox',{name:'Wear with',exact:true}).selectOption({label:'Blank tee'});
  const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=32;const x=c.getContext('2d')!;x.fillStyle='#00ff00';x.fillRect(0,0,32,32);return c.toDataURL('image/png');});
  await page.locator('#artwork-side').selectOption('front');await page.locator('#artwork-file').setInputFiles({name:'green.png',mimeType:'image/png',buffer:Buffer.from(image.split(',')[1]!,'base64')});await expect(page.locator('#message')).toContainText('Artwork placed on the front');
  // Keep the mark on the cloth beside the blazer's open V, clear of the empty centre.
  await page.locator('#artwork-width').fill('8');await page.locator('#artwork-x').fill('14');await page.locator('#apply-artwork').click();await expect(page.locator('#message')).toContainText('Artwork placement applied');
  await page.locator('#garment-drape-on').click();await expect(page.locator('#garment-drape-status')).toContainText('Worn over the Blank tee',{timeout:150000});
  await page.locator('#export-outfit').check();const doc=await glb(page);expect(surface(doc,'Front body').alphaMode).toBe('BLEND');expect(surface(doc,'Blank tee: Front body').alphaMode??'OPAQUE').toBe('OPAQUE');expect(doc.nodes.some(n=>n.name?.endsWith('Front artwork'))).toBe(true);
  const shot=await pixels(page,await download(page,'#product-png-front'));expect(shot.opaque).toBeGreaterThan(10000);
});
