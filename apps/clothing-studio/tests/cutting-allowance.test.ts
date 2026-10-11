import test from 'node:test';
import assert from 'node:assert/strict';
import * as construction from '../src/construction.ts';
import {createProject,validateProject,serializeProject,parseProject,ProjectHistory} from '../src/model.ts';
import {gradedSizes} from '../src/grading.ts';
const base={kind:'flared-skirt' as const,waist:80,hem:140,slant:60};
const draft={...base,allowances:{seam:1,hem:3}};
const cutting=(construction as unknown as {cutGeometry:(v:unknown)=>{innerRadius:number;outerRadius:number;waistRight:{x:number;y:number};hemRight:{x:number;y:number};width:number;length:number;top:number}}).cutGeometry;
test('cutting corners lie on independent concentric offsets and parallel side edges',()=>{
 assert.equal(typeof cutting,'function');const g=cutting(draft);assert.equal(g.innerRadius,79);assert.equal(g.outerRadius,143);for(const [p,r] of [[g.waistRight,79],[g.hemRight,143]] as const){assert.ok(Math.abs(Math.hypot(p.x,p.y)-r)<1e-10);assert.ok(Math.abs(p.x*Math.cos(.25)-p.y*Math.sin(.25)-1)<1e-10);const t=Math.sqrt(r*r-1);assert.ok(Math.abs(p.x-(t*Math.sin(.25)+Math.cos(.25)))<1e-10);}assert.equal(construction.patternGeometry(draft).innerRadius,80);assert.ok(g.width>construction.patternGeometry(base).width);assert.ok(g.length>construction.patternGeometry(base).length);
});
test('optional allowance schema preserves old absence and complete history backups and graded settings',()=>{
 assert.deepEqual(construction.validateConstruction(base),base);assert.deepEqual(construction.validateConstruction(draft),draft);const p=createProject(),next=validateProject({...p,construction:draft});assert.deepEqual(parseProject(serializeProject(next)),next);const h=new ProjectHistory(p);h.commit(next);assert.deepEqual(h.undo(),p);assert.deepEqual(h.redo(),next);for(const size of gradedSizes(draft,{waistStep:4,hemStep:6,slantStep:0,steps:2}))assert.deepEqual((size.draft as typeof draft).allowances,draft.allowances);for(const bad of [{seam:-1,hem:3},{seam:2.6,hem:3},{seam:1,hem:5.1},{seam:1,hem:NaN},{seam:'1',hem:3},{seam:1,hem:3,extra:0}])assert.throws(()=>construction.validateConstruction({...base,allowances:bad}));const mutable=construction.validateConstruction(draft) as typeof draft;mutable.allowances.seam=2;assert.equal(draft.allowances.seam,1);
});
test('valid cutting extremes remain finite and exported stitch paths keep measured geometry',()=>{
 assert.equal(typeof cutting,'function');for(const waist of [50,150])for(const slant of [20,40,120])for(const hem of [Math.max(70,waist+5),300]){if((hem-waist)/(2*Math.PI)>=slant)continue;const d={kind:'flared-skirt' as const,waist,hem,slant,allowances:{seam:2.5,hem:5}},g=cutting(d);assert.ok([g.width,g.length,g.top,g.waistRight.x,g.waistRight.y,g.hemRight.x,g.hemRight.y].every(Number.isFinite));assert.ok(g.width>0&&g.length>0);const svg=construction.patternSvg(d);assert.match(svg,/id="cut-front"/);assert.match(svg,/id="stitch-front"/);assert.match(svg,/Seam\/waist allowance 2.5 cm/);assert.match(svg,/hem allowance 5 cm/);assert.doesNotMatch(svg,/<script|foreignObject|<image/);}const plain=construction.patternGeometry(base),zero=cutting({...base,allowances:{seam:0,hem:0}});assert.equal(zero.innerRadius,plain.innerRadius);assert.equal(zero.outerRadius,plain.outerRadius);
});
