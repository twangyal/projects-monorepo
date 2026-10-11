import {decodeMask,encodeMask,validateProject} from './model.ts';
import {encodePng,validateRaster} from './png.ts';
import type {Project,Raster} from './types.ts';

export const MASK_PALETTE=Object.freeze([
 Object.freeze([219,113,77]),Object.freeze([105,159,144]),Object.freeze([118,132,200]),
]);
export function maskRaster(project:Project):Raster{
 const safe=validateProject(project),labels=decodeMask(safe.depth),rgba=new Uint8ClampedArray(labels.length*4);
 for(let i=0;i<labels.length;i++)rgba.set([...MASK_PALETTE[labels[i]],255],i*4);
 return {width:safe.photo.width,height:safe.photo.height,rgba};
}
export function maskPng(project:Project):Uint8Array{return encodePng(maskRaster(project));}
export function reviewMask(project:Project,raster:Raster):{project:Project;counts:number[];changed:number}{
 const safe=validateProject(project);validateRaster(raster);
 if(raster.width!==safe.photo.width||raster.height!==safe.photo.height)throw new Error('Mask dimensions must match the normalized source photo exactly.');
 const labels=decodeMask(safe.depth),counts=[0,0,0];let changed=0;
 for(let i=0;i<labels.length;i++){
  const offset=i*4,label=MASK_PALETTE.findIndex(c=>c.every((v,j)=>v===raster.rgba[offset+j]));
  if(label<0||raster.rgba[offset+3]!==255)throw new Error('Every mask pixel must use an exact opaque near, subject or far palette color. Disable antialiasing and feathering.');
  counts[label]++;if(labels[i]!==label)changed++;labels[i]=label;
 }
 safe.depth=encodeMask(labels,raster.width,raster.height);return {project:safe,counts,changed};
}
