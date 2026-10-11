import {inspectPhotoHeader} from './photo-header.ts';
import {LIMITS} from './types.ts';

/** Validate chunks, precision and the complete zlib stream before native pixels. */
export async function validateMaskPng(bytes:Uint8Array,width:number,height:number):Promise<void>{
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.photoSide||height>LIMITS.photoSide)throw new Error('Use supported mask dimensions.');
 if(bytes.byteLength>LIMITS.pngBytes)throw new Error('Mask exceeds 7 MiB.');
 const header=inspectPhotoHeader(bytes);
 if(header.format!=='png'||header.orientation!==1||header.width!==width||header.height!==height)throw new Error('Use an unrotated PNG with exactly the normalized photo dimensions.');
 const bits=bytes[24],color=bytes[25],interlace=bytes[28],channels=({0:1,2:3,3:1,4:2,6:4} as Record<number,number>)[color];
 if(bits!==8)throw new Error('Use an 8-bit PNG mask; higher precision and conversion are unsupported.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),parts:Uint8Array<ArrayBuffer>[]= [];
 let offset=8,seenData=false,endedData=false,palette=false,paletteSize=0,transparency=false;
 while(offset<bytes.length){
  const size=view.getUint32(offset),kind=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
  if(kind==='IDAT'){if(endedData||color===3&&!palette)throw new Error('Invalid PNG image-data order.');seenData=true;parts.push(bytes.slice(offset+8,offset+8+size));}
  else{
   if(seenData)endedData=true;
   if(kind==='PLTE'){if(palette||seenData||!size||size%3||size>768||color===0||color===4)throw new Error('Invalid PNG palette order or size.');palette=true;paletteSize=size/3;}
   else if(kind==='tRNS'){if(transparency||seenData||color===3&&(!palette||!size||size>paletteSize)||color===0&&size!==2||color===2&&size!==6||![0,2,3].includes(color))throw new Error('Invalid PNG transparency order or size.');transparency=true;}
   else if(/^[A-Z]/.test(kind)&&!['IHDR','IEND'].includes(kind))throw new Error('Unsupported critical PNG chunk.');
  }
  offset+=size+12;
 }
 // Expected filtered rows, including all seven Adam7 passes where present.
 const passes=interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
 const rows:number[]=[];let expected=0;
 for(const [x,y,dx,dy] of passes){const w=Math.max(0,Math.ceil((width-x)/dx)),h=Math.max(0,Math.ceil((height-y)/dy));if(!w||!h)continue;const stride=w*channels+1;for(let i=0;i<h;i++)rows.push(stride);expected+=stride*h;}
 const reader=new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
 const raw=new Uint8Array(expected);let written=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;if(value.length>expected-written)throw new Error('PNG decoded data exceeds its exact dimensions.');raw.set(value,written);written+=value.length;}if(written!==expected)throw new Error('PNG compressed data does not match its dimensions.');let start=0;for(const stride of rows){if(raw[start]>4)throw new Error('Invalid PNG row filter.');start+=stride;}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
