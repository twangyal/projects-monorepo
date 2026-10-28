import test from 'node:test';import assert from 'node:assert/strict';
import {productFromConstruction} from '../src/construction-product.ts';
import {createProject,validateProject,ProjectHistory,parseProject,serializeProject} from '../src/model.ts';
import {template} from '../src/product.ts';
test('a measured skirt becomes a detached product while every independent project field is kept',()=>{
 const p=validateProject({...createProject(),title:'My skirt',note:'Keep this',product:template('breton'),construction:{kind:'flared-skirt',waist:90,hem:190,slant:65,allowances:{seam:1,hem:3},waistband:{height:4,overlap:2},fabric:'denim'},bodyMeasurements:{waist:76,hip:98,hipDepth:20}});
 const before=structuredClone(p),next=productFromConstruction(p);
 assert.deepEqual(next.product!.measurements,{waist:90,hem:190,slant:65,waistbandHeight:4});assert.equal(next.product!.base,'skirt');assert.equal(next.product!.name,'Measured skirt');
 assert.deepEqual({...next,product:p.product},p);assert.deepEqual(p,before);
 assert.equal(next.product!.parts.front.material,'linen-170');assert.equal(next.product!.parts.waistband.material,'linen-170');assert.notEqual(next.product!.parts.waistband,next.product!.parts.front);assert.deepEqual(next.product!.artwork,[]);
 next.construction!.waist=95;next.product!.parts.front.color='#112233';assert.deepEqual(p,before);assert.equal(template('flared-skirt').parts.front.color,'#9fae91');
});
test('copy requires valid applied construction and preserves measurement extremes without rounding',()=>{
 assert.throws(()=>productFromConstruction(createProject()),/Apply.*pattern/i);
 const p={...createProject(),construction:{kind:'flared-skirt' as const,waist:50,hem:70,slant:120}};
 assert.deepEqual(productFromConstruction(p).product!.measurements,{waist:50,hem:70,slant:120});
 assert.throws(()=>productFromConstruction({...p,construction:{...p.construction,hem:20}}));
});
test('replacement is a single complete history step and persists in backups',()=>{
 const p=validateProject({...createProject(),product:template('hoodie'),construction:{kind:'flared-skirt',waist:80.5,hem:165.5,slant:63.5}});
 const h=new ProjectHistory(p),next=productFromConstruction(p);h.commit(next);
 assert.deepEqual(h.undo(),p);assert.deepEqual(h.redo(),next);assert.deepEqual(parseProject(serializeProject(next)),next);
});
