import {validateFilterCurve} from './filter-curve.ts';
import {curveLevel} from './breakpoint-curve.ts';
import type {SoundFilter} from './types.ts';

export const DEFAULT_FILTER: Readonly<SoundFilter> = Object.freeze({cutoff:8000,resonance:.707});
export function validateFilter(value:unknown):SoundFilter {
  if (!value || typeof value!=='object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw new Error('Sound filter must be a plain object.');
  const keys=Reflect.ownKeys(value);
  if(!keys.includes('cutoff')||!keys.includes('resonance')||keys.some(key=>key!=='cutoff'&&key!=='resonance'&&key!=='curve')) throw new Error('Sound filter needs cutoff, resonance and an optional curve.');
  const result={} as SoundFilter;
  for(const key of ['cutoff','resonance'] as const){
    const descriptor=Object.getOwnPropertyDescriptor(value,key),min=key==='cutoff'?20:.5,max=key==='cutoff'?10000:8;
    if(!descriptor||!('value'in descriptor)||typeof descriptor.value!=='number'||!Number.isFinite(descriptor.value)||descriptor.value<min||descriptor.value>max)throw new Error(`Filter ${key} must be a finite number from ${min} to ${max}.`);
    result[key]=descriptor.value;
  }
  const curve=Object.getOwnPropertyDescriptor(value,'curve');
  if(curve){if(!curve.enumerable||!('value' in curve))throw new Error('Filter curve must be an enumerable data field.');result.curve=validateFilterCurve(curve.value);}
  return result;
}

/** Static voices retain the original Cookbook DF-II path exactly. Changing
 * cutoff uses trapezoidal state-variable integrators whose state is independent
 * of the current cutoff coefficients. Both realize the same static low-pass. */
export function lowpass(settings:SoundFilter,sampleRate:number,startBeat=0,secondsPerBeat=1):(sample:number)=>number {
 const {cutoff,resonance,curve}=validateFilter(settings);
 if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>192000)throw new Error('Filter sample rate must be from 8000 to 192000 Hz.');
 if(!Number.isFinite(startBeat)||startBeat<0||!Number.isFinite(secondsPerBeat)||secondsPerBeat<=0)throw new Error('Filter voice clock is invalid.');
 const cap=(hz:number)=>Math.min(hz,sampleRate*.45);
 if(curve?.some(point=>cap(point.level)!==cap(curve[0].level))){
  let state1=0,state2=0,frame=0,previous=-1,a1=0,a2=0,a3=0;
  return sample=>{
   const hz=cap(curveLevel(curve,startBeat+frame++/(sampleRate*secondsPerBeat)));
   if(hz!==previous){previous=hz;const g=Math.tan(Math.PI*hz/sampleRate);a1=1/(1+g*(g+1/resonance));a2=g*a1;a3=g*a2;}
   const residual=sample-state2,band=a1*state1+a2*residual,output=state2+a2*state1+a3*residual;
   state1=2*band-state1;state2=2*output-state2;return output;
  };
 }
 const omega=2*Math.PI*cap(curve?curve[0].level:cutoff)/sampleRate,c=Math.cos(omega),alpha=Math.sin(omega)/(2*resonance),a0=1+alpha;
 const b0=(1-c)/(2*a0),b1=(1-c)/a0,b2=b0,a1=-2*c/a0,a2=(1-alpha)/a0;
 let first=0,second=0;
 return sample=>{const output=b0*sample+first;first=b1*sample-a1*output+second;second=b2*sample-a2*output;return output;};
}
