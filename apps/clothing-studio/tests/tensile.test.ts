import test from 'node:test';
import assert from 'node:assert/strict';
import {compareTensile,solveTensile,AXIAL_PROFILES} from '../src/tensile.ts';
const input={lengthCm:20,widthCm:20,forceN:0.5,grain:0 as 0|90,segments:8 as 8|16};
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
test('SI coupon mass and force-extension-energy match an independent axial calculation',()=>{
 const receipt=compareTensile(input),a=receipt.results[0]!;near(a.massKg,0.0072);near(a.extensionM,0.0025);near(a.strain,0.0125);near(a.energyJ,0.000625);near(a.reactionN,0.5);near(a.residualN,0);near(a.positionsM.at(-1)!,0.2025);assert.equal(receipt.profiles[0]!.provenance,'illustrative');assert.equal(receipt.profiles[0]!.bendingNm,null);
});
test('90 degree grain selects weft response without changing mass; stiffer profile stretches less',()=>{
 const a=compareTensile(input),b=compareTensile({...input,grain:90});near(b.results[0]!.extensionM,a.results[0]!.extensionM*2);near(b.results[0]!.massKg,a.results[0]!.massKg);assert.ok(a.results[1]!.extensionM<a.results[0]!.extensionM/5);
});
test('two discretizations converge to the same equilibrium without changing material energy',()=>{
 const a=compareTensile(input),b=compareTensile({...input,segments:16});for(let i=0;i<2;i++){near(a.results[i]!.extensionM,b.results[i]!.extensionM);near(a.results[i]!.energyJ,b.results[i]!.energyJ);}assert.equal(a.results[0]!.positionsM.length,9);assert.equal(b.results[0]!.positionsM.length,17);
});
test('zero load is undeformed with zero energy; doubled width halves extension and doubles mass',()=>{
 const zero=compareTensile({...input,forceN:0}),wide=compareTensile({...input,widthCm:40});near(zero.results[0]!.extensionM,0);near(zero.results[0]!.energyJ,0);near(wide.results[0]!.extensionM,0.00125);near(wide.results[0]!.massKg,0.0144);
});
test('invalid and out-of-small-strain inputs refuse atomically without coercion or input mutation',()=>{
 const before=JSON.stringify(input);for(const invalid of [{forceN:NaN},{forceN:-1},{widthCm:0},{lengthCm:Infinity},{grain:45},{segments:100},{lengthCm:'20'},{widthCm:5,forceN:5}])assert.throws(()=>compareTensile({...input,...invalid} as typeof input));assert.equal(JSON.stringify(input),before);
});

test('mass changes independently of axial elasticity in static loading',()=>{const p=AXIAL_PROFILES[0]!,a=solveTensile(p,input),b=solveTensile({...p,densityKgM2:p.densityKgM2*2},input);near(a.extensionM,b.extensionM);near(a.energyJ,b.energyJ);near(b.massKg,2*a.massKg);});

test('material coefficient and actual coupon force-extension stiffness are distinct',()=>{const r=compareTensile({...input,lengthCm:5,widthCm:50}).results[0]!;near(r.materialExtensionalNPerM,200);near(r.couponStiffnessNPerM,2000);near(0.5/r.extensionM,r.couponStiffnessNPerM);});
