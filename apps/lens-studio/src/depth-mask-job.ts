import {validateRaster} from './png.ts';
import {LIMITS,type Raster} from './types.ts';

/** Separate owned decode worker; cancellation also retires late native decoding. */
export function readMask(file:File,width:number,height:number,signal:AbortSignal):Promise<Raster>{
 if(signal.aborted)return Promise.reject(new DOMException('Mask import canceled.','AbortError'));
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.photoSide||height>LIMITS.photoSide||!(file instanceof Blob)||!file.size||file.size>LIMITS.pngBytes)return Promise.reject(new Error('Use a bounded PNG matching the source dimensions.'));
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./depth-mask.worker.ts',import.meta.url),{type:'module'});let settled=false;
  const timer=setTimeout(()=>finish(new Error('Mask import timed out.')),LIMITS.jobTimeoutMs);
  function finish(error:Error|null,raster?:Raster){if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);worker.removeEventListener('message',message);worker.removeEventListener('error',failure);worker.removeEventListener('messageerror',failure);worker.terminate();if(error)reject(error);else resolve(raster!);}
  function cancel(){finish(new DOMException('Mask import canceled.','AbortError'));}
  function failure(event:Event){event.preventDefault();finish(new Error('Mask could not be decoded.'));}
  function message(event:MessageEvent<unknown>){try{validateRaster(event.data);if(event.data.width!==width||event.data.height!==height)throw new Error('Wrong dimensions');finish(null,event.data);}catch{finish(new Error('Use a valid static 8-bit PNG with exactly the source dimensions.'));}}
  worker.addEventListener('message',message);worker.addEventListener('error',failure);worker.addEventListener('messageerror',failure);signal.addEventListener('abort',cancel,{once:true});
  try{worker.postMessage({file,width,height});}catch(error){finish(error instanceof Error?error:new Error('Mask worker could not start.'));}
 });
}
