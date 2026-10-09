import test from 'node:test';
import assert from 'node:assert/strict';
import {validateConstruction,patternGeometry,patternSvg} from '../src/construction.ts';
import {createProject,validateProject,parseProject,serializeProject,ProjectHistory} from '../src/model.ts';
const draft={kind:'flared-skirt' as const,waist:80,hem:140,slant:60};
test('physical pattern arcs and both joining edges match circumference and slant',()=>{
 const g=patternGeometry(draft);assert.ok(Math.abs(g.innerRadius*g.angle-40)<1e-10);assert.ok(Math.abs(g.outerRadius*g.angle-70)<1e-10);assert.equal(g.outerRadius-g.innerRadius,60);assert.ok(Math.abs(g.height**2+(30/Math.PI)**2-3600)<1e-9);assert.equal(g.angle,.5);assert.ok(g.width>0&&g.length>0);
});
test('strict settings reject unsafe shapes and impossible conical assemblies',()=>{
 for(const value of [{...draft,hem:80},{...draft,waist:NaN},{...draft,slant:0},{...draft,waist:50,hem:300,slant:20},{...draft,extra:1},Object.create(draft),{...draft,kind:'tee'}])assert.throws(()=>validateConstruction(value));let accessed=false;const accessor={...draft};Object.defineProperty(accessor,'waist',{get(){accessed=true;return 80}});assert.throws(()=>validateConstruction(accessor));assert.equal(accessed,false);
});
test('legacy absence remains exact while construction survives detached complete history and backups',()=>{
 const p=createProject();assert.deepEqual(validateProject(p),p);const before=serializeProject(p),next={...p,construction:draft};const v=validateProject(next);assert.deepEqual(v,next);v.construction!.waist=90;assert.equal(next.construction.waist,80);assert.deepEqual(parseProject(serializeProject(next)),next);const h=new ProjectHistory(p);h.commit(next);assert.deepEqual(h.undo(),p);assert.deepEqual(h.redo(),next);assert.equal(h.commit(next),false);assert.equal(serializeProject(p),before);assert.throws(()=>validateProject({...p,construction:{...draft,hem:40}}));
});
test('nets at valid extremes remain finite bounded physical sheets with explicit joining labels',()=>{
 for(const waist of [50,150])for(const slant of [20,120])for(const hem of [Math.max(70,waist+5),300]){
  if((hem-waist)/(2*Math.PI)>=slant)continue;const d={...draft,waist,hem,slant},g=patternGeometry(d);assert.ok(Number.isFinite(g.width+g.length+g.height));assert.ok(g.width<300&&g.length<200);const svg=patternSvg(d);assert.match(svg,/width="[\d.]+mm"/);assert.match(svg,/id="panel-front"/);assert.match(svg,/id="panel-back"/);assert.match(svg,/5 cm/);assert.match(svg,/No seam or hem allowance/);assert.doesNotMatch(svg,/<script|<image|foreignObject|https?:\/\/(?!www.w3.org)/);
 }
});
