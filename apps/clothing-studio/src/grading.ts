import {validateConstruction,patternSvg,type SkirtDraft} from './construction.ts';
export interface Grading {waistStep:number;hemStep:number;slantStep:number;steps:number}
export const DEFAULT_GRADING:Grading={waistStep:4,hemStep:6,slantStep:0,steps:2};
export function validateGrading(value:unknown):Grading{
 if(typeof value!=='object'||value===null||Object.getPrototypeOf(value)!==Object.prototype)throw new Error('Grading must be a plain rule.');
 const keys=['waistStep','hemStep','slantStep','steps'];if(Reflect.ownKeys(value).length!==4||Reflect.ownKeys(value).some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k)!,'value')))throw new Error('Grading requires only waistStep, hemStep, slantStep and steps data fields.');
 const r=value as Grading;for(const k of ['waistStep','hemStep','slantStep'] as const)if(typeof r[k]!=='number'||!Number.isFinite(r[k])||Math.abs(r[k])>20)throw new Error('Grading increments must be finite from -20 to 20 cm.');
 if(!Number.isInteger(r.steps)||r.steps<1||r.steps>3)throw new Error('Choose 1–3 grading steps on each side of the base.');if(r.waistStep===0&&r.hemStep===0&&r.slantStep===0)throw new Error('At least one grading increment must change a measurement.');return {waistStep:r.waistStep,hemStep:r.hemStep,slantStep:r.slantStep,steps:r.steps};
}
export function gradedSizes(input:SkirtDraft,rule:Grading){const d=validateConstruction(input),r=validateGrading(rule);return Array.from({length:r.steps*2+1},(_,i)=>{const offset=i-r.steps;try{return {offset,draft:validateConstruction({kind:d.kind,waist:d.waist+offset*r.waistStep,hem:d.hem+offset*r.hemStep,slant:d.slant+offset*r.slantStep})};}catch(error){throw new Error(`Base ${offset>=0?'+':''}${offset}: ${error instanceof Error?error.message:'Invalid size.'}`);}});}
export function gradedPatternSvg(input:SkirtDraft,rule:Grading):string{
 const sizes=gradedSizes(input,rule);let y=0,width=0;
 const rows=sizes.map(({offset,draft},i)=>{const svg=patternSvg(draft),match=svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!;const w=Number(match[1]),h=Number(match[2]);width=Math.max(width,w+6);const nested=svg.replace('<svg ',`<svg x="3" y="${y+4}" `).replace(/(width|height)="([\d.]+)mm"/g,(_,attr,n)=>`${attr}="${Number(n)/10}"`).replace(/id="/g,`id="piece-${i}-`);const row=`<g id="size-${i}"><text x="3" y="${y+2}" font-family="sans-serif" font-size="1">Base ${offset>=0?'+':''}${offset} · waist ${draft.waist} cm · hem ${draft.hem} cm · slant ${draft.slant} cm</text>${nested}</g>`;y+=h+7;return row;}).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${width*10}mm" height="${y*10}mm" viewBox="0 0 ${width} ${y}" role="img" aria-label="Relative graded skirt pattern set"><title>Manual relative size grading, seam lines only</title>${rows}</svg>`;
}
