/** Controlled SI axial strip. Not a garment, shear, bending, contact or dynamic solver. */
export interface TensileInput {lengthCm:number;widthCm:number;forceN:number;grain:0|90;segments:8|16}
export interface AxialProfile {id:string;name:string;provenance:'illustrative';densityKgM2:number;warpNPerM:number;weftNPerM:number;bendingNm:null;source:string}
export const AXIAL_PROFILES:readonly AxialProfile[]=Object.freeze([
 Object.freeze({id:'axial-soft-v1',name:'Illustrative compliant',provenance:'illustrative' as const,densityKgM2:0.18,warpNPerM:200,weftNPerM:100,bendingNm:null,source:'Repository-authored axial demonstration values; no measured specimen.'}),
 Object.freeze({id:'axial-stiff-v1',name:'Illustrative stiff',provenance:'illustrative' as const,densityKgM2:0.32,warpNPerM:1200,weftNPerM:600,bendingNm:null,source:'Repository-authored axial demonstration values; no measured specimen.'}),
]);
export function validateTensile(input:TensileInput):TensileInput{
 if(!input||typeof input!=='object'||Object.keys(input).sort().join()!=='forceN,grain,lengthCm,segments,widthCm')throw new Error('Use the complete supported coupon inputs.');
 const {lengthCm,widthCm,forceN,grain,segments}=input;
 if(![lengthCm,widthCm,forceN,grain,segments].every(n=>typeof n==='number'&&Number.isFinite(n))||lengthCm<5||lengthCm>50||widthCm<5||widthCm>50||forceN<0||forceN>5||![0,90].includes(grain)||![8,16].includes(segments))throw new Error('Coupon: length/width 5–50 cm, force 0–5 N, grain 0°/90°, segments 8/16.');
 return {lengthCm,widthCm,forceN,grain,segments};
}
export function solveTensile(profile:AxialProfile,raw:TensileInput){
 const input=validateTensile(raw);
 if(profile.provenance!=='illustrative'||![profile.densityKgM2,profile.warpNPerM,profile.weftNPerM].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0)||profile.bendingNm!==null)throw new Error('A finite positive illustrative axial profile is required.');
 const length=input.lengthCm/100,width=input.widthCm/100,n=input.segments,h=length/n,modulus=input.grain===0?profile.warpNPerM:profile.weftNPerM,k=modulus*width/h;
 if(input.forceN/(modulus*width)>0.1)throw new Error('Load exceeds the illustrative 10% axial strain range. Reduce force or increase width.');
 // Minimize sum[k(du)^2/2] - F*u_end, u_0=0. Tridiagonal equilibrium of n equal axial elements.
 const diagonal=new Float64Array(n).fill(2*k),rhs=new Float64Array(n),u=new Float64Array(n+1);diagonal[n-1]=k;rhs[n-1]=input.forceN;
 for(let i=1;i<n;i++){const ratio=-k/diagonal[i-1]!;diagonal[i]-=ratio*-k;rhs[i]-=ratio*rhs[i-1]!;}
 for(let i=n-1;i>=0;i--)u[i+1]=(rhs[i]!+(i<n-1?k*u[i+2]!:0))/diagonal[i]!;
 let energy=0,residual=0;const tensions:number[]=[];
 for(let i=0;i<n;i++){const d=u[i+1]!-u[i]!;energy+=k*d*d/2;tensions.push(k*d);}
 for(let i=1;i<n;i++)residual=Math.max(residual,Math.abs(tensions[i]!-tensions[i-1]!));residual=Math.max(residual,Math.abs(tensions[n-1]!-input.forceN));
 const extension=u[n]!;if(![extension,energy,residual].every(Number.isFinite))throw new Error('Coupon equilibrium is unavailable.');
 return {profileId:profile.id,massKg:profile.densityKgM2*length*width,materialExtensionalNPerM:modulus,couponStiffnessNPerM:modulus*width/length,extensionM:extension,strain:extension/length,energyJ:energy,reactionN:tensions[0]!,residualN:residual,positionsM:Array.from(u,(d,i)=>i*h+d)};
}
export function compareTensile(raw:TensileInput){
 const input=validateTensile(raw);return {schema:1,experiment:'static-axial-strip-v1',units:{length:'m',mass:'kg',force:'N',inputLength:'cm',materialExtensional:'N/m',couponStiffness:'N/m',strain:'dimensionless',energy:'J'},input,profiles:AXIAL_PROFILES.map(p=>({...p})),assumptions:['Illustrative coefficients, not measured specimens.','Axial linear energy only; clamp at one end, uniform end traction, free axial extension.','0° uses warp and 90° weft. No transverse contraction, shear, bend, gravity, damping or contact.','Quasi-static equilibrium: no physical timestep, triangles or garment-drape calibration.','Maximum illustrative axial strain 10%. Inputs are session-only and do not change your garment.'],results:AXIAL_PROFILES.map(p=>solveTensile(p,input))};
}
export type TensileReceipt=ReturnType<typeof compareTensile>;
