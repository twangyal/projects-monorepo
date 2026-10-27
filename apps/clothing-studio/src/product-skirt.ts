import { patternGeometry, validateConstruction, type SkirtDraft } from './construction.ts';
import type { Product, PatternPiece, PartMesh } from './product.ts';

/** Shared with the measured-skirt construction. No waistband or closure is implied. */
export interface SkirtMeasures { waist: number; hem: number; slant: number }
export function validateSkirtMeasures(value: unknown): SkirtMeasures {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== 3 || !['waist','hem','slant'].every(key => Object.hasOwn(value,key)
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)!, 'value'))) throw new Error('Skirt measurements require only waist, hem and slant.');
  const {waist,hem,slant}=validateConstruction({kind:'flared-skirt', ...value});
  return {waist,hem,slant};
}
export function skirtDraft(product: Product): SkirtDraft {
  if(product.base !== 'skirt') throw new Error('Choose a flared skirt.');
  return {kind:'flared-skirt',...validateSkirtMeasures(product.measurements)};
}
export function skirtHeight(product: Product): number { return patternGeometry(skirtDraft(product)).height; }

/** Circular arcs sampled closely enough for the common polygon pattern/export pipeline. */
export function skirtPieces(product: Product): PatternPiece[] {
  const g=patternGeometry(skirtDraft(product)), outline:{x:number;y:number}[]=[];
  const segments=96;
  for(const [radius,reverse] of [[g.innerRadius,false],[g.outerRadius,true]] as const){
    for(let i=0;i<=segments;i++){
      const t=(reverse?segments-i:i)/segments, a=-g.angle/2+g.angle*t;
      outline.push({x:g.width/2+radius*Math.sin(a),y:radius*Math.cos(a)-g.top});
    }
  }
  let area=0;
  for(let i=0;i<outline.length;i++){const a=outline[i],b=outline[(i+1)%outline.length];area+=a.x*b.y-b.x*a.y;}
  return (['front','back'] as const).map(part=>({part,outline:outline.map(p=>({...p})),width:g.width,height:g.length,areaCm2:Math.abs(area)/2,cutCount:1}));
}

/** Mesh grid per panel: 40 columns around, and rows about 1.5 times as long as a column is wide at the hem, so the
 * cloth simulation's triangles are not slivers. */
export function skirtGrid(product: Product): { columns: number; rows: number } {
  const d=skirtDraft(product),columns=40;
  return {columns,rows:Math.max(12,Math.min(40,Math.round(d.slant/(d.hem/2/columns)/1.5)))};
}

/** A rigid open frustum; seams, slant and UVs follow the same two annular-sector panels. */
export function skirtMesh(product: Product): PartMesh[] {
  const d=skirtDraft(product),g=patternGeometry(d),{columns,rows}=skirtGrid(product);
  return (['front','back'] as const).map((part,side)=>{
    const mesh:PartMesh={part,positions:[],uvs:[],indices:[]};
    for(let r=0;r<=rows;r++)for(let c=0;c<=columns;c++){
      const t=r/rows,u=c/columns,theta=-Math.PI/2+Math.PI*(u+side);
      const radius=(d.waist+(d.hem-d.waist)*t)/(2*Math.PI),flat=g.innerRadius+d.slant*t,angle=-g.angle/2+g.angle*u;
      mesh.positions.push(radius*Math.sin(theta),g.height*(1-t),radius*Math.cos(theta));
      mesh.uvs.push(g.width/2+flat*Math.sin(angle),flat*Math.cos(angle)-g.top);
      if(r<rows&&c<columns){const a=r*(columns+1)+c,b=a+1,e=a+columns+1,f=e+1;mesh.indices.push(a,e,b,b,e,f);}
    }
    return mesh;
  });
}
