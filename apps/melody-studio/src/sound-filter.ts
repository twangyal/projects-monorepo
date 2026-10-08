import type {SoundFilter} from './types.ts';

export const DEFAULT_FILTER: Readonly<SoundFilter> = Object.freeze({cutoff:8000,resonance:.707});
export function validateFilter(value:unknown):SoundFilter {
  if (!value || typeof value!=='object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw new Error('Sound filter must be a plain object.');
  const keys=Reflect.ownKeys(value);
  if(keys.length!==2 || keys.some(key=>key!=='cutoff'&&key!=='resonance')) throw new Error('Sound filter needs exactly cutoff and resonance.');
  const result={} as SoundFilter;
  for(const key of ['cutoff','resonance'] as const){
    const descriptor=Object.getOwnPropertyDescriptor(value,key),min=key==='cutoff'?20:.5,max=key==='cutoff'?10000:8;
    if(!descriptor||!('value'in descriptor)||typeof descriptor.value!=='number'||!Number.isFinite(descriptor.value)||descriptor.value<min||descriptor.value>max)throw new Error(`Filter ${key} must be a finite number from ${min} to ${max}.`);
    result[key]=descriptor.value;
  }
  return result;
}

/** W3C Audio EQ Cookbook bilinear low-pass, direct form II transposed; one state per voice. */
export function lowpass(settings:SoundFilter,sampleRate:number):(sample:number)=>number {
  const {cutoff,resonance}=validateFilter(settings);
  if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>192000)throw new Error('Filter sample rate must be from 8000 to 192000 Hz.');
  const omega=2*Math.PI*Math.min(cutoff,sampleRate*.45)/sampleRate,c=Math.cos(omega),alpha=Math.sin(omega)/(2*resonance),a0=1+alpha;
  const b0=(1-c)/(2*a0),b1=(1-c)/a0,b2=b0,a1=-2*c/a0,a2=(1-alpha)/a0;
  let first=0,second=0;
  return sample=>{const output=b0*sample+first;first=b1*sample-a1*output+second;second=b2*sample-a2*output;return output;};
}
