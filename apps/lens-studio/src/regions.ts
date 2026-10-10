import {validateProject,decodeMask,encodeMask} from './model.ts';
import {LIMITS,type Project,type Plane,type Point} from './types.ts';
export type RegionTool='rectangle'|'polygon';
/** Source pixel centres; half-open bounds and even-odd polygon containment. */
export function assignRegion(project:Project,plane:Plane,tool:RegionTool,points:Point[]):Project{
 const current=validateProject(project),{width,height}=current.photo;
 if(![0,1,2].includes(plane)||!['rectangle','polygon'].includes(tool))throw new Error('Choose a supported region and depth plane.');
 if(!Array.isArray(points)||Object.getPrototypeOf(points)!==Array.prototype||points.length>(tool==='rectangle'?2:LIMITS.brushPoints)||points.length<(tool==='rectangle'?2:3)||Reflect.ownKeys(points).some(k=>k!=='length'&&(typeof k!=='string'||!/^(0|[1-9]\d*)$/.test(k)||Number(k)>=points.length)))throw new Error('Use two rectangle corners or 3–2048 polygon points.');
 const path:Point[]=[];
 for(let i=0;i<points.length;i++){const item=Object.getOwnPropertyDescriptor(points,String(i));if(!item||!('value' in item))throw new Error('Region points must be ordinary data.');const p=item.value;if(!p||typeof p!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(p))||Reflect.ownKeys(p).length!==2)throw new Error('Use source x/y points.');const x=Object.getOwnPropertyDescriptor(p,'x'),y=Object.getOwnPropertyDescriptor(p,'y');if(!x||!y||!('value' in x)||!('value' in y)||!Number.isFinite(x.value)||!Number.isFinite(y.value)||x.value<0||x.value>width||y.value<0||y.value>height)throw new Error('Region points must stay within the source photo.');path.push({x:x.value,y:y.value});}
 const outline=tool==='rectangle'?[path[0],{x:path[1].x,y:path[0].y},path[1],{x:path[0].x,y:path[1].y}]:path;
 let length=0;for(let i=0;i<outline.length;i++)length+=Math.hypot(outline[i].x-outline[(i+1)%outline.length].x,outline[i].y-outline[(i+1)%outline.length].y);if(length>LIMITS.brushLength)throw new Error('Region boundary exceeds 8192 source pixels. Use a simpler region.');
 const labels=decodeMask(current.depth),top=Math.max(0,Math.ceil(Math.min(...outline.map(p=>p.y))-.5)),bottom=Math.min(height,Math.ceil(Math.max(...outline.map(p=>p.y))-.5));
 // Canonical edge direction gives the same floating-point boundary when reversed.
 for(let y=top;y<bottom;y++){const row=y+.5,crossings:number[]=[];for(let i=0,j=outline.length-1;i<outline.length;j=i++){const a=outline[i],b=outline[j];if((a.y>row)!==(b.y>row)){const lower=a.y<b.y?a:b,upper=a.y<b.y?b:a;crossings.push(lower.x+(upper.x-lower.x)*(row-lower.y)/(upper.y-lower.y));}}crossings.sort((a,b)=>a-b);for(let i=0;i+1<crossings.length;i+=2){const left=Math.max(0,Math.ceil(crossings[i]-.5)),right=Math.min(width,Math.ceil(crossings[i+1]-.5));labels.fill(plane,y*width+left,y*width+right);}}
 current.depth=encodeMask(labels,width,height);return current;
}
