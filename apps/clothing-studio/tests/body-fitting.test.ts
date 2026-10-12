import test from 'node:test';import assert from 'node:assert/strict';import * as api from '../src/body-fitting.ts';import {createProject,validateProject,serializeProject,parseProject,ProjectHistory} from '../src/model.ts';
const draft={kind:'flared-skirt' as const,waist:80,hem:140,slant:60},body={waist:76,hip:100,hipDepth:20};
test('body profile retains detached complete projects and one-edit history without changing legacy shape',()=>{
 assert.equal(typeof api.validateBodyMeasurements,'function');const p=createProject(),expected={...p,construction:draft,bodyMeasurements:body},next=validateProject(expected);assert.deepEqual(next,expected);assert.deepEqual(parseProject(serializeProject(next)),expected);assert.equal(Object.hasOwn(validateProject(p),'bodyMeasurements'),false);const h=new ProjectHistory(p);h.commit(next);assert.deepEqual(h.undo(),p);assert.deepEqual(h.redo(),expected);const b=api.validateBodyMeasurements(body);b.hip=110;assert.equal(body.hip,100);
});
test('body data rejects invalid bounds fields and getters without reading them',()=>{
 assert.equal(typeof api.validateBodyMeasurements,'function');for(const b of [null,{}, {...body,waist:49},{...body,hip:221},{...body,hipDepth:4},{...body,hipDepth:41},{...body,hip:NaN},{...body,hip:'100'},{...body,extra:true},Object.assign(Object.create({}),body)])assert.throws(()=>api.validateBodyMeasurements(b));let reads=0;assert.throws(()=>api.validateBodyMeasurements({...body,get hip(){reads++;return 100;}}));assert.equal(reads,0);
});
test('nominal body rings and circumference differences match independent geometry and short skirts do not extrapolate',()=>{
 assert.equal(typeof api.bodyMesh,'function');const mesh=api.bodyMesh(body);assert.equal(mesh.vertices.length,64);assert.equal(mesh.faces.length,32);for(const [i,v]of mesh.vertices.entries()){assert.ok(Math.abs(Math.hypot(v.x,v.z)*2*Math.PI-(i<32?76:100))<1e-10);assert.equal(v.y,i<32?0:20);}
 const h=Math.sqrt(60**2-(60/(2*Math.PI))**2),comparison=api.compareBody(draft,body);assert.equal(comparison.waistDifference,4);assert.ok(Math.abs(comparison.garmentHip!-(80+60*20/h))<1e-10);assert.ok(Math.abs(comparison.hipDifference!-(80+60*20/h-100))<1e-10);
 assert.equal(api.compareBody({...draft,slant:20},{...body,hipDepth:40}).hipDifference,null);assert.equal(api.compareBody(draft,{...body,hip:110}).hipDifference!<0,true);
 const svg=api.fittingSvg(draft,body,30,'#123456',true);assert.equal((svg.match(/data-body-face=/g)||[]).length,32);assert.equal((svg.match(/data-fit-garment=/g)||[]).length,32);assert.match(svg,/Measurement proxy/);assert.match(svg,/fill-opacity="0.35"/);
});
