import { test, expect } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function glbContents(bytes: Buffer) {
  expect(bytes.subarray(0,4).toString()).toBe('glTF'); expect(bytes.readUInt32LE(8)).toBe(bytes.length);
  const jsonLength=bytes.readUInt32LE(12), json=JSON.parse(bytes.subarray(20,20+jsonLength).toString()), binary=bytes.subarray(28+jsonLength);
  const views=json.bufferViews.map(({byteOffset=0,...view}:{byteOffset?:number,byteLength:number,byteStride?:number,buffer:number,target?:number})=>({...view,content:hash(binary.subarray(byteOffset,byteOffset+view.byteLength))}));
  // GLTFExporter packs images in asynchronous encode-completion order. Compare all actual referenced bytes.
  for(const item of [...json.accessors,...json.images]) if(item.bufferView!==undefined) item.bufferView=views[item.bufferView];
  delete json.bufferViews;
  return {json,binaryLength:binary.length};
}
for (const [id,suffix] of [['product-png-front','-front.png'],['product-png-back','-back.png'],['product-glb','.glb']] as const) test(`${id} retains original design and title across genuine held encoding`, async ({page}) => {
  test.setTimeout(90000); page.on('dialog', d=>d.accept());
  await page.addInitScript(()=>{
    const state = {armed:false,waiting:false,lost:0,release:()=>{}}; Object.assign(window,{standaloneGate:state});
    const context = HTMLCanvasElement.prototype.getContext, seen = new WeakSet<HTMLCanvasElement>();
    HTMLCanvasElement.prototype.getContext = function(this:HTMLCanvasElement,...args:Parameters<typeof context>) {if(args[0]==='webgl2'&&!seen.has(this)){seen.add(this);this.addEventListener('webglcontextlost',()=>state.lost++);}return context.apply(this,args);} as typeof context;
    const encode=HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){if(!state.armed)return encode.call(this,callback,type,quality);state.armed=false;return encode.call(this,blob=>{state.waiting=true;state.release=()=>callback(blob);},type,quality);};
  });
  await page.goto('/'); const editor=page.locator('#product-editor'), button=page.locator(`#${id}`);
  await editor.getByRole('button',{name:/^Use the Blank tee template/}).click(); await page.getByLabel('Concept name',{exact:true}).fill('Original garment');
  const baselineWait=page.waitForEvent('download');await button.click();const baseline=await readFile((await (await baselineWait).path())!);
  await page.evaluate(()=>{(window as unknown as {standaloneGate:{armed:boolean}}).standaloneGate.armed=true;});await button.click();
  await expect.poll(()=>page.evaluate(()=> (window as unknown as {standaloneGate:{waiting:boolean}}).standaloneGate.waiting)).toBe(true);
  await expect(button).toBeDisabled();
  await editor.getByRole('button',{name:/^Use the Ringer tee template/}).click();await page.getByLabel('Concept name',{exact:true}).fill('Newer garment');
  const backupWait=page.waitForEvent('download');await page.locator('#backup').click();const before=await readFile((await (await backupWait).path())!);
  const wait=page.waitForEvent('download');await page.evaluate(()=> (window as unknown as {standaloneGate:{release:()=>void}}).standaloneGate.release());const file=await wait, bytes=await readFile((await file.path())!);
  expect(file.suggestedFilename()).toBe(`Original garment${suffix}`);
  if (id === 'product-glb') expect(glbContents(bytes)).toEqual(glbContents(baseline));
  else expect(hash(bytes)).toBe(hash(baseline));
  await expect.poll(()=>page.evaluate(()=> (window as unknown as {standaloneGate:{lost:number}}).standaloneGate.lost)).toBe(2);
  await expect(button).toBeEnabled();expect(await page.locator('#product-canvas').evaluate(c=>(c as HTMLCanvasElement).getContext('webgl2')!.isContextLost())).toBe(false);
  const afterWait=page.waitForEvent('download');await page.locator('#backup').click();expect(await readFile((await (await afterWait).path())!)).toEqual(before);
});

test('failed PNG delivery releases its temporary scene and allows a real retry without editing current work', async ({page}) => {
  await page.addInitScript(()=>{
    const state={fail:false,lost:0};Object.assign(window,{failedExport:state});
    const context=HTMLCanvasElement.prototype.getContext,seen=new WeakSet<HTMLCanvasElement>();
    HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,...args:Parameters<typeof context>){if(args[0]==='webgl2'&&!seen.has(this)){seen.add(this);this.addEventListener('webglcontextlost',()=>state.lost++);}return context.apply(this,args);} as typeof context;
    const encode=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){if(state.fail){state.fail=false;queueMicrotask(()=>callback(null));return;}return encode.call(this,callback,type,quality);};
  });
  await page.goto('/');await page.locator('#product-editor').getByRole('button',{name:/^Use the Blank tee template/}).click();
  const wait=page.waitForEvent('download');await page.locator('#backup').click();const before=await readFile((await (await wait).path())!);
  await page.evaluate(()=>{(window as unknown as {failedExport:{fail:boolean}}).failedExport.fail=true;});
  const button=page.locator('#product-png-front');await button.click();await expect(page.locator('#message')).toContainText('could not be exported');
  await expect(button).toBeEnabled();await expect.poll(()=>page.evaluate(()=>(window as unknown as {failedExport:{lost:number}}).failedExport.lost)).toBe(1);
  const retry=page.waitForEvent('download');await button.click();const bytes=await readFile((await (await retry).path())!);expect(bytes.subarray(1,4).toString()).toBe('PNG');
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {failedExport:{lost:number}}).failedExport.lost)).toBe(2);
  const after=page.waitForEvent('download');await page.locator('#backup').click();expect(await readFile((await (await after).path())!)).toEqual(before);
});
