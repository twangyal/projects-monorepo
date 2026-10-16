/** SI small-strain membrane experiment. Coefficients are resultants (N/m), not 3D moduli. */
export interface MembraneProfile {id:string;name:string;provenance:'illustrative';densityKgM2:number;C11:number;C22:number;C12:number;G12:number;source:string}
export interface MembraneInput {lengthCm:number;widthCm:number;forceN:number;grain:0|45|90;cells:4|8;diagonal:'forward'|'backward'}
type Vec3=[number,number,number];
export const MEMBRANE_PROFILES:readonly MembraneProfile[]=Object.freeze([
 Object.freeze({id:'membrane-compliant-v1',name:'Illustrative compliant membrane',provenance:'illustrative' as const,densityKgM2:.18,C11:200,C22:100,C12:20,G12:40,source:'Repository-authored linear demonstration; no measured specimen.'}),
 Object.freeze({id:'membrane-firm-v1',name:'Illustrative firm membrane',provenance:'illustrative' as const,densityKgM2:.32,C11:1200,C22:600,C12:60,G12:200,source:'Repository-authored linear demonstration; no measured specimen.'}),
]);
function validateProfile(p:MembraneProfile){
 if(p.provenance!=='illustrative'||![p.densityKgM2,p.C11,p.C22,p.C12,p.G12].every(v=>typeof v==='number'&&Number.isFinite(v))||p.densityKgM2<=0||p.C11<=0||p.C22<=0||p.G12<=0||!Number.isFinite(p.C11*p.C22-p.C12**2)||p.C11*p.C22<=p.C12**2)throw new Error('A stable positive-definite illustrative membrane profile is required.');
}
export function validateMembrane(raw:MembraneInput):MembraneInput{
 if(!raw||![raw.lengthCm,raw.widthCm,raw.forceN].every(v=>typeof v==='number'&&Number.isFinite(v))||raw.lengthCm<5||raw.lengthCm>50||raw.widthCm<5||raw.widthCm>50||raw.forceN<0||raw.forceN>2||![0,45,90].includes(raw.grain)||![4,8].includes(raw.cells)||!['forward','backward'].includes(raw.diagonal))throw new Error('Use membrane lengths/widths 5–50 cm, force 0–2 N, grain 0/45/90°, 4/8 cells and a supported diagonal.');
 return{lengthCm:raw.lengthCm,widthCm:raw.widthCm,forceN:raw.forceN,grain:raw.grain,cells:raw.cells,diagonal:raw.diagonal};
}
function strainBasis(grain:number){const a=grain*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return[[c*c,s*s,c*s],[s*s,c*c,-c*s],[-2*c*s,2*c*s,c*c-s*s]];}
export function membraneResponse(p:MembraneProfile,grain:0|45|90,strain:Vec3){
 validateProfile(p);if(![0,45,90].includes(grain)||!strain.every(Number.isFinite))throw new Error('Finite supported membrane strain and grain are required.');
 const T=strainBasis(grain),local=T.map(row=>row.reduce((sum,v,j)=>sum+v*strain[j]!,0)) as Vec3;
 const stress=[p.C11*local[0]+p.C12*local[1],p.C12*local[0]+p.C22*local[1],p.G12*local[2]];
 const global=T[0]!.map((_,j)=>T.reduce((sum,row,i)=>sum+row[j]!*stress[i]!,0)) as Vec3;
 return{materialStrain:local,stressNPerM:global,energyPerAreaJm2:strain.reduce((sum,v,j)=>sum+.5*v*global[j]!,0)};
}
type MembraneNode={xM:number;yM:number;uxM:number;uyM:number};
/** Constant-strain triangle in the original flat coordinates. */
export function membraneElement(profile:MembraneProfile,grain:0|45|90,points:MembraneNode[]){
 if(points.length!==3||!points.every(p=>[p.xM,p.yM,p.uxM,p.uyM].every(Number.isFinite)))throw new Error('Three finite membrane nodes are required.');
 const [a,b,c]=points as [MembraneNode,MembraneNode,MembraneNode];
 const twiceArea=(b.xM-a.xM)*(c.yM-a.yM)-(c.xM-a.xM)*(b.yM-a.yM);
 if(Math.abs(twiceArea)<1e-14)throw new Error('A nondegenerate membrane triangle is required.');
 const dx=[b.yM-c.yM,c.yM-a.yM,a.yM-b.yM].map(v=>v/twiceArea),dy=[c.xM-b.xM,a.xM-c.xM,b.xM-a.xM].map(v=>v/twiceArea);
 const B=Array.from({length:3},()=>new Float64Array(6));for(let i=0;i<3;i++){B[0]![i*2]=dx[i]!;B[1]![i*2+1]=dy[i]!;B[2]![i*2]=dy[i]!;B[2]![i*2+1]=dx[i]!;}
 const u=points.flatMap(p=>[p.uxM,p.uyM]),strain=B.map(row=>row.reduce((sum,v,j)=>sum+v*u[j]!,0)) as Vec3;
 return{areaM2:Math.abs(twiceArea)/2,B,strain,...membraneResponse(profile,grain,strain)};
}
function solveDense(matrix:Float64Array[],load:Float64Array){
 const A=matrix.map(row=>row.slice()),b=load.slice(),n=b.length;
 for(let k=0;k<n;k++){
  let pivot=k;for(let i=k+1;i<n;i++)if(Math.abs(A[i]![k]!)>Math.abs(A[pivot]![k]!))pivot=i;
  if(!Number.isFinite(A[pivot]![k])||Math.abs(A[pivot]![k]!)<1e-14)throw new Error('Membrane equilibrium is unavailable.');
  [A[k],A[pivot]]=[A[pivot]!,A[k]!];[b[k],b[pivot]]=[b[pivot]!,b[k]!];
  for(let i=k+1;i<n;i++){const ratio=A[i]![k]!/A[k]![k]!;for(let j=k+1;j<n;j++)A[i]![j]-=ratio*A[k]![j]!;A[i]![k]=0;b[i]-=ratio*b[k]!;}
 }
 const u=new Float64Array(n);for(let i=n-1;i>=0;i--){let v=b[i]!;for(let j=i+1;j<n;j++)v-=A[i]![j]!*u[j]!;u[i]=v/A[i]![i]!;}return u;
}
export function solveMembrane(profile:MembraneProfile,raw:MembraneInput){
 const input=validateMembrane(raw);validateProfile(profile);
 const L=input.lengthCm/100,W=input.widthCm/100,n=input.cells;
 const C=Array.from({length:3},()=>new Float64Array(3));
 for(let j=0;j<3;j++){const e:Vec3=[0,0,0];e[j]=1;const r=membraneResponse(profile,input.grain,e);for(let i=0;i<3;i++)C[i]![j]=r.stressNPerM[i]!;}
 // Uniform traction is an affine patch. Preflight its exact compliance before the mesh solve.
 const oracle=solveDense(C,Float64Array.from([input.forceN/W,0,0]));
 const local=membraneResponse(profile,input.grain,Array.from(oracle) as Vec3).materialStrain;
 if([...oracle,...local].some(v=>!Number.isFinite(v)||Math.abs(v)>.1*(1+8*Number.EPSILON)))throw new Error('Outside the small-strain range: normal and engineering shear strains must stay within 10%. Reduce force.');
 const nodes=Array.from({length:(n+1)**2},(_,id)=>({xM:(id%(n+1))*L/n,yM:Math.floor(id/(n+1))*W/n,uxM:0,uyM:0}));
 const triangles:number[][]=[];for(let y=0;y<n;y++)for(let x=0;x<n;x++){const a=y*(n+1)+x,b=a+1,c=a+n+1,d=c+1;triangles.push(...(input.diagonal==='forward'?[[a,b,d],[a,d,c]]:[[a,b,c],[b,d,c]]));}
 const size=nodes.length*2,K=Array.from({length:size},()=>new Float64Array(size)),load=new Float64Array(size);
 const elements=triangles.map(ids=>{
  const {areaM2,B}=membraneElement(profile,input.grain,ids.map(id=>nodes[id]!));
  const dofs=ids.flatMap(id=>[id*2,id*2+1]);
  for(let i=0;i<6;i++)for(let j=0;j<6;j++){let value=0;for(let r=0;r<3;r++)for(let s=0;s<3;s++)value+=B[r]![i]!*C[r]![s]!*B[s]![j]!;K[dofs[i]!]![dofs[j]!]+=areaM2*value;}
  return{ids,dofs,areaM2,B};
 });
 for(let y=0;y<=n;y++)load[(y*(n+1)+n)*2]=input.forceN/n*(y===0||y===n?.5:1);
 const fixed=new Set<number>([1]);for(let y=0;y<=n;y++)fixed.add(y*(n+1)*2);
 const free=Array.from({length:size},(_,i)=>i).filter(i=>!fixed.has(i));
 const solved=solveDense(free.map(i=>Float64Array.from(free,j=>K[i]![j]!)),Float64Array.from(free,i=>load[i]!));
 const u=new Float64Array(size);free.forEach((id,i)=>u[id]=solved[i]!);nodes.forEach((node,i)=>{node.uxM=u[i*2]!;node.uyM=u[i*2+1]!;});
 const internal=Float64Array.from(K,row=>row.reduce((sum,v,j)=>sum+v*u[j]!,0));
 const supportForceN:[number,number]=[0,0];for(const id of fixed)supportForceN[id%2]+=internal[id]!-load[id]!;
 const forceResidualN=Math.max(...free.map(i=>Math.abs(internal[i]!-load[i]!)));
 const meanStrain:Vec3=[0,0,0];let energyJ=0;
 const elementResults=elements.map(e=>{const response=membraneElement(profile,input.grain,e.ids.map(id=>nodes[id]!));response.strain.forEach((v,j)=>meanStrain[j]+=v*e.areaM2/(L*W));energyJ+=response.energyPerAreaJm2*e.areaM2;return{nodeIds:e.ids,areaM2:e.areaM2,strain:response.strain,materialStrain:response.materialStrain,stressNPerM:response.stressNPerM};});
 if(![...u,energyJ,forceResidualN,...supportForceN].every(Number.isFinite))throw new Error('Membrane equilibrium is unavailable.');
 const right=nodes.filter((_,i)=>i%(n+1)===n),extensionM=right.reduce((sum,p)=>sum+p.uxM,0)/(n+1);
 const top=nodes.filter((_,i)=>i>=n*(n+1)),bottom=nodes.slice(0,n+1),widthChangeM=top.reduce((sum,p,i)=>sum+p.uyM-bottom[i]!.uyM,0)/(n+1);
 return{profileId:profile.id,massKg:profile.densityKgM2*L*W,energyJ,extensionM,widthChangeM,meanStrain,supportForceN,forceResidualN,nodes,triangles,elements:elementResults};
}
export function compareMembrane(raw:MembraneInput){const input=validateMembrane(raw);return{schema:1,experiment:'static-orthotropic-membrane-v1',input,units:{inputLength:'cm',length:'m',mass:'kg',energy:'J',coefficient:'N/m',stressResultant:'N/m',force:'N',strain:'dimensionless; engineering gamma=2*epsilon_xy'},profiles:MEMBRANE_PROFILES.map(p=>({...p})),assumptions:['Illustrative coefficients, not measured fabrics.','Linear small-strain membrane energy; fixed flat material grain, independent of prints.','Uniform right-edge x traction; left-edge x fixed and bottom-left y anchored, allowing contraction. Other edges traction-free.','4/8 cells per side; constant-strain triangles. Affine patch consistency is not general mesh convergence.','Global/material normal and engineering shear strains limited to 10%. No physical timestep.','No bending, gravity, dynamics, buckling, contact or garment calibration. Session-only experiment leaves garment physics unchanged.'],results:MEMBRANE_PROFILES.map(p=>solveMembrane(p,input))};}
export type MembraneReceipt=ReturnType<typeof compareMembrane>;
