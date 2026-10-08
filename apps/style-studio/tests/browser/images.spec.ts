import { expect, test } from '@playwright/test';
import type { PhotoAsset, Piece, Project } from '../../src/types.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/images-harness.html');
  await expect(page.locator('#ready')).toHaveText('Actual image modules ready');
});
test('real PNG, JPEG and static WebP become contained white720-square bounded JPEGs', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 600;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#F00000'; ctx.fillRect(0,0,1200,600);
    const results = [];
    for (const mime of ['image/png','image/jpeg','image/webp']) {
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!),mime));
      const asset = await window.imageHarness.normalizePhoto(blob,'a'.repeat(32));
      const bitmap = await createImageBitmap(await (await fetch(asset.dataUrl)).blob());
      const check = new OffscreenCanvas(720,720), pixels = check.getContext('2d')!; pixels.drawImage(bitmap,0,0);
      const pixel = (x:number,y:number) => Array.from(pixels.getImageData(x,y,1,1).data);
      results.push({ width:bitmap.width,height:bitmap.height,bytes:atob(asset.dataUrl.split(',')[1]).length,mime:asset.mime,top:pixel(360,100),center:pixel(360,360),bottom:pixel(360,620) }); bitmap.close();
    }
    return results;
  });
  for (const result of results) {
    expect(result.width).toBe(720); expect(result.height).toBe(720); expect(result.bytes).toBeLessThanOrEqual(204800); expect(result.mime).toBe('image/jpeg');
    expect(result.top).toEqual([255,255,255,255]); expect(result.bottom).toEqual([255,255,255,255]); expect(result.center[0]).toBeGreaterThan(230); expect(result.center[1]).toBeLessThan(10);
  }
});
test('transparent pixels become white, source metadata is absent and noise meets byte cap', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 720; const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#00FF00';ctx.fillRect(200,200,320,320);
    const transparent=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png'));
    const photo=await window.imageHarness.normalizePhoto(transparent,'a'.repeat(32));
    const bitmap=await createImageBitmap(await(await fetch(photo.dataUrl)).blob()); const check=new OffscreenCanvas(720,720), pixels=check.getContext('2d')!;pixels.drawImage(bitmap,0,0);
    const corner=Array.from(pixels.getImageData(10,10,1,1).data); bitmap.close();
    const raw=Uint8Array.from(atob(photo.dataUrl.split(',')[1]),c=>c.charCodeAt(0));
    const marker=new TextEncoder().encode('SYNTHETIC_PRIVATE_METADATA'); const comment=new Uint8Array(marker.length+4);comment.set([255,254,0,marker.length+2]);comment.set(marker,4);
    const tagged=new Blob([raw.subarray(0,2),comment,raw.subarray(2)],{type:'image/jpeg'});
    const clean=await window.imageHarness.normalizePhoto(tagged,'b'.repeat(32));
    const data=ctx.createImageData(720,720);let seed=123456;
    for(let i=0;i<data.data.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;data.data[i]=i%4===3?255:seed&255;}
    ctx.putImageData(data,0,0);const noise=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png'));
    const noisy=await window.imageHarness.normalizePhoto(noise,'c'.repeat(32));
    return {corner,hasMetadata:atob(clean.dataUrl.split(',')[1]).includes('SYNTHETIC_PRIVATE_METADATA'),noiseBytes:atob(noisy.dataUrl.split(',')[1]).length};
  });
  expect(result.corner).toEqual([255,255,255,255]);expect(result.hasMetadata).toBe(false);expect(result.noiseBytes).toBeLessThanOrEqual(204800);
});
test('unsafe headers fail before decode, corrupt compressed pixels fail actual decode',async({page})=>{
  const result=await page.evaluate(async()=>{
    const h=window.imageHarness, canvas=document.createElement('canvas');canvas.width=canvas.height=10;canvas.getContext('2d')!.fillRect(0,0,10,10);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png'));
    const bytes=new Uint8Array(await blob.arrayBuffer()), huge=bytes.slice();new DataView(huge.buffer).setUint32(16,8193);
    const actual=window.createImageBitmap.bind(window);let calls=0;window.createImageBitmap=(async(...args:Parameters<typeof createImageBitmap>)=>{calls++;return actual(...args);}) as typeof createImageBitmap;
    const errors=[];
    try {
      for(const source of [new Blob(['<svg/>'],{type:'image/svg+xml'}),new Blob([huge],{type:'image/png'}),new Blob([bytes],{type:'image/jpeg'}),new Blob([new Uint8Array(8388609)],{type:'image/png'})]) {
        try{await h.normalizePhoto(source,'a'.repeat(32));}catch(error){errors.push(String(error));}
      }
      const beforeCorrupt=calls;let offset=8;const bad=bytes.slice();
      while(offset+12<=bad.length){const length=new DataView(bad.buffer).getUint32(offset),name=String.fromCharCode(...bad.subarray(offset+4,offset+8));if(name==='IDAT'){bad.fill(0,offset+8,offset+8+length);break;}offset+=length+12;}
      try{await h.normalizePhoto(new Blob([bad],{type:'image/png'}),'a'.repeat(32));}catch(error){errors.push(String(error));}
      return {errors,beforeCorrupt,calls};
    }finally{window.createImageBitmap=actual;}
  });
  expect(result.errors).toHaveLength(5);expect(result.beforeCorrupt).toBe(0);expect(result.calls).toBe(1);expect(result.errors[4]).toMatch(/decode|corrupt/i);
});
test('late decoded bitmap is closed when normalization is cancelled',async({page})=>{
  const result=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=20;canvas.getContext('2d')!.fillRect(0,0,20,20);
    const source=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png'));
    const actual=window.createImageBitmap.bind(window);const controller=new AbortController();let bitmap:ImageBitmap|undefined;
    window.createImageBitmap=(async(...args:Parameters<typeof createImageBitmap>)=>{bitmap=await actual(...args);controller.abort();return bitmap;}) as typeof createImageBitmap;
    let name='';try{await window.imageHarness.normalizePhoto(source,'a'.repeat(32),controller.signal);}catch(error){name=(error as Error).name;}finally{window.createImageBitmap=actual;}
    return {name,width:bitmap?.width};
  });
  expect(result.name).toBe('AbortError');expect(result.width).toBe(0);
});
test('stored photo gate really decodes and closes assets, including late cancellation',async({page})=>{
  const result=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=720;canvas.getContext('2d')!.fillRect(0,0,720,720);
    const asset:PhotoAsset={id:'a'.repeat(32),mime:'image/jpeg',width:720,height:720,dataUrl:canvas.toDataURL('image/jpeg')};
    const project:Project={schemaVersion:1,title:'Gate',pieces:[{id:'b'.repeat(32),name:'Top',category:'top',tags:{palette:'warm',fit:'regular',style:'classic',formality:'casual'},photoId:asset.id}],examples:[],looks:[],photos:[asset]};
    await window.imageHarness.validateProjectPhotos(project);
    const broken:PhotoAsset={...asset,dataUrl:'data:image/jpeg;base64,'+btoa(String.fromCharCode(255,216,255,192,0,11,8,2,208,2,208,1,1,17,0,255,217))};
    let corrupt='';try{await window.imageHarness.validateProjectPhotos({...project,photos:[broken]});}catch(error){corrupt=String(error);}
    const actual=window.createImageBitmap.bind(window),controller=new AbortController();let bitmap:ImageBitmap|undefined;
    window.createImageBitmap=(async(...args:Parameters<typeof createImageBitmap>)=>{bitmap=await actual(...args);controller.abort();return bitmap;}) as typeof createImageBitmap;
    let name='';try{await window.imageHarness.validateProjectPhotos(project,controller.signal);}catch(error){name=(error as Error).name;}finally{window.createImageBitmap=actual;}
    return {corrupt,name,width:bitmap?.width};
  });
  expect(result.corrupt).toMatch(/decode/i);expect(result.name).toBe('AbortError');expect(result.width).toBe(0);
});
test('board is real1200x1000 PNG with photo/procedural art and saved snapshots survive live deletion',async({page})=>{
  const result=await page.evaluate(async()=>{
    const h=window.imageHarness,canvas=document.createElement('canvas');canvas.width=canvas.height=720;const ink=canvas.getContext('2d')!;ink.fillStyle='#EF1010';ink.fillRect(0,0,720,720);
    const photo:PhotoAsset={id:'a'.repeat(32),mime:'image/jpeg',width:720,height:720,dataUrl:canvas.toDataURL('image/jpeg')};
    const pieces:Piece[]=['top','bottom','shoes'].map((category,i)=>({id:(i+1).toString().repeat(32),name:['Saved red top','Blue trousers','Classic shoes'][i],category:category as Piece['category'],tags:{palette:i===1?'cool':'neutral',fit:'regular',style:'classic',formality:'smart'},photoId:i===0?photo.id:null}));
    const project:Project={schemaVersion:1,title:'Original board profile',pieces,examples:[],photos:[photo],looks:[{id:'f'.repeat(32),name:'Our night walk',notes:'An original annotated saved outfit.',pieces:pieces as [Piece,Piece,Piece]}]};
    const written:string[]=[];const actual=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){written.push(text);return actual.call(this,text,...args);};
    let first:Blob,second:Blob;
    try{first=await h.exportLookPng(project,'f'.repeat(32));second=await h.exportLookPng({...project,pieces:[]},'f'.repeat(32));}finally{CanvasRenderingContext2D.prototype.fillText=actual;}
    const a=await createImageBitmap(first),b=await createImageBitmap(second),check=new OffscreenCanvas(1200,1000),pixels=check.getContext('2d')!;
    pixels.drawImage(a,0,0);const aa=pixels.getImageData(0,0,1200,1000).data;pixels.drawImage(b,0,0);const bb=pixels.getImageData(0,0,1200,1000).data;
    let red=0,blue=0,inkCount=0;for(let i=0;i<aa.length;i+=4){if(aa[i]>180&&aa[i+1]<70&&aa[i+2]<70)red++;if(aa[i+2]>aa[i]+20&&aa[i+2]>aa[i+1])blue++;if(aa[i]+aa[i+1]+aa[i+2]<700)inkCount++;}
    const result={width:a.width,height:a.height,mime:first.type,bytes:first.size,red,blue,inkCount,equal:aa.every((value,index)=>value===bb[index]),written};a.close();b.close();return result;
  });
  expect(result.width).toBe(1200);expect(result.height).toBe(1000);expect(result.mime).toBe('image/png');expect(result.bytes).toBeGreaterThan(1000);
  expect(result.red).toBeGreaterThan(5000);expect(result.blue).toBeGreaterThan(1000);expect(result.inkCount).toBeGreaterThan(20000);expect(result.equal).toBe(true);
  for(const text of ['Original board profile','Our night walk','Saved red top','An original annotated saved outfit.'])expect(result.written.join(' ')).toContain(text);
  expect(result.written.join(' ')).toContain('smart');
});

test('phone JPEG EXIF orientation6 is preserved before metadata-free square normalization',async({page})=>{
  const result=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=120;canvas.height=60;const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#EF1010';ctx.fillRect(0,0,60,60);ctx.fillStyle='#1010EF';ctx.fillRect(60,0,60,60);
    const jpeg=Uint8Array.from(atob(canvas.toDataURL('image/jpeg').split(',')[1]),c=>c.charCodeAt(0));
    const exif=new Uint8Array(36),view=new DataView(exif.buffer);exif.set([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0]);
    view.setUint16(20,0x112,true);view.setUint16(22,3,true);view.setUint32(24,1,true);view.setUint16(28,6,true);
    const tagged=new Blob([jpeg.subarray(0,2),exif,jpeg.subarray(2)],{type:'image/jpeg'});
    const source=await createImageBitmap(tagged);const original=[source.width,source.height];source.close();
    const asset=await window.imageHarness.normalizePhoto(tagged,'a'.repeat(32));
    const bitmap=await createImageBitmap(await(await fetch(asset.dataUrl)).blob()),check=new OffscreenCanvas(720,720),pixels=check.getContext('2d')!;pixels.drawImage(bitmap,0,0);
    const pixel=(x:number,y:number)=>Array.from(pixels.getImageData(x,y,1,1).data);
    const result={original,left:pixel(50,360),top:pixel(360,180),bottom:pixel(360,540),hasExif:atob(asset.dataUrl.split(',')[1]).includes('Exif\0\0')};bitmap.close();return result;
  });
  expect(result.original).toEqual([60,120]);expect(result.left).toEqual([255,255,255,255]);
  expect(result.top[0]).toBeGreaterThan(220);expect(result.top[2]).toBeLessThan(40);expect(result.bottom[2]).toBeGreaterThan(220);expect(result.bottom[0]).toBeLessThan(40);expect(result.hasExif).toBe(false);
});

test('normalization closes the real bitmap if Canvas creation fails after decoding',async({page})=>{
  const result=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=20;canvas.getContext('2d')!.fillRect(0,0,20,20);
    const source=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png'));
    const actualDecode=window.createImageBitmap.bind(window),actualCreate=document.createElement.bind(document);let bitmap:ImageBitmap|undefined;
    window.createImageBitmap=(async(...args:Parameters<typeof createImageBitmap>)=>{bitmap=await actualDecode(...args);return bitmap;}) as typeof createImageBitmap;
    document.createElement=((name:string,...args:Parameters<typeof document.createElement> extends [string,...infer T]?T:never)=>{if(name==='canvas')throw new Error('Controlled Canvas unavailable');return actualCreate(name,...args);}) as typeof document.createElement;
    let error='';try{await window.imageHarness.normalizePhoto(source,'a'.repeat(32));}catch(value){error=String(value);}finally{window.createImageBitmap=actualDecode;document.createElement=actualCreate;}
    return {error,width:bitmap?.width};
  });
  expect(result.error).toContain('Controlled Canvas unavailable');expect(result.width).toBe(0);
});

for(const mime of ['image/png','image/webp'])test(`${mime} EXIF orientation6 becomes upright metadata-free reference pixels`,async({page})=>{
  const result=await page.evaluate(async mime=>{
    const canvas=document.createElement('canvas');canvas.width=120;canvas.height=60;const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#EF1010';ctx.fillRect(0,0,60,60);ctx.fillStyle='#1010EF';ctx.fillRect(60,0,60,60);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),mime)),original=new Uint8Array(await blob.arrayBuffer());
    const tiff=new Uint8Array(26),view=new DataView(tiff.buffer);tiff.set([73,73,42,0,8,0,0,0,1,0]);view.setUint16(10,0x112,true);view.setUint16(12,3,true);view.setUint32(14,1,true);view.setUint16(18,6,true);
    const concat=(...parts:Uint8Array[])=>{const result=new Uint8Array(parts.reduce((sum,part)=>sum+part.length,0));let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;};
    let tagged:Uint8Array;
    if(mime==='image/png'){
      const chunk=new Uint8Array(38),chunkView=new DataView(chunk.buffer);chunkView.setUint32(0,26);chunk.set(new TextEncoder().encode('eXIf'),4);chunk.set(tiff,8);
      let crc=0xffffffff;for(const byte of chunk.subarray(4,34)){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}chunkView.setUint32(34,(crc^0xffffffff)>>>0);
      tagged=concat(original.subarray(0,33),chunk,original.subarray(33));
    }else{
      const exif=new Uint8Array(34);exif.set(new TextEncoder().encode('EXIF'));new DataView(exif.buffer).setUint32(4,26,true);exif.set(tiff,8);
      if(String.fromCharCode(...original.subarray(12,16))==='VP8X'){tagged=concat(original,exif);tagged[20]|=8;}
      else{const extended=new Uint8Array(18);extended.set(new TextEncoder().encode('VP8X'));new DataView(extended.buffer).setUint32(4,10,true);extended[8]=8;extended[12]=119;extended[15]=59;tagged=concat(original.subarray(0,12),extended,original.subarray(12),exif);}
      new DataView(tagged.buffer).setUint32(4,tagged.length-8,true);
    }
    const asset=await window.imageHarness.normalizePhoto(new Blob([tagged as Uint8Array<ArrayBuffer>],{type:mime}),'a'.repeat(32));
    const bitmap=await createImageBitmap(await(await fetch(asset.dataUrl)).blob()),check=new OffscreenCanvas(720,720),pixels=check.getContext('2d')!;pixels.drawImage(bitmap,0,0);
    const pixel=(x:number,y:number)=>Array.from(pixels.getImageData(x,y,1,1).data);
    const result={left:pixel(50,360),top:pixel(360,180),bottom:pixel(360,540),hasExif:atob(asset.dataUrl.split(',')[1]).includes('Exif\0\0')};bitmap.close();return result;
  },mime);
  expect(result.left).toEqual([255,255,255,255]);expect(result.top[0]).toBeGreaterThan(220);expect(result.top[2]).toBeLessThan(40);
  expect(result.bottom[2]).toBeGreaterThan(220);expect(result.bottom[0]).toBeLessThan(40);expect(result.hasExif).toBe(false);
});
