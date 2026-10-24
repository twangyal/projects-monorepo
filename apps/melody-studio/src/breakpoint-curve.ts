import {MAX_COMPOSITION_BEATS} from './limits.ts';
import type {VolumeCurve} from './types.ts';

export function validateCurve(value:unknown,kind:'Volume'|'Pan'|'Cutoff'):VolumeCurve {
  const minimum=kind==='Cutoff'?20:kind==='Pan'?-1:0, maximum=kind==='Cutoff'?10000:1;
  if(!Array.isArray(value)||value.length<1||value.length>64)throw new Error(`${kind} curve needs 1–64 ordered points.`);
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(value).length!==value.length+1)throw new Error(`${kind} curve must contain only its points.`);
  let previous=-1;
  return Array.from({length:value.length},(_,index)=>{
    const descriptor=descriptors[String(index)];
    if(!descriptor||!('value' in descriptor)||!descriptor.enumerable)throw new Error(`${kind} curve points must be dense data entries.`);
    const point=descriptor.value;
    if(!point||typeof point!=='object'||Array.isArray(point)||![Object.prototype,null].includes(Object.getPrototypeOf(point)))throw new Error(`${kind} curve point must be a plain object.`);
    const own=Object.getOwnPropertyDescriptors(point),keys=Reflect.ownKeys(own);
    if(keys.length!==2||keys.some(k=>k!=='beat'&&k!=='level'))throw new Error(`${kind} curve points need exactly beat and level.`);
    for(const key of ['beat','level'])if(!own[key]?.enumerable||!('value' in own[key])||typeof own[key].value!=='number'||!Number.isFinite(own[key].value))throw new Error(`${kind} curve values must be finite numeric data.`);
    const beat=own.beat.value as number,level=own.level.value as number;
    if(beat<0||beat>MAX_COMPOSITION_BEATS||beat<=previous||level<minimum||level>maximum)throw new Error(`${kind} curve beats must increase within 0–512 and levels must be ${minimum}–${maximum}.`);
    previous=beat;return{beat,level};
  });
}
function decimal(value:number):string {
  if(value<0)return '-'+decimal(-value);
  const raw=String(value);if(!raw.includes('e'))return raw;
  const [mantissa,power]=raw.split('e'),digits=mantissa.replace('.',''),position=(mantissa.includes('.')?mantissa.indexOf('.'):mantissa.length)+Number(power);
  return position<=0?'0.'+'0'.repeat(-position)+digits:position>=digits.length?digits+'0'.repeat(position-digits.length):digits.slice(0,position)+'.'+digits.slice(position);
}
// Add/subtract the UI's one-beat offset in decimal arithmetic before conversion
// to binary floating point. Number(raw)-1 would lose small/fractional beat bits.
function offsetDecimal(raw:string,offset:1|-1):string {
  const [whole,fraction='']=raw.split('.'),scale=10n**BigInt(fraction.length);
  const n=BigInt(whole||'0')*scale+BigInt(fraction||'0')+BigInt(offset)*scale,negative=n<0;
  const digits=(negative?-n:n).toString().padStart(fraction.length+1,'0');
  return(negative?'-':'')+(fraction.length?digits.slice(0,-fraction.length)+'.'+digits.slice(-fraction.length):digits);
}
export function formatCurve(value:VolumeCurve,kind:'Volume'|'Pan'|'Cutoff'):string {
  return validateCurve(value,kind).map(p=>`${offsetDecimal(decimal(p.beat),1)} ${decimal(p.level)}`).join('\n');
}
export function parseCurve(text:string,kind:'Volume'|'Pan'|'Cutoff'):VolumeCurve {
  const max=kind==='Pan'?65536:32768;
  if(typeof text!=='string'||text.length>max)throw new Error(`${kind} curve text must fit ${max.toLocaleString('en-US')} characters.`);
  const lines=text.split(/\r?\n/).filter(line=>line.trim());
  return validateCurve(lines.map(line=>{
    const values=line.trim().split(/\s+/);
    if(values.length!==2||! /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(values[0])||!(kind==='Pan'?/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/:/^(?:\d+(?:\.\d*)?|\.\d+)$/).test(values[1]))throw new Error('Enter one song beat and level per line, using decimal numbers.');
    return{beat:Number(offsetDecimal(values[0],-1)),level:Number(values[1])};
  }),kind);
}
/** Internal hot path: callers validate curves once before rendering. */
export function curveLevel(curve:Readonly<VolumeCurve>,beat:number):number {
  if(beat<=curve[0].beat)return curve[0].level;
  const last=curve[curve.length-1];if(beat>=last.beat)return last.level;
  let low=0,high=curve.length-1;
  while(high-low>1){const mid=(low+high)>>1;if(curve[mid].beat<=beat)low=mid;else high=mid;}
  const a=curve[low],b=curve[high];return a.level+(b.level-a.level)*((beat-a.beat)/(b.beat-a.beat));
}
export function shiftCurve(value:VolumeCurve,shift:number,kind:'Volume'|'Pan'|'Cutoff'):VolumeCurve {
  const curve=validateCurve(value,kind);
  if(!Number.isFinite(shift)||shift<0||shift>MAX_COMPOSITION_BEATS)throw new Error('Curve audition shift is invalid.');
  const later=curve.filter(p=>p.beat>shift).map(p=>({...p,beat:p.beat-shift}));
  return validateCurve(curve[0].beat>shift?later:[{beat:0,level:curveLevel(curve,shift)},...later],kind);
}
