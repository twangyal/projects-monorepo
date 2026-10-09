export interface SkirtDraft {kind:'flared-skirt';waist:number;hem:number;slant:number}
export const DEFAULT_CONSTRUCTION:SkirtDraft={kind:'flared-skirt',waist:80,hem:140,slant:60};
export function validateConstruction(value:unknown):SkirtDraft {
 if(typeof value!=='object'||value===null||Object.getPrototypeOf(value)!==Object.prototype)throw new Error('Construction must be a plain measured skirt draft.');
 const keys=Reflect.ownKeys(value),expected=['kind','waist','hem','slant'];
 if(keys.length!==4||keys.some(key=>typeof key!=='string'||!expected.includes(key)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)!,'value')))throw new Error('Construction must contain only kind, waist, hem and slant data fields.');
 const v=value as Record<string,unknown>;
 if(v.kind!=='flared-skirt')throw new Error('Choose the flared-skirt construction.');
 for(const [key,min,max] of [['waist',50,150],['hem',70,300],['slant',20,120]] as const)if(typeof v[key]!=='number'||!Number.isFinite(v[key])||v[key]<min||v[key]>max)throw new Error(`${key} must be a finite number from ${min} to ${max} cm.`);
 const waist=v.waist as number,hem=v.hem as number,slant=v.slant as number;
 if(hem<waist+5)throw new Error('Hem circumference must exceed waist by at least 5 cm.');
 if((hem-waist)/(2*Math.PI)>=slant)throw new Error('Slant length must exceed the assembled radial increase. Increase length or reduce hem.');
 return {kind:'flared-skirt',waist,hem,slant};
}
export function patternGeometry(input:SkirtDraft){
 const d=validateConstruction(input),innerRadius=d.slant*d.waist/(d.hem-d.waist),outerRadius=innerRadius+d.slant,angle=(d.hem-d.waist)/(2*d.slant);
 const half=angle/2,top=innerRadius*Math.cos(half),width=2*outerRadius*Math.sin(half),length=outerRadius-top;
 const radial=(d.hem-d.waist)/(2*Math.PI),height=Math.sqrt(d.slant**2-radial**2);
 return {innerRadius,outerRadius,angle,top,width,length,height};
}
const n=(v:number)=>String(Math.round(v*1e6)/1e6);
/** Full-size centimetre geometry; SVG physical dimensions are millimetres. */
export function patternSvg(input:SkirtDraft):string {
 const d=validateConstruction(input),g=patternGeometry(d),s=Math.sin(g.angle/2),c=Math.cos(g.angle/2),width=2*g.width+9,height=g.length+14;
 const path=`M ${n(-g.innerRadius*s)} ${n(g.innerRadius*c)} A ${n(g.innerRadius)} ${n(g.innerRadius)} 0 0 0 ${n(g.innerRadius*s)} ${n(g.innerRadius*c)} L ${n(g.outerRadius*s)} ${n(g.outerRadius*c)} A ${n(g.outerRadius)} ${n(g.outerRadius)} 0 0 1 ${n(-g.outerRadius*s)} ${n(g.outerRadius*c)} Z`;
 const panel=(label:string,index:number)=>`<g id="panel-${label.toLowerCase()}" transform="translate(${n(3+g.width/2+index*(g.width+3))} ${n(5-g.top)})"><path d="${path}" fill="#faf7ef" stroke="#33473a" stroke-width="0.08"/><path d="M 0 ${n(g.innerRadius+2)} L 0 ${n(g.outerRadius-2)} m -0.5 -1 l 0.5 1 l 0.5 -1" fill="none" stroke="#66715e" stroke-width="0.08"/><text x="0" y="${n(g.innerRadius+g.length*.35)}" text-anchor="middle">${label} · cut 1</text><text x="0" y="${n(g.innerRadius+g.length*.35+1.2)}" text-anchor="middle">Grainline along centre</text></g>`;
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width*10)}mm" height="${n(height*10)}mm" viewBox="0 0 ${n(width)} ${n(height)}" role="img" aria-label="Measured two-panel skirt seam-line pattern"><title>Measured flared-skirt pattern · centimetres</title><g font-family="sans-serif" font-size="0.75" fill="#33473a"><text x="3" y="1.5">Two matching panels · waist arc ${n(d.waist/2)} cm · hem arc ${n(d.hem/2)} cm each</text><text x="3" y="2.8">Join left/right side seams ${n(d.slant)} cm · No seam or hem allowance, waistband or closure</text>${panel('Front',0)}${panel('Back',1)}<rect x="3" y="${n(height-7)}" width="5" height="5" fill="none" stroke="#33473a" stroke-width="0.08"/><text x="9" y="${n(height-4)}">5 cm × 5 cm scale check · print at 100%, never fit to page</text><text x="3" y="${n(height-0.8)}">Construction study only · verify fit and add construction details before cutting fabric</text></g></svg>`;
}
