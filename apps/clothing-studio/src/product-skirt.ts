import { patternGeometry, validateConstruction, type SkirtDraft } from './construction.ts';
import type { Product, PatternPiece, PartMesh } from './product.ts';

/**
 * Panel measurements; an optional folded band rises above the waist seam. No closure is modelled. `waist` is the
 * finished waist. With `gather`, the panels' waist edge is cut that many times longer and gathered into it.
 */
export interface SkirtMeasures { waist: number; hem: number; slant: number; waistbandHeight?: number; gather?: number }
/** Gather ratios: the panels' waist edge over the finished waist. */
export const GATHER: readonly [number, number] = [1.1, 2];
/** A gathered waist edge must be this much shorter than the hem, so the panels still flare. */
const GATHER_FLARE_CM = 10;
export function validateSkirtMeasures(value: unknown): SkirtMeasures {
  const band = !!value && typeof value === 'object' && Object.hasOwn(value, 'waistbandHeight');
  const gathered = !!value && typeof value === 'object' && Object.hasOwn(value, 'gather');
  const keys = ['waist','hem','slant', ...(band ? ['waistbandHeight'] : []), ...(gathered ? ['gather'] : [])];
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value,key)
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)!, 'value'))) throw new Error('Skirt measurements require waist, hem, slant and optionally waistband height.');
  const m = value as SkirtMeasures;
  const {waist,hem,slant}=validateConstruction({kind:'flared-skirt', waist:m.waist, hem:m.hem, slant:m.slant});
  if (band && (typeof m.waistbandHeight !== 'number' || !Number.isFinite(m.waistbandHeight) || m.waistbandHeight < 2 || m.waistbandHeight > 10)) throw new Error('Skirt waistband height must be from 2 to 10 cm, or 0 to remove it.');
  if (gathered) {
    if (typeof m.gather !== 'number' || !Number.isFinite(m.gather) || m.gather < GATHER[0] || m.gather > GATHER[1]) throw new Error(`Skirt gathering must be from ${GATHER[0]} to ${GATHER[1]} times the waist, or 1 for none.`);
    if (waist * m.gather > hem - GATHER_FLARE_CM) throw new Error(`A gathered waist edge (${Math.round(waist * m.gather * 10) / 10} cm) must be at least ${GATHER_FLARE_CM} cm shorter than the ${hem} cm hem. Widen the hem or gather less.`);
  }
  return {waist,hem,slant,...(band ? {waistbandHeight:m.waistbandHeight} : {}),...(gathered ? {gather:m.gather} : {})};
}
/** How many times longer the panels' waist edge is than the finished waist (1 when not gathered). */
export function skirtGather(product: Product): number { return (product.measurements as SkirtMeasures).gather ?? 1; }
/** The panels as cut: a gathered skirt's waist edge is longer than its finished waist. */
export function skirtPanelDraft(product: Product): SkirtDraft {
  const draft = skirtDraft(product);
  return { ...draft, waist: Math.round(draft.waist * skirtGather(product) * 100) / 100 };
}
export function skirtDraft(product: Product): SkirtDraft {
  if(product.base !== 'skirt') throw new Error('Choose a flared skirt.');
  const {waist,hem,slant}=validateSkirtMeasures(product.measurements);
  return {kind:'flared-skirt',waist,hem,slant};
}
export function skirtBandHeight(product: Product): number { return (product.measurements as SkirtMeasures).waistbandHeight ?? 0; }
export function skirtHeight(product: Product): number { return patternGeometry(skirtPanelDraft(product)).height + skirtBandHeight(product); }

/** Circular arcs sampled closely enough for the common polygon pattern/export pipeline. */
export function skirtPieces(product: Product): PatternPiece[] {
  const g=patternGeometry(skirtPanelDraft(product)), outline:{x:number;y:number}[]=[];
  const segments=96;
  for(const [radius,reverse] of [[g.innerRadius,false],[g.outerRadius,true]] as const){
    for(let i=0;i<=segments;i++){
      const t=(reverse?segments-i:i)/segments, a=-g.angle/2+g.angle*t;
      outline.push({x:g.width/2+radius*Math.sin(a),y:radius*Math.cos(a)-g.top});
    }
  }
  let area=0;
  for(let i=0;i<outline.length;i++){const a=outline[i],b=outline[(i+1)%outline.length];area+=a.x*b.y-b.x*a.y;}
  const pieces: PatternPiece[] = (['front','back'] as const).map(part=>({part,outline:outline.map(p=>({...p})),width:g.width,height:g.length,areaCm2:Math.abs(area)/2,cutCount:1}));
  const height=skirtBandHeight(product)*2, width=skirtDraft(product).waist;
  if(height) pieces.push({part:'waistband',outline:[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}],width,height,areaCm2:width*height,cutCount:1,foldLine:[{x:0,y:height/2},{x:width,y:height/2}]});
  return pieces;
}

/** Mesh grid per panel: 40 columns around, and rows about 1.5 times as long as a column is wide at the hem, so the
 * cloth simulation's triangles are not slivers. */
export function skirtGrid(product: Product): { columns: number; rows: number } {
  const d=skirtPanelDraft(product),columns=40;
  return {columns,rows:Math.max(12,Math.min(40,Math.round(d.slant/(d.hem/2/columns)/1.5)))};
}

/** A rigid open frustum; seams, slant and UVs follow the same two annular-sector panels. */
export function skirtMesh(product: Product): PartMesh[] {
  // A gathered skirt is cut from the wider panels but starts on its finished waist: the waist row is held there and
  // the extra fabric falls into gathers as it drapes.
  const d=skirtPanelDraft(product),finished=skirtDraft(product).waist,g=patternGeometry(d),{columns,rows}=skirtGrid(product);
  const meshes: PartMesh[] = (['front','back'] as const).map((part,side)=>{
    const mesh:PartMesh={part,positions:[],uvs:[],indices:[]};
    for(let r=0;r<=rows;r++)for(let c=0;c<=columns;c++){
      const t=r/rows,u=c/columns,theta=-Math.PI/2+Math.PI*(u+side);
      const radius=(finished+(d.hem-finished)*t)/(2*Math.PI),flat=g.innerRadius+d.slant*t,angle=-g.angle/2+g.angle*u;
      mesh.positions.push(radius*Math.sin(theta),g.height*(1-t),radius*Math.cos(theta));
      mesh.uvs.push(g.width/2+flat*Math.sin(angle),flat*Math.cos(angle)-g.top);
      if(r<rows&&c<columns){const a=r*(columns+1)+c,b=a+1,e=a+columns+1,f=e+1;mesh.indices.push(a,e,b,b,e,f);}
    }
    return mesh;
  });
  const height=skirtBandHeight(product);
  if(height){
    const band:PartMesh={part:'waistband',positions:[],uvs:[],indices:[]},around=columns*2,up=Math.ceil(height/1.5);
    // Same angular samples as the panels' waist, so every seam vertex is sewn by buildCloth.
    // Only the outer face is simulated; the cutting strip folds back inside to make the facing.
    for(let r=0;r<=up;r++)for(let c=0;c<=around;c++){
      const theta=-Math.PI/2+2*Math.PI*c/around,radius=finished/(2*Math.PI);
      band.positions.push(radius*Math.sin(theta),g.height+height*r/up,radius*Math.cos(theta));
      band.uvs.push(finished*c/around,height*(1-r/up));
      if(r<up&&c<around){const a=r*(around+1)+c,b=a+1,e=a+around+1,f=e+1;band.indices.push(a,b,e,b,f,e);}
    }
    meshes.push(band);
  }
  return meshes;
}
