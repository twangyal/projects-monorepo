import {validateConstruction,patternGeometry,type SkirtDraft} from './construction.ts';
import {skirtMesh,type Vertex} from './construction-3d.ts';
export interface BodyMeasurements {waist:number;hip:number;hipDepth:number}
export const DEFAULT_BODY:BodyMeasurements={waist:80,hip:100,hipDepth:20};
export function validateBodyMeasurements(value:unknown):BodyMeasurements {
 if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)throw new Error('Body measurements must be a plain object.');
 const fields=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(fields);
 if(keys.length!==3||keys.some(k=>typeof k!=='string'||!['waist','hip','hipDepth'].includes(k)||!fields[k].enumerable||!('value' in fields[k])))throw new Error('Body measurements need exactly waist, hip and hipDepth numeric data.');
 for(const [key,min,max]of [['waist',50,180],['hip',50,220],['hipDepth',5,40]] as const){const v=fields[key].value;if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error(`Body ${key} must be finite from ${min} to ${max} cm.`);}
 return {waist:fields.waist.value,hip:fields.hip.value,hipDepth:fields.hipDepth.value};
}
/** Circular two-ring proxy only, without anatomy or cloth contact. +Y is downward. */
export function bodyMesh(input:BodyMeasurements){
 const b=validateBodyMeasurements(input),vertices:Vertex[]=[],faces:number[][]=[];
 for(const [circumference,y]of [[b.waist,0],[b.hip,b.hipDepth]])for(let i=0;i<32;i++){const a=i*2*Math.PI/32,r=circumference/(2*Math.PI);vertices.push({x:r*Math.cos(a),y,z:r*Math.sin(a)});}
 for(let i=0;i<32;i++){const j=(i+1)%32;faces.push([i,i+32,j+32,j]);}return{vertices,faces};
}
export function compareBody(input:SkirtDraft,body:BodyMeasurements){
 const d=validateConstruction(input),b=validateBodyMeasurements(body),height=patternGeometry(d).height;
 const garmentHip=b.hipDepth>height?null:d.waist+(d.hem-d.waist)*b.hipDepth/height;
 return{waistDifference:d.waist-b.waist,garmentHip,hipDifference:garmentHip===null?null:garmentHip-b.hip};
}
export function fittingSvg(input:SkirtDraft,body:BodyMeasurements,yaw:number,color:string,transparent:boolean):string {
 if(!Number.isFinite(yaw)||Math.abs(yaw)>360||!/^#[0-9a-fA-F]{6}$/.test(color)||typeof transparent!=='boolean')throw new Error('Body comparison view settings are invalid.');
 const d=validateConstruction(input),b=validateBodyMeasurements(body),garment=skirtMesh(d),proxy=bodyMesh(b),vertices=[...garment.vertices,...proxy.vertices],band=d.waistband?.height??0,bottom=Math.max(garment.height,b.hipDepth),scale=240/Math.max(Math.max(d.hem,b.waist,b.hip)/Math.PI,bottom+band),angle=yaw*Math.PI/180,tilt=20*Math.PI/180;
 const projected=vertices.map(v=>{const x=v.x*Math.cos(angle)-v.z*Math.sin(angle),z=v.x*Math.sin(angle)+v.z*Math.cos(angle),y=v.y-(bottom-band)/2;return{x:240+x*scale,y:180+(y*Math.cos(tilt)-z*Math.sin(tilt))*scale,depth:y*Math.sin(tilt)+z*Math.cos(tilt)};});
 const faces=[...garment.faces.map((indices,index)=>({indices,index,body:false})),...proxy.faces.map((indices,index)=>({indices:indices.map(i=>i+garment.vertices.length),index,body:true}))].map(f=>({...f,depth:f.indices.reduce((n,i)=>n+projected[i].depth,0)/4})).sort((a,b)=>a.depth-b.depth||Number(b.body)-Number(a.body)||a.index-b.index);
 const n=(v:number)=>String(Math.round(v*1e4)/1e4);
 const polygons=faces.map(f=>`<polygon ${f.body?'data-body-face':'data-fit-garment'}="${f.index}" points="${f.indices.map(i=>`${n(projected[i].x)},${n(projected[i].y)}`).join(' ')}" fill="${f.body?'#879bad':color}" fill-opacity="${f.body?'0.65':transparent?'0.35':'1'}" stroke="${f.body?'#364f66':'#fff9ef'}" stroke-width="0.5"/>`).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360" role="img" aria-label="Measurement proxy and rigid skirt at ${yaw} degrees"><title>Measurement proxy: circular lower-body rings, no anatomy, cloth or fit simulation</title>${polygons}</svg>`;
}
