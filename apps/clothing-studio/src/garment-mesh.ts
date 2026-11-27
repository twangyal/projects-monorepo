import type {PartMesh} from './product.ts';

export type MeshQuality='standard'|'fine';
export function previewMeshQuality(value:unknown='standard'):MeshQuality {
  if(value==='standard'||value==='fine')return value;
  throw new Error('Choose Standard or Fine drape mesh quality.');
}
/** A transient preview budget, shared across all pieces of one garment. */
const MAX_VERTICES=150_000;
/** The original ring primitive's structural metric, independent of later vertex order.
 * Texture UVs use spatial distance; the structural neck follows its flat x/y outline. */
function modelledMetric(mesh:PartMesh,band:boolean):(a:number,b:number)=>number {
  const p=mesh.positions,spatial=(a:number,b:number)=>Math.hypot(p[a*3]!-p[b*3]!,p[a*3+1]!-p[b*3+1]!,p[a*3+2]!-p[b*3+2]!);
  if(!band)return spatial;
  const key=(v:number)=>[0,1,2].map(k=>Math.round(p[v*3+k]!*1000)).join(','),along=new Map<string,number>(),outer=new Set<string>();
  const flat=(a:number,b:number)=>Math.hypot(p[a*3]!-p[b*3]!,p[a*3+1]!-p[b*3+1]!);
  const count=p.length/3;let distance=0;
  for(let v=0;v+1<count;v+=2){if(v)distance+=flat(v-2,v);along.set(key(v),distance);along.set(key(v+1),distance);outer.add(key(v+1));}
  const total=distance+flat(count-2,0),width=spatial(0,1);
  return(a,b)=>{const ka=key(a),kb=key(b),u=Math.abs(along.get(ka)!-along.get(kb)!);return Math.hypot(Math.min(u,total-u),outer.has(ka)===outer.has(kb)?0:width);};
}
/** Split each indexed triangle into four. Pattern coordinates stay linear within the original
 * triangle; seam positions, printed UVs and directional grain therefore describe the same cuts. */
export function refineGarmentMeshes(meshes:readonly PartMesh[]):PartMesh[] {
  let vertices=0;
  const band=meshes.find(mesh=>(mesh.part==='neckband'||mesh.modelled)&&!mesh.restEdges);
  return meshes.map(mesh=>{
    const count=mesh.positions.length/3;
    if(!Number.isInteger(count)||mesh.uvs.length!==count*2||mesh.indices.length%3
      ||!mesh.positions.every(Number.isFinite)||!mesh.uvs.every(Number.isFinite)
      ||mesh.indices.some(i=>!Number.isInteger(i)||i<0||i>=count)
      ||mesh.layers&&mesh.layers.length!==count||mesh.grainMirrors&&mesh.grainMirrors.length!==mesh.indices.length/3
      ||mesh.restEdges&&(mesh.restEdges.length!==mesh.indices.length||mesh.restEdges.some(n=>!Number.isFinite(n)||n<0)))throw new Error('The pattern mesh cannot be refined.');
    vertices+=count;
    if(vertices>MAX_VERTICES)throw new Error('This pattern is too detailed for Fine mesh quality. Choose Standard.');
    const positions=[...mesh.positions],uvs=[...mesh.uvs],indices:number[]=[],midpoints=new Map<string,number>();
    const modelled=mesh.part==='neckband'||!!mesh.modelled,metric=modelled?modelledMetric(mesh,mesh===band):null;
    const restEdges=mesh.restEdges||modelled?[] as number[]:undefined;
    const layers=mesh.layers?[...mesh.layers]:undefined,grainMirrors=mesh.grainMirrors?[] as number[]:undefined;
    const key=(a:number,b:number)=>a<b?`${a},${b}`:`${b},${a}`;
    const midpoint=(a:number,b:number)=>{
      const edge=key(a,b),kept=midpoints.get(edge);if(kept!==undefined)return kept;
      if(++vertices>MAX_VERTICES)throw new Error('This pattern is too detailed for Fine mesh quality. Choose Standard.');
      const at=positions.length/3;
      for(let axis=0;axis<3;axis++)positions.push((mesh.positions[a*3+axis]!+mesh.positions[b*3+axis]!)/2);
      for(let axis=0;axis<2;axis++)uvs.push((mesh.uvs[a*2+axis]!+mesh.uvs[b*2+axis]!)/2);
      if(layers)layers.push((mesh.layers![a]!+mesh.layers![b]!)/2);
      midpoints.set(edge,at);return at;
    };
    for(let i=0;i<mesh.indices.length;i+=3){
      const a=mesh.indices[i]!,b=mesh.indices[i+1]!,c=mesh.indices[i+2]!,ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);
      indices.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca);
      if(restEdges){
        const x=(mesh.restEdges?.[i]??metric!(a,b))/2,y=(mesh.restEdges?.[i+1]??metric!(b,c))/2,z=(mesh.restEdges?.[i+2]??metric!(c,a))/2;
        restEdges.push(x,y,z,x,y,z,x,y,z,z,x,y);
      }
      if(grainMirrors){const grain=mesh.grainMirrors![i/3]!;grainMirrors.push(grain,grain,grain,grain);}
    }
    const creases=mesh.creases?[] as number[]:undefined;
    for(let i=0;i<(mesh.creases?.length??0);i+=2){
      const a=mesh.creases![i]!,b=mesh.creases![i+1]!,mid=midpoints.get(key(a,b));
      if(mid===undefined)creases!.push(a,b);else creases!.push(a,mid,mid,b);
    }
    const inside=mesh.inside?[...mesh.inside]:undefined;
    return {...mesh,positions,uvs,indices,...(layers?{layers}:{}),...(grainMirrors?{grainMirrors}:{}),...(creases?{creases}:{}),...(inside?{inside}:{}),...(restEdges?{restEdges}:{}),...(layers?{layerSurface:true}:{})};
  });
}
