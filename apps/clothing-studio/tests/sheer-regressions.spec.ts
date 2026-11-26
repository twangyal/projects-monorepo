import {test,expect,type Page} from './helpers/expanded-workspace.ts';
import {readFile} from 'node:fs/promises';
import {template,artworkDefaults,type Product} from '../src/product.ts';

async function download(page:Page,id:string){const wait=page.waitForEvent('download',{timeout:120000});await page.locator(id).click();return readFile((await(await wait).path())!);}
let fixture=0;
async function load(page:Page,product:Product,wornWith?:Product){
  const saved=JSON.parse((await download(page,'#backup')).toString());saved.product={...product,name:product.name+' regression '+(++fixture)};if(wornWith)saved.wornWith=wornWith;else delete saved.wornWith;
  await page.getByLabel('Import project backup',{exact:true}).setInputFiles({name:'regression.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});await expect(page.locator('#product-status')).toContainText(saved.product.name);
}
function fabric(product:Product,sheer=true){for(const style of Object.values(product.parts)){style.material=sheer?'chiffon-50':'poplin-120';style.color='#c81e1e';}return product;}
async function mark(page:Page,product:Product,side:'front'|'sleeveLeft'='front'){
  const dataUrl=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=32;const x=c.getContext('2d')!;x.fillStyle='#00ff00';x.fillRect(0,0,32,32);return c.toDataURL('image/png');});
  product.artwork=[{part:side,dataUrl,name:'green.png',width:32,height:32,...artworkDefaults(product,side,{width:32,height:32})}];return product;
}
interface Glb {nodes:{name?:string;mesh?:number}[];meshes:{primitives:{attributes:Record<string,number>;material:number}[]}[];materials:{doubleSided?:boolean}[];accessors:{bufferView:number;byteOffset?:number;count:number}[];bufferViews:{byteOffset?:number;byteStride?:number}[]}
function parsed(bytes:Buffer){
  const length=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+length).toString())as Glb;
  return{doc,uv(name:string){
    const node=doc.nodes.find(n=>n.name===name);expect(node,name).toBeTruthy();const primitive=doc.meshes[node!.mesh!]!.primitives[0]!,a=doc.accessors[primitive.attributes.TEXCOORD_0!]!,v=doc.bufferViews[a.bufferView]!;
    return{values:Array.from({length:a.count*2},(_,i)=>bytes.readFloatLE(28+length+(v.byteOffset??0)+(a.byteOffset??0)+Math.floor(i/2)*(v.byteStride??8)+(i%2)*4)),material:doc.materials[primitive.material]!};
  }};
}
async function difference(page:Page,a:Buffer,b:Buffer){return page.evaluate(async inputs=>{
  const arrays:Uint8ClampedArray[]=[];for(const base64 of inputs){const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const x=c.getContext('2d')!;x.drawImage(image,0,0);arrays.push(x.getImageData(0,0,c.width,c.height).data);}
  let changed=0;for(let i=0;i<arrays[0]!.length;i+=4)if([0,1,2,3].some(k=>Math.abs(arrays[0]![i+k]!-arrays[1]![i+k]!)>=8))changed++;return changed;
},[a.toString('base64'),b.toString('base64')]);}

test('review regression: artwork spanning an open V is clipped onto both panels',async({page})=>{
  test.setTimeout(120000);await page.goto('/');await load(page,await mark(page,fabric(template('blazer'))));
  const {doc}=parsed(await download(page,'#product-glb'));expect(doc.nodes.some(n=>n.name==='Front artwork')).toBe(true);
  const image=await download(page,'#product-png-front'),bands=await page.evaluate(async base64=>{
    const i=new Image();i.src='data:image/png;base64,'+base64;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d')!;x.drawImage(i,0,0);const d=x.getImageData(0,0,c.width,c.height).data;
    const green=(px:number,py:number)=>{const k=(py*c.width+px)*4;return d[k+3]!>80&&d[k+1]!>d[k]!*1.5&&d[k+1]!>d[k+2]!*1.5;};let left=0,right=0,gaps=0;
    for(let y=0;y<c.height;y++){let l=0,r=0;for(let z=0;z<c.width;z++)if(green(z,y)){if(z<c.width/2)l++;else r++;}left+=l;right+=r;if(l>4&&r>4&&!green(Math.floor(c.width/2),y))gaps++;}return{left,right,gaps};
  },image.toString('base64'));expect(bands.left).toBeGreaterThan(200);expect(bands.right).toBeGreaterThan(200);expect(bands.gaps).toBeGreaterThan(5);
  const absent=await mark(page,fabric(template('blazer')));absent.artwork[0]!.widthCm=3;await load(page,absent);const empty=parsed(await download(page,'#product-glb')).doc;expect(empty.nodes.some(n=>n.name==='Front artwork')).toBe(false);expect(empty.accessors.every(a=>a.count>0)).toBe(true);
});

test('review regression: a reverse print shows through sheer cloth and is hidden by opaque cloth',async({page})=>{
  test.setTimeout(150000);await page.goto('/');
  for(const sheer of [true,false]){
    const product=fabric(template('blank'));if(!sheer)product.parts.back.material='poplin-120';await load(page,product);const plain=await download(page,'#product-png-back');await mark(page,product);await load(page,product);const printed=await download(page,'#product-png-back'),changed=await difference(page,plain,printed);
    if(sheer)expect(changed).toBeGreaterThan(500);else expect(changed).toBeLessThan(50);
  }
});

test('review regression: companion sleeve print has finite UVs and is visible in the outfit export',async({page})=>{
  test.setTimeout(180000);await page.goto('/');const inner=await mark(page,fabric(template('blank')),'sleeveLeft');for(const s of Object.values(inner.parts))s.color='#ffffff';
  await load(page,fabric(template('blazer')),inner);await page.locator('#garment-drape-on').click();await expect(page.locator('#garment-drape-status')).toContainText('Worn over the Blank tee',{timeout:150000});await page.locator('#export-outfit').check();
  const model=parsed(await download(page,'#product-glb')),uv=model.uv('Blank tee: Left sleeve artwork');expect(uv.values.length).toBeGreaterThan(4);expect(uv.values.every(Number.isFinite)).toBe(true);expect(uv.values.some(v=>v>0&&v<1)).toBe(true);expect(uv.material.doubleSided).toBe(true);
  const image=await download(page,'#product-png-front'),green=await page.evaluate(async base64=>{const i=new Image();i.src='data:image/png;base64,'+base64;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d')!;x.drawImage(i,0,0);const d=x.getImageData(0,0,c.width,c.height).data;let n=0;for(let j=0;j<d.length;j+=4)if(d[j+3]!>80&&d[j+1]!>d[j]!*0.8&&d[j+1]!>d[j+2]!*1.5)n++;return n;},image.toString('base64'));expect(green).toBeGreaterThan(50);
});

test('review regression: transparent overlays cast no solid studio shadow',async({page})=>{
  test.setTimeout(240000);await page.goto('/');const product=await mark(page,fabric(template('blazer')),'sleeveLeft');await load(page,product);
  const render=async(control:boolean)=>page.evaluate(async({product,control})=>{
    const entry=performance.getEntriesByType('resource').find(e=>/product-3d-.*\.js/.test(e.name));if(!entry)throw new Error('Production renderer was not loaded.');
    const {StudioScene}=await import(entry.name);const scene=new StudioScene(),casts:Record<string,boolean>={};
    try{
      scene.setProduct(product,null,null,false);await scene.prepareArtwork();
      const group=(scene as unknown as {group:{traverse(fn:(object:{name:string;castShadow:boolean})=>void):void}}).group;
      // Both images draw identical real geometry; the control suppresses only the clear overlays' shadows.
      if(control)group.traverse(o=>{if(/stitching$|sleeve artwork$/.test(o.name))Object.defineProperty(o,'castShadow',{get:()=>false,set:()=>undefined,configurable:true});});
      const blob=await scene.png('three-quarter','transparent');group.traverse(o=>{if(/stitching$|sleeve artwork$/.test(o.name))casts[o.name]=o.castShadow;});
      const image=await new Promise<string>(resolve=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]!);r.readAsDataURL(blob);});return{image,casts};
    }finally{scene.dispose();}
  },{product,control});
  const normal=await render(false),clear=await render(true);expect(await difference(page,Buffer.from(normal.image,'base64'),Buffer.from(clear.image,'base64'))).toBeLessThan(100);expect(normal.casts['Lapels stitching']).toBe(false);expect(normal.casts['Left sleeve artwork']).toBe(false);
});
