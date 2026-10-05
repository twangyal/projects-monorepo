import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { inspectFrames } from './png-archive-oracle.ts';
import { PNG } from 'pngjs';
import type { Project } from '../src/model.ts';

test('native worker preserves full color, cel cuts and poses in every ordered PNG', async ({ page },info) => {
  await page.goto('/tests/export-harness.html');await expect(page.locator('#ready')).toHaveText('Actual export modules ready');
  const result=await page.evaluate(async()=>{
    const p=window.exportHarness.fixture(12);p.title='Full color Ω / ../title';
    const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const ctx=canvas.getContext('2d')!;
    const pixels=ctx.createImageData(32,32);
    for(let i=0;i<1024;i++){pixels.data[i*4]=i%256;pixels.data[i*4+1]=Math.floor(i/256)*60;pixels.data[i*4+2]=200;pixels.data[i*4+3]=255;}ctx.putImageData(pixels,0,0);
    p.layers.unshift({id:'color-image',name:'1024 exact colors',kind:'image',image:{dataUrl:canvas.toDataURL(),width:32,height:32},keys:[{frame:0,x:40,y:40,scale:1,rotation:0,opacity:1,easing:'hold'}]});
    const drawing=p.layers[1];if(drawing.kind!=='drawing')throw Error('fixture');drawing.cels.push({frame:6,strokes:[{color:'#0000ff',width:40,points:[{x:0,y:0}]}]});
    const original=JSON.stringify(p),values:number[]=[];
    const pending=window.exportHarness.exportPngFrames(p,f=>values.push(f));p.title='Newer external title';
    const blob=await pending;return {bytes:Array.from(new Uint8Array(await blob.arrayBuffer())),values,original};
  });
  const bytes=Buffer.from(result.bytes),{manifest,frames}=inspectFrames(bytes);expect(manifest.title).toBe('Full color Ω / ../title');expect(frames).toHaveLength(12);expect(result.values[0]).toBe(0);expect(result.values.at(-1)).toBe(1);
  for(let frame=0;frame<12;frame++){
    const image=frames[frame],x=Math.round(100+frame*40),center=(180*640+x)*4;
    expect(Array.from(image.data.subarray(center,center+4))).toEqual(frame<6?[255,0,0,255]:[0,0,255,255]);
    const colors=new Set<string>();for(let y=24;y<56;y++)for(let x=24;x<56;x++){const at=(y*640+x)*4;colors.add(image.data.subarray(at,at+3).toString('hex'));}
    expect(colors.size).toBe(1024);
  }
  await writeFile(info.outputPath('original-full-color-frames.zip'),bytes);
});
test('editor downloads all committed frames and retains its editable backup',async({page},info)=>{
  await page.goto('/');await expect(page.locator('#png-frames')).toBeEnabled();
  const original=await page.locator('#project-title').inputValue();
  const event=page.waitForEvent('download');await page.locator('#png-frames').click();const saved=await event;
  expect(saved.suggestedFilename()).toMatch(/-frames.zip$/);const bytes=await readFile((await saved.path())!);const result=inspectFrames(bytes);
  expect(result.manifest.title).toBe(original);expect(result.frames.length).toBeGreaterThanOrEqual(12);await expect(page.locator('#png-frames')).toBeEnabled();await expect(page.locator('#project-title')).toHaveValue(original);
  await writeFile(info.outputPath('editor-frames.zip'),bytes);
});
test('genuine worker cancellation and page departure cannot download late output',async({page})=>{
  await page.goto('/');await expect(page.locator('#png-frames')).toBeEnabled();let downloads=0;page.on('download',()=>downloads++);
  await page.evaluate(()=>{const Native=window.Worker;Object.assign(window,{pngWorkers:[]});window.Worker=class extends Native{constructor(...args:ConstructorParameters<typeof Worker>){super(...args);(window as unknown as {pngWorkers:{ended:boolean}[]}).pngWorkers.push(this as unknown as {ended:boolean});}ended=false;terminate(){this.ended=true;super.terminate();}};});
  await page.locator('#png-frames').click();await page.locator('#cancel-export').click();await expect(page.locator('#png-frames')).toBeEnabled();expect(downloads).toBe(0);
  await page.locator('#png-frames').click();await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {pngWorkers:{ended:boolean}[]}).pngWorkers.every(worker=>worker.ended))).toBe(true);expect(downloads).toBe(0);
});
test('maximum 96-frame eight-layer artwork retains four images, 100 strokes and 10000 points',async({page},info)=>{
  test.setTimeout(90000);
  const colors=['#ff0000','#00ff00','#0000ff','#222222'];
  const project:Project={schemaVersion:2,title:'Original maximum PNG frames',background:'#ffffff',frameCount:96,layers:[]};
  for(let layer=0;layer<4;layer++) {
    project.layers.push({id:`drawing-${layer}`,name:`Original drawing ${layer}`,kind:'drawing',keys:[{frame:0,x:80,y:80+layer*60,scale:1,rotation:0,opacity:1,easing:'linear'},{frame:95,x:460,y:80+layer*60,scale:1,rotation:0,opacity:1,easing:'linear'}],cels:[{frame:0,strokes:Array.from({length:25},(_,stroke)=>({color:colors[layer],width:4,points:Array.from({length:100},(_,point)=>({x:-10+(point%21),y:(stroke-12)/2}))}))}]});
    const image=new PNG({width:4,height:4});for(let pixel=0;pixel<16;pixel++){image.data[pixel*4]=255;image.data[pixel*4+1]=0;image.data[pixel*4+2]=255;image.data[pixel*4+3]=255;}
    project.layers.push({id:`image-${layer}`,name:`Original image ${layer}`,kind:'image',image:{width:4,height:4,dataUrl:`data:image/png;base64,${PNG.sync.write(image).toString('base64')}`},keys:[{frame:0,x:layer%2?610:30,y:layer<2?30:330,scale:4,rotation:0,opacity:1,easing:'hold'}]});
  }
  await page.goto('/');await expect(page.locator('#project-file')).toBeEnabled();await page.locator('#project-file-action').selectOption('new');await page.locator('#project-file').setInputFiles({name:'maximum.motion.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});await expect(page.locator('#project-title')).toHaveValue(project.title);await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
  const downloads=page.waitForEvent('download');await page.locator('#png-frames').click();const downloaded=await downloads,bytes=await readFile((await downloaded.path())!),result=inspectFrames(bytes);
  expect(result.frames).toHaveLength(96);
  for(let frame=0;frame<96;frame++) {
    const image=result.frames[frame],x=80+frame*4;
    for(let layer=0;layer<4;layer++){
      const at=((80+layer*60)*640+x)*4;
      expect(image.data.subarray(at,at+3).toString('hex')).toBe(colors[layer].slice(1));
      const ix=layer%2?610:30,iy=layer<2?30:330,offset=(iy*640+ix)*4;
      expect(Array.from(image.data.subarray(offset,offset+4))).toEqual([255,0,255,255]);
    }
  }
  const backup=page.waitForEvent('download');await page.locator('#backup').click();const file=await backup;expect(JSON.parse((await readFile((await file.path())!)).toString())).toEqual(project);
  await writeFile(info.outputPath('maximum-96-frames.zip'),bytes);await writeFile(info.outputPath('maximum-project.json'),JSON.stringify(project));
});
