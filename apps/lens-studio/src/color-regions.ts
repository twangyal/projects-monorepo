import {decodeMask,encodeMask,validateProject} from './model.ts';
import {validateRaster} from './png.ts';
import type {Plane,Point,Project,Raster} from './types.ts';

export interface ColorRegion { project: Project; selection: Uint8Array }

/** Four-connected membership against one fixed RGBA seed, never neighbor drift. */
export function prepareColorRegion(project:Project,source:Raster,plane:Plane,seed:Point,tolerance:number):ColorRegion {
  const current=validateProject(project);
  validateRaster(source);
  if(source.width!==current.photo.width||source.height!==current.photo.height)throw new Error('Color selection needs the current source photo.');
  if(![0,1,2].includes(plane)||!Number.isInteger(tolerance)||tolerance<0||tolerance>255)throw new Error('Choose a depth plane and whole color tolerance from 0 through 255.');
  if(!seed||typeof seed!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(seed))||Reflect.ownKeys(seed).length!==2)throw new Error('Choose a source pixel.');
  const x=Object.getOwnPropertyDescriptor(seed,'x'),y=Object.getOwnPropertyDescriptor(seed,'y');
  if(!x||!y||!('value' in x)||!('value' in y)||!Number.isInteger(x.value)||!Number.isInteger(y.value)||x.value<0||x.value>=source.width||y.value<0||y.value>=source.height)throw new Error('Choose a source pixel within the photo.');
  const {width,height,rgba}=source,count=width*height,offset=(y.value*width+x.value)*4;
  const color=[rgba[offset],rgba[offset+1],rgba[offset+2],rgba[offset+3]];
  const visited=new Uint8Array(count),selection=new Uint8Array(count),queue=new Uint32Array(count);
  let head=0,tail=0;
  const enqueue=(pixel:number)=>{if(!visited[pixel]){visited[pixel]=1;queue[tail++]=pixel;}};
  enqueue(y.value*width+x.value);
  while(head<tail){
    const pixel=queue[head++],at=pixel*4;
    if(color.some((channel,i)=>Math.abs(rgba[at+i]-channel)>tolerance))continue;
    selection[pixel]=1;
    if(pixel%width)enqueue(pixel-1);
    if(pixel%width<width-1)enqueue(pixel+1);
    if(pixel>=width)enqueue(pixel-width);
    if(pixel<count-width)enqueue(pixel+width);
  }
  const labels=decodeMask(current.depth);
  for(let i=0;i<count;i++)if(selection[i])labels[i]=plane;
  current.depth=encodeMask(labels,width,height);
  return {project:current,selection};
}
