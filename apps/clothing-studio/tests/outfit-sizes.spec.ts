import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';
import { template, partName, type PartId } from '../src/product.ts';
import { gradedOutfit } from '../src/size-grades.ts';

async function backup(page: Page) {
  const wait=page.waitForEvent('download'); await page.locator('#backup').click();
  return JSON.parse((await readFile((await (await wait).path())!)).toString());
}
async function restore(page: Page, project: unknown) {
  await page.getByLabel('Import project backup',{exact:true}).setInputFiles({name:'outfit.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await expect(page.locator('#message')).toContainText('Project backup restored');
}
function positions(bytes: Buffer, name: string): number[] {
  const length=bytes.readUInt32LE(12), json=JSON.parse(bytes.subarray(20,20+length).toString());
  const node=json.nodes.find((n:{name?:string})=>n.name===name); expect(node,name).toBeTruthy();
  const accessor=json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION], view=json.bufferViews[accessor.bufferView];
  return Array.from({length:accessor.count*3},(_,i)=>bytes.readFloatLE(28+length+(view.byteOffset??0)+(accessor.byteOffset??0)+Math.floor(i/3)*(view.byteStride??12)+(i%3)*4));
}
async function capture(page: Page) {
  await page.addInitScript(()=>{
    const Native=Worker;
    window.Worker=class extends Native {
      constructor(...args:ConstructorParameters<typeof Worker>) {
        super(...args);
        if (!String(args[0]).includes('garment-drape.worker')) return;
        const send=this.postMessage.bind(this);
        this.postMessage=(message,options)=>{document.documentElement.dataset.outfitSizeInput=JSON.stringify(message);if(Array.isArray(options))send(message,options);else send(message,options);};
        this.addEventListener('message',event=>{
          if(event.data.kind!=='result')return;
          const result=event.data.result;
          const copy=(parts:{part:PartId;positions:Float32Array}[])=>parts.map(p=>({part:p.part,positions:Array.from(p.positions)}));
          document.documentElement.dataset.outfitSizeResult=JSON.stringify({body:result.body,parts:copy(result.parts),companion:result.companion?copy(result.companion.parts):null,also:result.also?copy(result.also.parts):null});
        });
      }
    };
  });
}
for(const width of [1280,390]) test(`whole outfit size reaches real drape and GLB without changing samples at ${width}px`,async({page})=>{
  test.setTimeout(180000); await capture(page); await page.setViewportSize({width,height:900}); await page.goto('/');
  const whole=page.getByRole('checkbox',{name:'Apply shown size to the whole outfit',exact:true}); await expect(whole).toBeDisabled();
  const project=await backup(page); project.product=template('hoodie');project.wornWith=template('blank');project.wornAlso=template('trousers');
  project.product.spec={styleNumber:'OUTER',season:'',sampleSize:'L'};
  project.wornWith.spec={styleNumber:'INNER',season:'',sampleSize:'S'};
  await restore(page,project); const before=await backup(page), undo=await page.getByRole('button',{name:'Undo',exact:true}).isEnabled();
  const size=page.getByRole('combobox',{name:'Size shown',exact:true}); await expect(size).toHaveValue('L');await expect(whole).not.toBeChecked();
  await page.getByRole('combobox',{name:'Pattern export size',exact:true}).selectOption('XS');
  await page.getByRole('combobox',{name:'Outfit export size',exact:true}).selectOption('XL');
  await whole.check(); await page.getByRole('button',{name:'Drape on a body',exact:true}).click();
  await expect(page.locator('#garment-drape-status')).toContainText('Whole outfit size L',{timeout:150000});
  const input=await page.evaluate(()=>JSON.parse(document.documentElement.dataset.outfitSizeInput!));
  const graded=gradedOutfit(before.product,before.wornWith,before.wornAlso,'L');
  expect([input.product,input.companion,input.also]).toEqual([graded.product,graded.companion,graded.also]);
  const result=await page.evaluate(()=>JSON.parse(document.documentElement.dataset.outfitSizeResult!)) as {body:unknown;parts:{part:PartId;positions:number[]}[];companion:{part:PartId;positions:number[]}[];also:{part:PartId;positions:number[]}[]};
  await page.getByRole('checkbox',{name:'Include worn garment in PNG, GLB and video',exact:true}).check();
  const wait=page.waitForEvent('download');await page.locator('#product-glb').click();const bytes=await readFile((await (await wait).path())!);
  for(const [garment,parts,prefix] of [[graded.product,result.parts,''],[graded.companion!,result.companion,`${graded.companion!.name}: `],[graded.also!,result.also,`${graded.also!.name}: `]] as const)
    for(const part of parts)expect(positions(bytes,prefix+partName(garment,part.part))).toEqual(part.positions);
  await size.selectOption('M');await expect(page.locator('#garment-drape-status')).toContainText('Whole outfit size M',{timeout:150000});
  const next=await page.evaluate(()=>JSON.parse(document.documentElement.dataset.outfitSizeInput!));
  expect([next.product.spec.sampleSize,next.companion.spec.sampleSize,next.also.spec?.sampleSize??'M']).toEqual(['M','M','M']);
  expect([next.bodyChest,next.bodyShape]).toEqual([input.bodyChest,input.bodyShape]);
  expect((await page.evaluate(()=>JSON.parse(document.documentElement.dataset.outfitSizeResult!))).body).toEqual(result.body);
  await whole.uncheck();await expect(page.locator('#garment-drape-status')).toContainText('Size M, graded from L.',{timeout:150000});
  const single=await page.evaluate(()=>JSON.parse(document.documentElement.dataset.outfitSizeInput!));
  expect(single.companion).toEqual(before.wornWith);expect(single.also).toEqual(before.wornAlso);
  expect((await page.evaluate(()=>JSON.parse(document.documentElement.dataset.outfitSizeResult!))).body).toEqual(result.body);
  expect(await backup(page)).toEqual(before);expect(await page.getByRole('button',{name:'Undo',exact:true}).isEnabled()).toBe(undo);
  await expect(page.getByRole('combobox',{name:'Pattern export size',exact:true})).toHaveValue('XS');
  await expect(page.getByRole('combobox',{name:'Outfit export size',exact:true})).toHaveValue('XL');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('unsupported companion grades refuse and an invalidating applied edit returns to sample sizes',async({page})=>{
  await page.goto('/');const project=await backup(page);project.product=template('blank');project.wornWith=template('trousers');
  project.wornWith.name='Small trousers';project.wornWith.measurements.waist=56;await restore(page,project);
  const whole=page.getByRole('checkbox',{name:'Apply shown size to the whole outfit',exact:true}),size=page.getByRole('combobox',{name:'Size shown',exact:true});
  await size.selectOption('XS');await whole.click();await expect(page.locator('#message')).toContainText('Small trousers: Size XS');await expect(whole).not.toBeChecked();await expect(size).toHaveValue('XS');
  await size.selectOption('M');await whole.check();await size.selectOption('XS');await expect(size).toHaveValue('M');await expect(whole).toBeChecked();
  await size.selectOption('L');await page.getByLabel('Chest (cm)',{exact:true}).fill('146');
  await page.getByRole('button',{name:'Apply measurements',exact:true}).click();
  await expect(whole).not.toBeChecked();await expect(size).toHaveValue('M');await expect(page.locator('#garment-size-status')).toContainText('Showing applied sample sizes');
  expect((await backup(page)).product.measurements.chest).toBe(146);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await backup(page)).product.measurements.chest).toBe(104);
});
