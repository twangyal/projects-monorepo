import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function download(page:Page,name:string){const waiting=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();return readFile((await(await waiting).path())!);}
async function axes(page:Page,url:string,crop=false){return page.evaluate(async({url,crop})=>{
 const image=new Image();image.src=url;await image.decode();const c=document.createElement('canvas');c.width=c.height=160;const x=c.getContext('2d')!;
 x.drawImage(image,crop?image.width*.4:0,crop?image.height*.4:0,crop?image.width*.2:image.width,crop?image.height*.2:image.height,0,0,160,160);
 const data=x.getImageData(0,0,160,160).data,rows=new Array<number>(160).fill(0),cols=[...rows];
 for(let y=0;y<160;y++)for(let z=0;z<160;z++){const k=(y*160+z)*4;const ink=data[k]!<100&&data[k+1]!<120&&data[k+2]!<160?1:0;rows[y]+=ink/160;cols[z]+=ink/160;}
 const variation=(v:number[])=>v.slice(1).reduce((sum,n,i)=>sum+Math.abs(n-v[i]!),0);
 return {rows:variation(rows),cols:variation(cols)};
},{url,crop});}
test('vertical stripes remain editable and directional in real pattern and front PNG through history and reload',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Templates',exact:true}).click();await page.getByRole('button',{name:/^Use the Blank tee template/}).click();
 await page.getByRole('button',{name:'Materials & prints',exact:true}).click();await page.getByLabel('Describe a style',{exact:true}).fill('navy vertical stripes');await page.getByRole('button',{name:'Apply to this part',exact:true}).click();
 await expect(page.locator('#describe-result')).toContainText('stripe direction: vertical');await expect(page.getByRole('combobox',{name:'Stripe direction',exact:true})).toHaveValue('vertical');
 await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();
 const tile=await page.locator('#fill-front image').getAttribute('href');const vertical=await axes(page,tile!);expect(vertical.cols).toBeGreaterThan(.8);expect(vertical.rows).toBeLessThan(.2);
 await page.getByRole('button',{name:'Tech pack',exact:true}).click();await expect(page.locator('#techpack-preview')).toContainText('Vertical stripe');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Exports',exact:true}).click();
 const png=await download(page,'Export front render PNG ↓');const rendered=await axes(page,`data:image/png;base64,${png.toString('base64')}`,true);expect(rendered.cols).toBeGreaterThan(rendered.rows+1);
 const glb=await download(page,'Export 3D model (GLB) ↓'),jsonLength=glb.readUInt32LE(12),gltf=JSON.parse(glb.subarray(20,20+jsonLength).toString());
 const front=gltf.nodes.find((n:{name?:string})=>n.name==='Front body'),material=gltf.materials[gltf.meshes[front.mesh].primitives[0].material];
 const texture=gltf.textures[material.pbrMetallicRoughness.baseColorTexture.index],image=gltf.images[texture.source],view=gltf.bufferViews[image.bufferView];
 const imageBytes=glb.subarray(28+jsonLength+(view.byteOffset??0),28+jsonLength+(view.byteOffset??0)+view.byteLength);
 const embedded=await axes(page,`data:${image.mimeType};base64,${imageBytes.toString('base64')}`);expect(embedded.cols).toBeGreaterThan(.8);expect(embedded.rows).toBeLessThan(.2);
 const original=JSON.parse((await download(page,'Export project backup')).toString());expect(original.product.parts.front.print.direction).toBe('vertical');
 await page.getByRole('button',{name:'Materials & prints',exact:true}).click();await page.getByRole('combobox',{name:'Stripe direction',exact:true}).selectOption('horizontal');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.getByRole('combobox',{name:'Stripe direction',exact:true})).toHaveValue('vertical');await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.getByRole('combobox',{name:'Stripe direction',exact:true})).toHaveValue('horizontal');
 await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();const horizontal=await axes(page,(await page.locator('#fill-front image').getAttribute('href'))!);expect(horizontal.rows).toBeGreaterThan(.8);expect(horizontal.cols).toBeLessThan(.2);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('#save-state')).toHaveText('Locally saved');await page.reload();await page.getByRole('button',{name:'Materials & prints',exact:true}).click();await expect(page.getByRole('combobox',{name:'Stripe direction',exact:true})).toHaveValue('vertical');
 expect(JSON.parse((await download(page,'Export project backup')).toString())).toEqual(original);
});

test('phone stripe controls fit and conflicting words preserve the complete design',async({page})=>{
 await page.setViewportSize({width:390,height:740});await page.goto('/');await page.getByRole('button',{name:'Templates',exact:true}).click();await page.getByRole('button',{name:/^Use the Blank tee template/}).click();await page.getByRole('button',{name:'Materials & prints',exact:true}).click();
 const prompt=page.getByLabel('Describe a style',{exact:true});await prompt.fill('navy vertical stripes');await page.getByRole('button',{name:'Apply to this part',exact:true}).click();await expect(page.getByRole('combobox',{name:'Stripe direction',exact:true})).toHaveValue('vertical');
 const before=await download(page,'Export project backup');await prompt.fill('change horizontal stripes to vertical');await page.getByRole('button',{name:'Apply to this part',exact:true}).click();await expect(page.locator('#message')).toContainText('Specify one stripe direction');expect(await download(page,'Export project backup')).toEqual(before);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
