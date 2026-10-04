/* global Buffer */
// Independent maximum fixture; no application model, renderer or service imports.
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { parseGIF, decompressFrames } from 'gifuct-js';
export const MAX_BYTES=6291624;
function crc(bytes){let n=0xffffffff;for(const byte of bytes){n^=byte;for(let bit=0;bit<8;bit++)n=(n>>>1)^(n&1?0xedb88320:0);}return(n^0xffffffff)>>>0;}
function chunk(name,bytes){const kind=Buffer.from(name),data=Buffer.from(bytes),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);kind.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([kind,data])),out.length-4);return out;}
export function paddedOriginalPng(padding=0){const header=Buffer.alloc(13);header.writeUInt32BE(8);header.writeUInt32BE(8,4);header[8]=8;header[9]=6;const raw=Buffer.alloc(8*33);for(let y=0;y<8;y++)for(let x=0;x<8;x++)raw.set([255,255,0,255],y*33+1+x*4);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),...(padding?[chunk('paDd',Buffer.alloc(padding,63))]:[]),chunk('IEND',Buffer.alloc(0))]);}
const pose=(frame,x,y,scale=1)=>({frame,x,y,scale,rotation:0,opacity:1,easing:'linear'});
export function maximumProject(index=0){
 const p={schemaVersion:2,title:`Original maximum ${index}`,background:'#ffffff',frameCount:96,layers:[
  {id:'moving',name:'Original maximum held line',kind:'drawing',keys:[pose(0,200,180),pose(95,390,180)],cels:[{frame:0,strokes:[{color:'#ff0000',width:20,points:[{x:-40,y:0},{x:40,y:0}]}]},{frame:48,strokes:[{color:'#0000ff',width:20,points:[{x:-40,y:0},{x:40,y:0}]}]}]},
  {id:'dot',name:'Original green dot',kind:'drawing',keys:[pose(0,500,80)],cels:[{frame:0,strokes:[{color:'#00ff00',width:20,points:[{x:0,y:0}]}]}]},
  ...[0,1,2,3].map(i=>({id:`image-${i}`,name:`Padded original yellow ${i}`,kind:'image',keys:[pose(0,60,60,4)],image:{dataUrl:'',width:8,height:8}})),
 ]};
 const prefix='data:image/png;base64,',base=paddedOriginalPng().length,limit=1572864,rawMax=Math.floor((limit-prefix.length)/4)*3;
 const images=p.layers.filter(l=>l.kind==='image');for(const layer of images.slice(0,3))layer.image.dataUrl=prefix+paddedOriginalPng(rawMax-base-12).toString('base64');
 for(let extra=0;extra<4;extra++){
  p.title=`Original maximum ${index}`+'q'.repeat(extra);const emptyLength=Buffer.byteLength(JSON.stringify(p)),wanted=MAX_BYTES-emptyLength;
  if((wanted-prefix.length)%4)continue;
  const rawLength=(wanted-prefix.length)/4*3;images[3].image.dataUrl=prefix+paddedOriginalPng(rawLength-base-12).toString('base64');
  const bytes=Buffer.from(JSON.stringify(p));assert.equal(bytes.length,MAX_BYTES);for(const layer of images){assert(layer.image.dataUrl.length<=limit);const image=PNG.sync.read(Buffer.from(layer.image.dataUrl.split(',')[1],'base64'));assert.equal(image.width,8);assert.equal(image.height,8);assert.deepEqual([...image.data.subarray(0,4)],[255,255,0,255]);}return p;
 }
 throw Error('Could not construct exact bounded original fixture');
}
export function assertMaximumPixels(rgba,frame){for(const [x,y,color]of[[200+2*frame,180,frame<48?[255,0,0,255]:[0,0,255,255]],[500,80,[0,255,0,255]],[60,60,[255,255,0,255]],[600,330,[255,255,255,255]]])assert.deepEqual([...rgba.subarray((y*640+x)*4,(y*640+x)*4+4)],color,`frame${frame} point${x},${y}`);}
export function assertMaximumPng(bytes,frame){const image=PNG.sync.read(bytes);assert.deepEqual([image.width,image.height],[640,360]);assertMaximumPixels(image.data,frame);}
export function assertMaximumGif(bytes){const frames=decompressFrames(parseGIF(Uint8Array.from(bytes).buffer),true);assert.equal(frames.length,96);assert.deepEqual(frames.map(f=>f.delay),Array.from({length:96},(_,i)=>10*(Math.round((i+1)*100/12)-Math.round(i*100/12))));frames.forEach((f,i)=>{assert.deepEqual(f.dims,{left:0,top:0,width:640,height:360});assertMaximumPixels(f.patch,i);});return{frames:96,totalDelayMs:frames.reduce((n,f)=>n+f.delay,0)};}
