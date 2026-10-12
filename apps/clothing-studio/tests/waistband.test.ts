import test from 'node:test';
import assert from 'node:assert/strict';
import {validateConstruction,patternSvg} from '../src/construction.ts';
import {skirtMesh,shellObj,shellSvg} from '../src/construction-3d.ts';
import {gradedSizes,gradedPatternSvg} from '../src/grading.ts';
import {tiledPatternHtml} from '../src/print-pattern.ts';
import {createProject,validateProject,ProjectHistory,parseProject,serializeProject} from '../src/model.ts';
const base={kind:'flared-skirt' as const,waist:80,hem:140,slant:60};
const band={...base,waistband:{height:4,overlap:2},allowances:{seam:1,hem:3}};
test('optional measured waistband validates detached complete projects with legacy absence and history',()=>{
 const p=createProject(),next=validateProject({...p,construction:band});assert.deepEqual(next.construction,band);
 assert.deepEqual(validateConstruction(base),base);assert.deepEqual(parseProject(serializeProject(next)),next);
 const h=new ProjectHistory(p);h.commit(next);assert.deepEqual(h.undo(),p);assert.deepEqual(h.redo(),next);
 const detached=validateConstruction(band);detached.waistband!.height=5;assert.equal(band.waistband.height,4);
});
test('waistband settings reject malformed bounds and accessors without reading them',()=>{
 for(const w of [null,undefined,{}, {height:1,overlap:2},{height:11,overlap:2},{height:4,overlap:-1},{height:4,overlap:6},{height:NaN,overlap:2},{height:4,overlap:'2'},{height:4,overlap:2,extra:1}])assert.throws(()=>validateConstruction({...base,waistband:w}));
 let reads=0;assert.throws(()=>validateConstruction({...base,waistband:{get height(){reads++;return 4;},overlap:2}}));assert.equal(reads,0);
});
test('full-scale band has independently calculated folded stitch and cutting dimensions',()=>{
 const svg=patternSvg(band);assert.match(svg,/id="stitch-waistband"[^>]*width="82"[^>]*height="8"/);
 assert.match(svg,/id="cut-waistband"[^>]*width="84"[^>]*height="10"/);
 assert.match(svg,/id="fold-waistband"/);assert.match(svg,/Waistband/);assert.match(svg,/closure extension 2 cm/);
 const sizes=gradedSizes(band,{steps:1,waistStep:4,hemStep:6,slantStep:0});assert.deepEqual(sizes.map(x=>x.draft.waistband),[band.waistband,band.waistband,band.waistband]);
 const graded=gradedPatternSvg(band,{steps:1,waistStep:4,hemStep:6,slantStep:0});assert.equal((graded.match(/id="piece-\d-stitch-waistband"/g)||[]).length,3);
});
test('linked rigid waistband matches shell waist and finished height with separate outward surface group',()=>{
 const legacy=skirtMesh(base),mesh=skirtMesh(band);assert.equal(mesh.vertices.length,128);assert.equal(mesh.faces.length,64);
 assert.deepEqual(mesh.vertices.slice(0,64),legacy.vertices);
 for(let i=64;i<128;i++){const v=mesh.vertices[i];assert.ok(Math.abs(Math.hypot(v.x,v.z)*2*Math.PI-80)<1e-10);assert.equal(v.y,i<96?-4:0);}
 for(const face of mesh.faces.slice(32)){const [a,b,c]=face.map(i=>mesh.vertices[i]),ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;assert.ok((uy*vz-uz*vy)*a.x+(ux*vy-uy*vx)*a.z>0);}
 const obj=shellObj(band);assert.match(obj,/g Waistband/);assert.equal((obj.match(/^f /gm)||[]).length,64);assert.match(obj,/closure extension is not modelled/);
 const svg=shellSvg(band,30,'#334455');assert.equal((svg.match(/data-panel="waistband"/g)||[]).length,32);
});
test('tiled calibration acknowledges included waistband and retains closure and fit limits',()=>{
 const html=tiledPatternHtml(band,'a4');assert.match(html,/Waistband included; closure and body fit are not simulated/);
 assert.doesNotMatch(html,/No waistband, closure or body fit/);
});
