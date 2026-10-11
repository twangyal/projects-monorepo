import {validateMaskPng} from './mask-png.ts';
import {LIMITS} from './types.ts';

self.addEventListener('message', async (event:MessageEvent<{file:Blob;width:number;height:number}>)=>{
 let bitmap:ImageBitmap|undefined,canvas:OffscreenCanvas|undefined;
 try{
  const {file,width,height}=event.data;
  if(!(file instanceof Blob)||file.size<1||file.size>LIMITS.pngBytes||file.type&&file.type!=='image/png')throw new Error('Choose a nonempty PNG mask of at most 7 MiB.');
  const bytes=new Uint8Array(await file.arrayBuffer());await validateMaskPng(bytes,width,height);
  bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}),{imageOrientation:'none',premultiplyAlpha:'none',colorSpaceConversion:'none'});
  if(bitmap.width!==width||bitmap.height!==height)throw new Error('Decoded mask dimensions differ from the source.');
  canvas=new OffscreenCanvas(width,height);const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Mask pixel decoding is unavailable.');
  ctx.drawImage(bitmap,0,0);const rgba=ctx.getImageData(0,0,width,height).data;
  self.postMessage({width,height,rgba},{transfer:[rgba.buffer]});
 }catch{self.postMessage({error:true});}
 finally{bitmap?.close();if(canvas)canvas.width=canvas.height=0;}
});
