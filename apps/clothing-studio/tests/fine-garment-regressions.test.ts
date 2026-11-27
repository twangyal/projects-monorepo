import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import {teeMesh,template} from '../src/product.ts';
import {buildCloth,defaultBodyChest,simulateGarment,type Cloth} from '../src/garment-drape.ts';
import type {SkirtMeasures} from '../src/product-skirt.ts';
const edge=(a:number,b:number)=>a<b?`${a},${b}`:`${b},${a}`;
const point=(p:readonly number[],i:number)=>[0,1,2].map(k=>Math.round(p[i*3+k]!*1e7)).join(',');
function lengths(cloth:Cloth){const out=new Map<string,number>();for(let i=0;i<cloth.rest.length;i++)if(cloth.structural[i])out.set(edge(cloth.a[i]!,cloth.b[i]!),cloth.rest[i]!);return out;}
for(const name of ['ringer','bomber'])test(`${name}: subdivided closed/open band edges keep the original structural length`,()=>{
 const product=template(name),coarse=teeMesh(product,Delaunator),fine=teeMesh(product,Delaunator,'fine'),a=buildCloth(product,coarse),b=buildCloth(product,fine),before=lengths(a),after=lengths(b);
 const band=coarse.find(m=>m.part==='neckband'||m.modelled)!,refined=fine.find(m=>m.part===band.part)!,ai=a.vertices.get(band.part)!,bi=b.vertices.get(band.part)!;
 const at=new Map(Array.from({length:refined.positions.length/3},(_,i)=>[point(refined.positions,i),i] as const)),seen=new Set<string>();let checked=0;
 for(let i=0;i<band.indices.length;i+=3)for(let k=0;k<3;k++){
  const x=band.indices[i+k]!,y=band.indices[i+(k+1)%3]!,key=edge(x,y);if(seen.has(key))continue;seen.add(key);
  const original=before.get(edge(ai[x]!,ai[y]!));if(original===undefined||original<.01)continue;
  const middle=[0,1,2].map(axis=>(band.positions[x*3+axis]!+band.positions[y*3+axis]!)/2),m=at.get(point(middle,0))!;
  if(bi[x]===bi[m]||bi[y]===bi[m])continue;
  const left=after.get(edge(bi[x]!,bi[m]!)),right=after.get(edge(bi[m]!,bi[y]!));assert.ok(left!==undefined&&right!==undefined);
  assert.ok(Math.abs(left+right-original)<2e-4,`${band.part} ${x}–${y}: ${left}+${right} instead of ${original}`);checked++;
 }
 assert.ok(checked>100);
});

// Independently intersect a horizontal slice of each visible triangle, then its 2D segment with the radial ray.
function outerRadius(points:Float32Array,triangles:number[],x:number,y:number,z:number):number {
 const radius=Math.hypot(x,z),dx=x/radius,dz=z/radius;let outer=0;
 for(let i=0;i<triangles.length;i+=3){
  const cuts:{x:number;z:number}[]=[];
  for(let k=0;k<3;k++){
   const a=triangles[i+k]!*3,b=triangles[i+(k+1)%3]!*3,ay=points[a+1]!,by=points[b+1]!;
   if(Math.abs(by-ay)<1e-9||(y-ay)*(y-by)>1e-8)continue;
   const t=(y-ay)/(by-ay);cuts.push({x:points[a]!+t*(points[b]!-points[a]!),z:points[a+2]!+t*(points[b+2]!-points[a+2]!)});
  }
  if(cuts.length<2)continue;
  const a=cuts[0]!,b=cuts.find(p=>Math.hypot(p.x-a.x,p.z-a.z)>1e-8);if(!b)continue;
  const vx=b.x-a.x,vz=b.z-a.z,det=dz*vx-dx*vz;if(Math.abs(det)<1e-10)continue;
  const r=(-a.x*vz+a.z*vx)/det,u=(dx*a.z-dz*a.x)/det;if(r>0&&u>=-1e-7&&u<=1+1e-7)outer=Math.max(outer,r);
 }
 return outer;
}
for(const style of ['knife','box'] as const){
 test(`${style}: every fine underlay particle participates in actual face ordering despite crease aliases`,()=>{
  const product=template('pleated-skirt');(product.measurements as SkirtMeasures).pleats!.style=style;
  const meshes=teeMesh(product,Delaunator,'fine'),cloth=buildCloth(product,meshes);
  const surface=(cloth as Cloth&{layerSurface?:{inner:Int32Array}}).layerSurface;assert.ok(surface,'fine pleats need actual outer-face constraints');
  const covered=new Set(surface.inner);let checked=0;
  for(const mesh of meshes){if(!mesh.layers)continue;const ids=cloth.vertices.get(mesh.part)!;for(let i=0;i<mesh.layers.length;i++)if(mesh.layers[i]!>0){assert.ok(covered.has(ids[i]!),`${mesh.part} ${i} has no face constraint`);checked++;}}
  assert.ok(checked>1000);
 });
 test(`${style}: settled fine underlays stay inside the actual visible skirt faces`,()=>{
  const product=template('pleated-skirt');(product.measurements as SkirtMeasures).pleats!.style=style;
  const meshes=teeMesh(product,Delaunator,'fine'),result=simulateGarment(product,meshes,defaultBodyChest(product),{substeps:48});
  const mesh=meshes.find(m=>m.part==='front')!,positions=result.parts.find(m=>m.part==='front')!.positions;assert.ok(positions.every(Number.isFinite));
  const bands=new Map<number,number[]>();
  for(let i=0;i<mesh.indices.length;i+=3){const ids=mesh.indices.slice(i,i+3);if(ids.some(v=>mesh.layers![v]!==0))continue;const ys=ids.map(v=>positions[v*3+1]!);for(let band=Math.floor(Math.min(...ys));band<=Math.floor(Math.max(...ys));band++){const list=bands.get(band)??[];list.push(...ids);bands.set(band,list);}}
  let covered=0,worst=0;
  for(let i=0;i<mesh.layers!.length;i++)if(mesh.layers![i]!>0){const x=positions[i*3]!,y=positions[i*3+1]!,z=positions[i*3+2]!,outer=outerRadius(positions,bands.get(Math.floor(y))??[],x,y,z);if(outer>0){covered++;worst=Math.max(worst,Math.hypot(x,z)-outer);}}
  assert.ok(covered>500,`only ${covered} underlays have visible covering faces`);assert.ok(worst<=.02,`underlay protrudes ${worst} cm through visible cloth`);
 });
}
