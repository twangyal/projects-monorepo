import {validateTensile,type TensileInput} from './tensile.ts';
export interface BendingProfile{id:string;name:string;provenance:'illustrative';densityKgM2:number;warpBendingNm:number;weftBendingNm:number;source:string}
export const BENDING_PROFILES:readonly BendingProfile[]=Object.freeze([
 Object.freeze({id:'bend-compliant-v1',name:'Illustrative flexible',provenance:'illustrative' as const,densityKgM2:.18,warpBendingNm:.002,weftBendingNm:.001,source:'Repository-authored bending demonstration; no measured specimen.'}),
 Object.freeze({id:'bend-stiff-v1',name:'Illustrative firm',provenance:'illustrative' as const,densityKgM2:.32,warpBendingNm:.02,weftBendingNm:.01,source:'Repository-authored bending demonstration; no measured specimen.'}),
]);
export function solveBending(profile:BendingProfile,raw:TensileInput){
 const input=validateTensile(raw);if(input.forceN>.1)throw new Error('Use a bending end force from 0 to 0.1 N.');
 if(profile.provenance!=='illustrative'||![profile.densityKgM2,profile.warpBendingNm,profile.weftBendingNm].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0))throw new Error('Finite positive illustrative bending coefficients are required.');
 const L=input.lengthCm/100,W=input.widthCm/100,n=input.segments,h=L/n,D=input.grain===0?profile.warpBendingNm:profile.weftBendingNm,EI=D*W,F=input.forceN;
 const expectedTip=F*L**3/(3*EI),expectedSlope=F*L**2/(2*EI);
 if(!Number.isFinite(expectedTip)||!Number.isFinite(expectedSlope)||expectedTip>L*.1||expectedSlope>.15)throw new Error('Outside the small-bending range: tip must stay within 10% of length and slope within 0.15 rad. Reduce force.');
 const size=2*(n+1),K=Array.from({length:size},()=>new Float64Array(size));
 const element=[[12,6*h,-12,6*h],[6*h,4*h*h,-6*h,2*h*h],[-12,-6*h,12,-6*h],[6*h,2*h*h,-6*h,4*h*h]],factor=EI/h**3;
 for(let e=0;e<n;e++)for(let i=0;i<4;i++)for(let j=0;j<4;j++)K[e*2+i]![e*2+j]+=factor*element[i]![j]!;
 // Both displacement and rotation at node0 are fixed. Partial-pivot elimination of the remaining <=32 DOFs.
 const count=size-2,A=Array.from({length:count},(_,i)=>Float64Array.from(K[i+2]!.slice(2))),rhs=new Float64Array(count);rhs[count-2]=F;
 for(let c=0;c<count;c++){
  let pivot=c;for(let r=c+1;r<count;r++)if(Math.abs(A[r]![c]!)>Math.abs(A[pivot]![c]!))pivot=r;
  if(!Number.isFinite(A[pivot]![c])||A[pivot]![c]===0)throw new Error('Bending equilibrium is unavailable.');
  [A[c],A[pivot]]=[A[pivot]!,A[c]!];[rhs[c],rhs[pivot]]=[rhs[pivot]!,rhs[c]!];
  for(let r=c+1;r<count;r++){const ratio=A[r]![c]!/A[c]![c]!;for(let j=c;j<count;j++)A[r]![j]-=ratio*A[c]![j]!;rhs[r]-=ratio*rhs[c]!;}
 }
 const u=new Float64Array(size);for(let i=count-1;i>=0;i--){let v=rhs[i]!;for(let j=i+1;j<count;j++)v-=A[i]![j]!*u[j+2]!;u[i+2]=v/A[i]![i]!;}
 const internal=Float64Array.from(K,row=>row.reduce((sum,v,j)=>sum+v*u[j]!,0));let forceResidualN=0,momentResidualNm=0,energyJ=0;
 for(let i=0;i<size;i++){energyJ+=u[i]!*internal[i]!/2;if(i>=2){const residual=Math.abs(internal[i]!-(i===size-2?F:0));if(i%2)momentResidualNm=Math.max(momentResidualNm,residual);else forceResidualN=Math.max(forceResidualN,residual);}}
 if(![...u,energyJ,forceResidualN,momentResidualNm].every(Number.isFinite))throw new Error('Bending equilibrium is unavailable.');
 return{profileId:profile.id,rigidityNm:D,flexuralRigidityNm2:EI,massKg:profile.densityKgM2*L*W,tipM:u[size-2]!,tipRotationRad:u[size-1]!,energyJ,supportForceN:internal[0]!,supportMomentNm:internal[1]!,clampForceMagnitudeN:Math.abs(internal[0]!),clampMomentMagnitudeNm:Math.abs(internal[1]!),forceResidualN,momentResidualNm,points:Array.from({length:n+1},(_,i)=>({xM:i*h,deflectionM:u[i*2]!,rotationRad:u[i*2+1]!}))};
}
export function compareBending(raw:TensileInput){const input=validateTensile(raw);return{schema:1,experiment:'static-cantilever-v1',input,units:{inputLength:'cm',length:'m',rotation:'rad',rigidity:'N*m',flexuralRigidity:'N*m^2',force:'N',moment:'N*m',mass:'kg',energy:'J'},profiles:BENDING_PROFILES.map(p=>({...p})),assumptions:['Illustrative bending coefficients, not measured fabrics.','Small-deflection Euler–Bernoulli strip: one end clamped in displacement and rotation, a transverse force at the free end.','EI equals directional bending rigidity times coupon width; cubic beam elements, static equilibrium.','Positive deflection/rotation follow the downward end load. Signed supportForceN and supportMomentNm oppose it; clampForceMagnitudeN and clampMomentMagnitudeNm are absolute magnitudes.','No shear deformation, gravity, dynamics, contact, axial constitutive law or garment calibration.','Tip displacement <=10% length and slope <=0.15rad; session-only experiment leaves garment physics unchanged.'],results:BENDING_PROFILES.map(p=>solveBending(p,input))};}
export type BendingReceipt=ReturnType<typeof compareBending>;
