import { LIMITS } from './types.ts';
import type { PngHeader, Raster } from './types.ts';
import { validateRaster } from './model.ts';

const SIGNATURE=new Uint8Array([137,80,78,71,13,10,26,10]);
const CRC_TABLE=new Uint32Array(256);
for(let n=0;n<256;n++) { let c=n; for(let k=0;k<8;k++) c=(c>>>1)^((c&1)?0xedb88320:0); CRC_TABLE[n]=c>>>0; }
function crc(bytes:Uint8Array):number {
  let c=0xffffffff; for(const b of bytes) c=(c>>>8)^CRC_TABLE[(c^b)&255]; return (c^0xffffffff)>>>0;
}
const fail=():never=>{ throw new Error('Unsupported or invalid PNG. Convert to noninterlaced 8-bit RGB/RGBA PNG.'); };
export function inspectPng(bytes:Uint8Array):PngHeader {
  if(!(bytes instanceof Uint8Array) || bytes.length<8 || bytes.length>LIMITS.sourceBytes
      || SIGNATURE.some((b,i)=>b!==bytes[i])) return fail();
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let at=8, ancillary=0, idatBytes=0; let header:PngHeader|null=null;
  let startedIdat=false, endedIdat=false;
  while(at<bytes.length) {
    if(bytes.length-at<12) return fail();
    const length=view.getUint32(at); if(length>bytes.length-at-12) return fail();
    const type=String.fromCharCode(...bytes.subarray(at+4,at+8));
    if(!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) return fail();
    if(crc(bytes.subarray(at+4,at+8+length))!==view.getUint32(at+8+length)) return fail();
    if(!header && type!=='IHDR') return fail();
    if(type==='IHDR') {
      if(header || at!==8 || length!==13) return fail();
      const width=view.getUint32(at+8),height=view.getUint32(at+12),colorType=bytes[at+17];
      if(width<1 || height<1 || width>LIMITS.sourceSide || height>LIMITS.sourceSide || width*height>LIMITS.sourcePixels
          || bytes[at+16]!==8 || (colorType!==2 && colorType!==6) || bytes[at+18]!==0 || bytes[at+19]!==0 || bytes[at+20]!==0) return fail();
      header={width,height,colorType};
    } else if(type==='IDAT') {
      if(endedIdat) return fail(); startedIdat=true; idatBytes+=length;
    } else if(type==='IEND') {
      if(length!==0 || idatBytes===0 || at+12!==bytes.length || !header) return fail();
      return header;
    } else {
      if(startedIdat) endedIdat=true;
      if(type==='acTL' || type==='fcTL' || type==='fdAT' || type==='eXIf' || type[0]===type[0].toUpperCase()) return fail();
      ancillary+=length+12; if(ancillary>LIMITS.ancillaryBytes) return fail();
    }
    at+=length+12;
  }
  return fail();
}
function chunk(type:string,data:Uint8Array):Uint8Array {
  const output=new Uint8Array(data.length+12); const view=new DataView(output.buffer);
  view.setUint32(0,data.length); for(let i=0;i<4;i++) output[4+i]=type.charCodeAt(i);
  output.set(data,8); view.setUint32(data.length+8,crc(output.subarray(4,data.length+8))); return output;
}
function concatenate(parts:Uint8Array[]):Uint8Array {
  const size=parts.reduce((sum,p)=>sum+p.length,0);
  if(size>LIMITS.pngBytes) throw new Error('PNG exceeds output limit');
  const output=new Uint8Array(size); let at=0; for(const p of parts) { output.set(p,at); at+=p.length; } return output;
}
// RFC1950 zlib container, RFC1951 stored (uncompressed) DEFLATE blocks. This
// avoids Canvas encoders which may discard invisible RGB through premultiplication.
function storedZlib(raw:Uint8Array):Uint8Array {
  const blocks=Math.ceil(raw.length/65535); const output=new Uint8Array(2+raw.length+blocks*5+4);
  output[0]=0x78; output[1]=0x01; let at=2;
  for(let start=0;start<raw.length;start+=65535) {
    const length=Math.min(65535,raw.length-start); const inverse=(~length)&65535;
    output[at++]=start+length===raw.length ? 1 : 0;
    output[at++]=length&255; output[at++]=length>>>8;
    output[at++]=inverse&255; output[at++]=inverse>>>8;
    output.set(raw.subarray(start,start+length),at); at+=length;
  }
  let a=1,b=0; for(const byte of raw) { a=(a+byte)%65521; b=(b+a)%65521; }
  new DataView(output.buffer).setUint32(at,((b<<16)|a)>>>0); return output;
}
export function encodePng(raster:Raster):Uint8Array {
  const r=validateRaster(raster); const rowBytes=r.width*4;
  const raw=new Uint8Array((rowBytes+1)*r.height);
  for(let y=0;y<r.height;y++) raw.set(r.rgba.subarray(y*rowBytes,(y+1)*rowBytes),y*(rowBytes+1)+1);
  const ihdr=new Uint8Array(13); const view=new DataView(ihdr.buffer);
  view.setUint32(0,r.width); view.setUint32(4,r.height); ihdr[8]=8; ihdr[9]=6;
  return concatenate([SIGNATURE,chunk('IHDR',ihdr),chunk('sRGB',new Uint8Array([0])),chunk('IDAT',storedZlib(raw)),chunk('IEND',new Uint8Array())]);
}
