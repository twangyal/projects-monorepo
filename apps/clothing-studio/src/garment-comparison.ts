import {material,partsOf,RIB_PARTS,type Product} from './product.ts';
import {garmentBody,bendingLength,GARMENT_FRAMES,GARMENT_SOLVER,GARMENT_SUBSTEPS,type GarmentDrapeResult} from './garment-drape.ts';
/** Every metric is a finite number, including where the garment ends on the body. */
const finiteMetrics=(metrics:GarmentDrapeResult['metrics'])=>Object.values(metrics).every(value=>typeof value==='object'?Object.values(value).every(Number.isFinite):Number.isFinite(value));
export interface ComparisonBody {chest:number;waist:number;hip:number;chestDepth?:number}
/** Comparison copies only; choosing one is a separate explicit project edit. */
export function fabricVariants(source:Product,materials:[string,string]):[Product,Product]{
 if(materials.length!==2||materials[0]===materials[1])throw new Error('Choose two different fabrics.');
 materials.forEach(id=>material(id));
 return materials.map(id=>{const candidate=structuredClone(source);for(const part of partsOf(candidate))if(!RIB_PARTS.has(part))candidate.parts[part].material=id;return candidate;}) as [Product,Product];
}
export function comparisonWarnings(result:GarmentDrapeResult):string[]{
 const m=result.metrics;
 return[...(m.maxStrain>1?['Excessive numerical stretch: enlarge the garment or reduce the body girths.']:[]),...(m.residualSpeed>10?['Still moving at the end of the solve; convergence is not established.']:[]),...(m.minClearance<.34?['Nominal body clearance was undershot; inspect contact carefully.']:[])];
}
/** Captures the existing worker's fixed default solve, not a calibrated fabric experiment. */
export function comparisonReceipt(source:Product,body:ComparisonBody,materials:[string,string],results:[GarmentDrapeResult,GarmentDrapeResult]){
 const products=fabricVariants(source,materials),shape=garmentBody(source,body.chest,body);
 if(results.length!==2||results.some(r=>r.body.chest!==shape.chest||r.body.waist!==shape.waist||r.body.hip!==shape.hip||r.body.chestDepth!==shape.chestDepth||!finiteMetrics(r.metrics)||r.parts.some(p=>!p.positions.every(Number.isFinite))))throw new Error('Comparison results must be finite and match the captured body.');
 return{schema:1,experiment:'matched-garment-fabrics-v1',solver:GARMENT_SOLVER,settings:{frames:GARMENT_FRAMES,substeps:GARMENT_SUBSTEPS,frameSeconds:1/60},units:{positions:'cm',speed:'cm/s',strain:'dimensionless edge extension',arealDensity:'g/m²'},body:{...body},source:structuredClone(source),assumptions:['Stretch (by direction to the grain) and bending from typical published values for each fabric construction (bending length shown per fabric); no measured specimen calibration.','Same pattern, body, mesh and solve settings; fabric replaced on non-rib parts only.','Rib trims, colors, prints, artwork and saved colorways retained. Pockets are carried offsets.','No cloth self/layer contact; body dimensions and contact are approximations.','Matched fixed front/back camera and lighting; garment-only snapshots. Differences do not validate physical fit.'],candidates:products.map((product,i)=>({material:{...material(materials[i]!)},bendingLengthCm:Math.round(bendingLength(material(materials[i]!))*100)/100,product,warnings:comparisonWarnings(results[i]!),result:{...structuredClone(results[i]!),parts:results[i]!.parts.map(p=>({part:p.part,positions:Array.from(p.positions)}))}}))};
}
export type GarmentComparisonReceipt=ReturnType<typeof comparisonReceipt>;
