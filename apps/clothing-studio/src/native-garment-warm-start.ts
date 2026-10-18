/** Research-only browser growth endpoint; never a new intrinsic rest state. */
import {teeMesh,validateProduct,type Product} from './product.ts';
import {buildCloth,simulateGarment,type TopBodyShape} from './garment-drape.ts';
import {captureNativeGarment} from './native-garment-snapshot.ts';
type Triangulator=Parameters<typeof captureNativeGarment>[3];

export function captureGarmentWarmStart(input:Product,chest:number,shape:TopBodyShape,triangulator:Triangulator){
 const product=validateProduct(input),source_packet=captureNativeGarment(product,chest,shape,triangulator);
 const meshes=teeMesh(product,triangulator),cloth=buildCloth(product,meshes);
 // Exactly the existing growth stage. Frame46 is requested only because the
 // production API admits >45 frames; its progress callback stops after45.
 const result=simulateGarment(product,meshes,chest,{bodyShape:shape,frames:46,substeps:10,progress:frame=>frame<45});
 const positions_m=new Array<number>(source_packet.positions_m.length).fill(NaN);
 for(const part of result.parts){
  const ids=cloth.vertices.get(part.part);
  if(!ids||ids.length*3!==part.positions.length)throw new Error('Warm-start particle correspondence changed.');
  for(let v=0;v<ids.length;v++)for(let axis=0;axis<3;axis++){
   const k=ids[v]!*3+axis,value=part.positions[v*3+axis]!/100;
   if(Number.isFinite(positions_m[k])&&positions_m[k]!==value)throw new Error('Warm-start seam members disagree.');
   positions_m[k]=value;
  }
 }
 if(!positions_m.every(Number.isFinite))throw new Error('Incomplete/nonfinite warm-start positions.');
 return {schema:'clothing-native-garment-warm-start-v1',source_packet,positions_m,
  preparation:{method:'existing-browser-body-growth-endpoint',frames:45,gravity_frames:0,substeps:10,velocity_handoff:'reset-to-zero-for-native-experiment'},
  metrics:result.metrics,scope:'Declared geometric preconditioning only; original rest/mass/body retained. Not settling, native contact admission or physical fit.'};
}
