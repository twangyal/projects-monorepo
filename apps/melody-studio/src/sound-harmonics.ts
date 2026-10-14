export const DEFAULT_HARMONICS:readonly number[]=Object.freeze([1,.5,0,.25,0,0,0,0]);
export function validateHarmonics(value:unknown):number[]{
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)throw new Error('Harmonics must be an array of eight amplitudes.');
 const fields=Object.getOwnPropertyDescriptors(value) as unknown as Record<string,PropertyDescriptor>,keys=Reflect.ownKeys(fields);
 if(fields.length.value!==8||keys.length!==9||keys.some(k=>k!=='length'&&(typeof k!=='string'||! /^[0-7]$/.test(k))))throw new Error('Harmonics need exactly eight amplitudes.');
 const result=Array.from({length:8},(_,i)=>{const d=fields[String(i)];if(!d||!d.enumerable||!('value'in d)||typeof d.value!=='number'||!Number.isFinite(d.value)||d.value<0||d.value>1)throw new Error('Each harmonic amplitude must be finite from 0 to 1.');return d.value as number;});
 if(!result.some(v=>v>0))throw new Error('At least one harmonic amplitude must be positive.');return result;
}
/** Zero-phase sine partials, normalized by the configured total, not the retained total. */
export function harmonicTable(input:readonly number[],hz:number,rate:number,size:number):Float64Array{
 const amplitudes=validateHarmonics(input);
 if(!Number.isFinite(hz)||hz<=0||!Number.isFinite(rate)||rate<8000||rate>192000||!Number.isInteger(size)||size<256||size>16384)throw new Error('Invalid harmonic oscillator settings.');
 const total=amplitudes.reduce((sum,a)=>sum+a,0),table=new Float64Array(size+1);
 for(let k=1;k<=8;k++)if(amplitudes[k-1]>0&&k*hz<rate/2)for(let i=0;i<=size;i++)table[i]+=(amplitudes[k-1]/total)*Math.sin(2*Math.PI*k*i/size);
 return table;
}
