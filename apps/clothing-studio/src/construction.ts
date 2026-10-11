export interface SkirtDraft {kind:'flared-skirt';waist:number;hem:number;slant:number;allowances?:{seam:number;hem:number}}
export const DEFAULT_CONSTRUCTION:SkirtDraft={kind:'flared-skirt',waist:80,hem:140,slant:60};
export function validateConstruction(value:unknown):SkirtDraft {
 if(typeof value!=='object'||value===null||Object.getPrototypeOf(value)!==Object.prototype)throw new Error('Construction must be a plain measured skirt draft.');
 const keys=Reflect.ownKeys(value),expected=['kind','waist','hem','slant','allowances'];
 if(![4,5].includes(keys.length)||!['kind','waist','hem','slant'].every(k=>keys.includes(k))||keys.some(key=>typeof key!=='string'||!expected.includes(key)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)!,'value')))throw new Error('Construction requires kind, waist, hem and slant, with optional allowances data.');
 const v=value as Record<string,unknown>;
 if(v.kind!=='flared-skirt')throw new Error('Choose the flared-skirt construction.');
 for(const [key,min,max] of [['waist',50,150],['hem',70,300],['slant',20,120]] as const)if(typeof v[key]!=='number'||!Number.isFinite(v[key])||v[key]<min||v[key]>max)throw new Error(`${key} must be a finite number from ${min} to ${max} cm.`);
 const waist=v.waist as number,hem=v.hem as number,slant=v.slant as number;
 if(hem<waist+5)throw new Error('Hem circumference must exceed waist by at least 5 cm.');
 if((hem-waist)/(2*Math.PI)>=slant)throw new Error('Slant length must exceed the assembled radial increase. Increase length or reduce hem.');
 const result:SkirtDraft={kind:'flared-skirt',waist,hem,slant};
 if(keys.includes('allowances')){
  const a=v.allowances;if(typeof a!=='object'||a===null||Object.getPrototypeOf(a)!==Object.prototype)throw new Error('Allowances must be plain seam and hem settings.');
  const fields=Reflect.ownKeys(a);if(fields.length!==2||fields.some(k=>typeof k!=='string'||!['seam','hem'].includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(a,k)!,'value')))throw new Error('Allowances require only seam and hem data fields.');
  const values=a as Record<string,unknown>;for(const [key,max] of [['seam',2.5],['hem',5]] as const)if(typeof values[key]!=='number'||!Number.isFinite(values[key])||values[key]<0||values[key]>max)throw new Error(`${key} allowance must be finite from 0 to ${max} cm.`);
  result.allowances={seam:values.seam as number,hem:values.hem as number};
 }
 return result;
}
export function patternGeometry(input:SkirtDraft){
 const d=validateConstruction(input),innerRadius=d.slant*d.waist/(d.hem-d.waist),outerRadius=innerRadius+d.slant,angle=(d.hem-d.waist)/(2*d.slant);
 const half=angle/2,top=innerRadius*Math.cos(half),width=2*outerRadius*Math.sin(half),length=outerRadius-top;
 const radial=(d.hem-d.waist)/(2*Math.PI),height=Math.sqrt(d.slant**2-radial**2);
 return {innerRadius,outerRadius,angle,top,width,length,height};
}
/** Intersections of concentric cut arcs and outward parallel side lines, in cm. */
export function cutGeometry(input:SkirtDraft){
 const d=validateConstruction(input),g=patternGeometry(d),a=d.allowances?.seam??0,h=d.allowances?.hem??0;
 const innerRadius=g.innerRadius-a,outerRadius=g.outerRadius+h;
 if(innerRadius<=a)throw new Error('Seam allowance is too large for this waist arc.');
 const s=Math.sin(g.angle/2),c=Math.cos(g.angle/2);
 const corner=(r:number)=>{const t=Math.sqrt(r*r-a*a);return {x:t*s+a*c,y:t*c-a*s};};
 const waistRight=corner(innerRadius),hemRight=corner(outerRadius);
 const outerAngle=g.angle/2+Math.asin(a/outerRadius),innerAngle=g.angle/2+Math.asin(a/innerRadius);
 const width=2*(outerAngle>=Math.PI/2?outerRadius:hemRight.x),top=waistRight.y,length=outerRadius-top;
 return {innerRadius,outerRadius,waistRight,hemRight,innerAngle,outerAngle,width,top,length};
}
const n=(v:number)=>String(Math.round(v*1e6)/1e6);
/** Full-size centimetre geometry; SVG physical dimensions are millimetres. */
export function patternSvg(input:SkirtDraft):string {
 const d=validateConstruction(input),g=patternGeometry(d),cut=cutGeometry(d),s=Math.sin(g.angle/2),c=Math.cos(g.angle/2);
 const included=!!d.allowances&&(d.allowances.seam>0||d.allowances.hem>0),net=included?cut:g,width=2*net.width+9,height=net.length+14;
 const path=`M ${n(-g.innerRadius*s)} ${n(g.innerRadius*c)} A ${n(g.innerRadius)} ${n(g.innerRadius)} 0 0 0 ${n(g.innerRadius*s)} ${n(g.innerRadius*c)} L ${n(g.outerRadius*s)} ${n(g.outerRadius*c)} A ${n(g.outerRadius)} ${n(g.outerRadius)} 0 0 1 ${n(-g.outerRadius*s)} ${n(g.outerRadius*c)} Z`;
 const cutting=`M ${n(-cut.waistRight.x)} ${n(cut.waistRight.y)} A ${n(cut.innerRadius)} ${n(cut.innerRadius)} 0 ${cut.innerAngle>Math.PI/2?1:0} 0 ${n(cut.waistRight.x)} ${n(cut.waistRight.y)} L ${n(cut.hemRight.x)} ${n(cut.hemRight.y)} A ${n(cut.outerRadius)} ${n(cut.outerRadius)} 0 ${cut.outerAngle>Math.PI/2?1:0} 1 ${n(-cut.hemRight.x)} ${n(cut.hemRight.y)} Z`;
 const panel=(label:string,index:number)=>`<g id="panel-${label.toLowerCase()}" transform="translate(${n(3+net.width/2+index*(net.width+3))} ${n(5-net.top)})"><path id="stitch-${label.toLowerCase()}" d="${path}" fill="#faf7ef" stroke="#33473a" stroke-width="0.08"${included?' stroke-dasharray="0.4 0.3"':''}/>${included?`<path id="cut-${label.toLowerCase()}" d="${cutting}" fill="none" stroke="#a64812" stroke-width="0.1"/>`:''}<path d="M 0 ${n(g.innerRadius+2)} L 0 ${n(g.outerRadius-2)} m -0.5 -1 l 0.5 1 l 0.5 -1" fill="none" stroke="#66715e" stroke-width="0.08"/><text x="0" y="${n(g.innerRadius+g.length*.35)}" text-anchor="middle">${label} · cut 1</text><text x="0" y="${n(g.innerRadius+g.length*.35+1.2)}" text-anchor="middle">Grainline along centre</text></g>`;
 const allowance=included?`Seam/waist allowance ${n(d.allowances!.seam)} cm · hem allowance ${n(d.allowances!.hem)} cm · solid orange cut / dashed green stitch`:'No seam or hem allowance, waistband or closure';
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width*10)}mm" height="${n(height*10)}mm" viewBox="0 0 ${n(width)} ${n(height)}" role="img" aria-label="Measured two-panel skirt stitch and cutting pattern"><title>Measured flared-skirt pattern · centimetres</title><g font-family="sans-serif" font-size="0.75" fill="#33473a"><text x="3" y="1.5">Two matching panels · waist arc ${n(d.waist/2)} cm · hem arc ${n(d.hem/2)} cm each</text><text x="3" y="2.8">Join left/right side seams ${n(d.slant)} cm · ${allowance}</text>${panel('Front',0)}${panel('Back',1)}<rect x="3" y="${n(height-7)}" width="5" height="5" fill="none" stroke="#33473a" stroke-width="0.08"/><text x="9" y="${n(height-4)}">5 cm × 5 cm scale check · print at 100%, never fit to page</text><text x="3" y="${n(height-0.8)}">Construction study only · no waistband or closure · verify fit before cutting fabric</text></g></svg>`;
}
