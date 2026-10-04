import { expect, test } from '@playwright/test';

const ORDER:Record<number,number[]>={1:[0,1,2,3],2:[1,0,3,2],3:[3,2,1,0],4:[2,3,0,1],5:[0,2,1,3],6:[2,0,3,1],7:[3,1,2,0],8:[1,3,0,2]};
const COLORS=[[240,16,16,255],[16,224,16,255],[16,16,240,255],[224,192,16,255]];
test.beforeEach(async({page})=>{await page.goto('/tests/images-harness.html');await expect(page.locator('#ready')).toHaveText('Actual image modules ready');});

test('all eight orientations in PNG JPEG and WebP, square and nonsquare, preserve independently expected pixels',async({page})=>{
  const results=await page.evaluate(async()=>{
    const concat=(...parts:Uint8Array[])=>{const output=new Uint8Array(parts.reduce((sum,p)=>sum+p.length,0));let offset=0;for(const part of parts){output.set(part,offset);offset+=part.length;}return output;};
    const chunk=(name:string,payload:Uint8Array)=>{const output=new Uint8Array(payload.length+12),view=new DataView(output.buffer);view.setUint32(0,payload.length);output.set(new TextEncoder().encode(name),4);output.set(payload,8);let crc=0xffffffff;for(const byte of output.subarray(4,output.length-4)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}view.setUint32(output.length-4,(crc^0xffffffff)>>>0);return output;};
    const results=[];
    for(const height of [60,120])for(const mime of ['image/png','image/jpeg','image/webp']) {
      const canvas=new OffscreenCanvas(120,height),ctx=canvas.getContext('2d')!;
      for(const [i,color]of ['#f01010','#10e010','#1010f0','#e0c010'].entries()){ctx.fillStyle=color;ctx.fillRect((i%2)*60,Math.floor(i/2)*height/2,60,height/2);}
      const blob=await canvas.convertToBlob({type:mime,quality:1}),raw=new Uint8Array(await blob.arrayBuffer());
      const referenceBitmap=await createImageBitmap(blob),referenceCanvas=new OffscreenCanvas(120,height),referenceContext=referenceCanvas.getContext('2d')!;referenceContext.drawImage(referenceBitmap,0,0);referenceBitmap.close();const reference=referenceContext.getImageData(0,0,120,height).data;
      for(let orientation=1;orientation<=8;orientation++) {
        const tiff=new Uint8Array(26),view=new DataView(tiff.buffer);tiff.set([73,73,42,0,8,0,0,0,1,0]);view.setUint16(10,0x112,true);view.setUint16(12,3,true);view.setUint32(14,1,true);view.setUint16(18,orientation,true);
        let tagged:Uint8Array;
        if(mime==='image/jpeg')tagged=concat(raw.subarray(0,2),Uint8Array.of(255,225,0,34,69,120,105,102,0,0),tiff,raw.subarray(2));
        else if(mime==='image/png')tagged=concat(raw.subarray(0,33),chunk('eXIf',tiff),raw.subarray(33));
        else{
          const exif=new Uint8Array(34);exif.set(new TextEncoder().encode('EXIF'));new DataView(exif.buffer).setUint32(4,26,true);exif.set(tiff,8);
          if(String.fromCharCode(...raw.subarray(12,16))==='VP8X'){tagged=concat(raw,exif);tagged[20]|=8;}
          else{const extended=new Uint8Array(18);extended.set(new TextEncoder().encode('VP8X'));new DataView(extended.buffer).setUint32(4,10,true);extended[8]=8;extended[12]=119;extended[15]=height-1;tagged=concat(raw.subarray(0,12),extended,raw.subarray(12),exif);}
          new DataView(tagged.buffer).setUint32(4,tagged.length-8,true);
        }
        const asset=await window.imageHarness.normalizePhoto(new File([tagged as Uint8Array<ArrayBuffer>],'original',{type:mime}));
        const raster=await window.imageHarness.decodePhoto(asset),pixels=[];
        for(const [x,y]of [[.25,.25],[.75,.25],[.25,.75],[.75,.75]]){const offset=(Math.floor(y*raster.height)*raster.width+Math.floor(x*raster.width))*4;pixels.push(Array.from(raster.rgba.slice(offset,offset+4)));}
        let mismatches=0;
        for(let y=0;y<raster.height;y++)for(let x=0;x<raster.width;x++){
          const [sx,sy]=orientation===1?[x,y]:orientation===2?[119-x,y]:orientation===3?[119-x,height-1-y]:orientation===4?[x,height-1-y]:orientation===5?[y,x]:orientation===6?[y,height-1-x]:orientation===7?[119-y,height-1-x]:[119-y,x];
          const sourceOffset=(sy*120+sx)*4,targetOffset=(y*raster.width+x)*4;for(let channel=0;channel<4;channel++)if(reference[sourceOffset+channel]!==raster.rgba[targetOffset+channel])mismatches++;
        }
        const clean=Uint8Array.from(atob(asset.dataUrl.split(',')[1]),c=>c.charCodeAt(0));
        results.push({mime,height,orientation,mismatches,width:raster.width,outHeight:raster.height,pixels,cleanOrientation:window.imageHarness.inspectPhotoHeader(clean).orientation,metadata:atob(asset.dataUrl.split(',')[1]).includes('Exif')});
      }
    }
    return results;
  });
  expect(results).toHaveLength(48);
  for(const result of results){expect(result.width).toBe(result.orientation>=5?result.height:120);expect(result.outHeight).toBe(result.orientation>=5?120:result.height);expect(result.mismatches).toBe(0);expect(result.cleanOrientation).toBe(1);expect(result.metadata).toBe(false);for(let i=0;i<4;i++)for(let c=0;c<4;c++)expect(Math.abs(result.pixels[i][c]-COLORS[ORDER[result.orientation][i]][c])).toBeLessThanOrEqual(result.mime==='image/png'?0:3);}
});

test('normalization retains alpha, aspect and no-upscale while bounding a large decoded image',async({page})=>{
  const results=await page.evaluate(async()=>{
    const results=[];
    for(const [width,height]of [[4,2],[1600,1000]]){
      const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d')!;ctx.fillStyle='rgba(0,255,0,0.5)';ctx.fillRect(width/4,0,width/2,height);
      const blob=await canvas.convertToBlob({type:'image/png'}),asset=await window.imageHarness.normalizePhoto(new File([blob],'alpha.png',{type:'image/png'})),raster=await window.imageHarness.decodePhoto(asset);
      const middle=(Math.floor(raster.height/2)*raster.width+Math.floor(raster.width/2))*4;
      results.push({width:asset.width,height:asset.height,bytes:atob(asset.dataUrl.split(',')[1]).length,corner:Array.from(raster.rgba.slice(0,4)),center:Array.from(raster.rgba.slice(middle,middle+4))});
    }
    return results;
  });
  expect(results.map(x=>[x.width,x.height])).toEqual([[4,2],[1280,800]]);
  for(const result of results){expect(result.bytes).toBeLessThanOrEqual(7340032);expect(result.corner).toEqual([0,0,0,0]);expect(result.center).toEqual([0,255,0,128]);}
});

test('unsafe sources fail before native decode, corrupt compressed pixels fail actual restoration decode',async({page})=>{
  const result=await page.evaluate(async()=>{
    const canvas=new OffscreenCanvas(8,8);canvas.getContext('2d')!.fillRect(0,0,8,8);const blob=await canvas.convertToBlob({type:'image/png'}),raw=new Uint8Array(await blob.arrayBuffer());
    const actual=window.createImageBitmap.bind(window);let calls=0;window.createImageBitmap=(async(...args:Parameters<typeof createImageBitmap>)=>{calls++;return actual(...args);}) as typeof createImageBitmap;
    const errors=[];
    try{
      for(const file of [new File(['<svg/>'],'bad.svg',{type:'image/svg+xml'}),new File([raw],'bad.jpg',{type:'image/jpeg'}),new File([new Uint8Array(8388609)],'big.png',{type:'image/png'})])try{await window.imageHarness.normalizePhoto(file);}catch(error){errors.push(String(error));}
      const before=calls,asset=await window.imageHarness.normalizePhoto(new File([blob],'good.png',{type:'image/png'}));
      const corrupt=Uint8Array.from(atob(asset.dataUrl.split(',')[1]),c=>c.charCodeAt(0)),view=new DataView(corrupt.buffer);let offset=8;
      while(offset+12<=corrupt.length){const length=view.getUint32(offset),kind=String.fromCharCode(...corrupt.subarray(offset+4,offset+8));if(kind==='IDAT'){corrupt.fill(0,offset+8,offset+8+length);let crc=0xffffffff;for(const byte of corrupt.subarray(offset+4,offset+8+length)){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}view.setUint32(offset+8+length,(crc^0xffffffff)>>>0);break;}offset+=length+12;}
      let binary='';for(const byte of corrupt)binary+=String.fromCharCode(byte);const broken={...asset,dataUrl:'data:image/png;base64,'+btoa(binary)};
      try{await window.imageHarness.validateProjectImages(window.imageHarness.createProject(broken));}catch(error){errors.push(String(error));}
      return {before,calls,errors};
    }finally{window.createImageBitmap=actual;}
  });
  expect(result.before).toBe(0);expect(result.calls).toBe(2);expect(result.errors).toHaveLength(4);expect(result.errors[3]).toMatch(/decode|corrupt/i);
});

test('pre-abort avoids decode and late native completion closes the actual bitmap',async({page})=>{
  const result=await page.evaluate(async()=>{
    const canvas=new OffscreenCanvas(20,20);canvas.getContext('2d')!;const blob=await canvas.convertToBlob({type:'image/png'}),file=new File([blob],'original.png',{type:'image/png'});
    const actual=window.createImageBitmap.bind(window),pre=new AbortController();pre.abort();let calls=0,bitmap:ImageBitmap|undefined;
    window.createImageBitmap=(async(...args:Parameters<typeof createImageBitmap>)=>{calls++;return actual(...args);}) as typeof createImageBitmap;
    let preName='';try{await window.imageHarness.normalizePhoto(file,pre.signal);}catch(error){preName=(error as Error).name;}
    const preCalls=calls,late=new AbortController();window.createImageBitmap=(async(...args:Parameters<typeof createImageBitmap>)=>{bitmap=await actual(...args);late.abort();return bitmap;}) as typeof createImageBitmap;
    let lateName='';try{await window.imageHarness.normalizePhoto(file,late.signal);}catch(error){lateName=(error as Error).name;}finally{window.createImageBitmap=actual;}
    return {preName,preCalls,lateName,width:bitmap?.width};
  });
  expect(result.preName).toBe('AbortError');expect(result.preCalls).toBe(0);expect(result.lateName).toBe('AbortError');expect(result.width).toBe(0);
});

test('decodePhoto and project validation close real bitmaps on success and cancelled completion',async({page})=>{
  const result=await page.evaluate(async()=>{
    const canvas=new OffscreenCanvas(20,10);canvas.getContext('2d')!;const blob=await canvas.convertToBlob({type:'image/png'}),asset=await window.imageHarness.normalizePhoto(new File([blob],'original.png',{type:'image/png'}));
    const actual=window.createImageBitmap.bind(window),bitmaps:ImageBitmap[]=[];
    window.createImageBitmap=(async(...args:Parameters<typeof createImageBitmap>)=>{const bitmap=await actual(...args);bitmaps.push(bitmap);return bitmap;}) as typeof createImageBitmap;
    await window.imageHarness.decodePhoto(asset);await window.imageHarness.validateProjectImages(window.imageHarness.createProject(asset));
    const controller=new AbortController();window.createImageBitmap=(async(...args:Parameters<typeof createImageBitmap>)=>{const bitmap=await actual(...args);bitmaps.push(bitmap);controller.abort();return bitmap;}) as typeof createImageBitmap;
    let name='';try{await window.imageHarness.decodePhoto(asset,controller.signal);}catch(error){name=(error as Error).name;}finally{window.createImageBitmap=actual;}
    return {count:bitmaps.length,widths:bitmaps.map(x=>x.width),name};
  });
  expect(result.count).toBe(3);expect(result.widths).toEqual([0,0,0]);expect(result.name).toBe('AbortError');
});
