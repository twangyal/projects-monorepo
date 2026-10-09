import test from 'node:test';
import assert from 'node:assert/strict';
import {skirtMesh,shellSvg,shellObj} from '../src/construction-3d.ts';
const d={kind:'flared-skirt' as const,waist:80,hem:140,slant:60};
test('assembled shell preserves exact measured circles and meridian seam lengths',()=>{
 const mesh=skirtMesh(d);assert.equal(mesh.vertices.length,64);assert.equal(mesh.faces.length,32);for(let i=0;i<32;i++){
  const a=mesh.vertices[i],b=mesh.vertices[i+32];assert.ok(Math.abs(Math.hypot(a.x,a.z)*2*Math.PI-80)<1e-10);assert.ok(Math.abs(Math.hypot(b.x,b.z)*2*Math.PI-140)<1e-10);assert.ok(Math.abs(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)-60)<1e-10);
 }assert.equal(mesh.vertices[0].y,0);assert.ok(Math.abs(mesh.vertices[32].y**2+(30/Math.PI)**2-3600)<1e-9);assert.deepEqual(mesh.seams,[[0,32],[16,48]]);assert.deepEqual(mesh.faces[31],[31,63,32,0]);
});
test('mesh and SVG projection are deterministic finite bounded and complete at all views',()=>{
 for(const yaw of [-360,-180,-90,0,90,180,360]){const svg=shellSvg(d,yaw,'#3f5468');assert.equal((svg.match(/<polygon /g)||[]).length,32);assert.equal((svg.match(/data-seam=/g)||[]).length,2);assert.doesNotMatch(svg,/NaN|Infinity|script|foreignObject|<image/);assert.equal(svg,shellSvg(d,yaw,'#3f5468'));assert.match(svg,/viewBox="0 0 480 360"/);}
 for(const angle of [NaN,Infinity,361])assert.throws(()=>shellSvg(d,angle,'#3f5468'));assert.throws(()=>shellSvg(d,0,'red" onclick="evil'));assert.throws(()=>skirtMesh({...d,slant:0}));
});
test('valid extreme drafts remain finite without changing source parameters',()=>{
 for(const v of [{...d,waist:50,hem:70,slant:20},{...d,waist:150,hem:155,slant:120},{...d,waist:50,hem:300,slant:120}]){const before=structuredClone(v),mesh=skirtMesh(v);for(const p of mesh.vertices)assert.ok(Number.isFinite(p.x+p.y+p.z));assert.deepEqual(v,before);assert.ok(shellSvg(v,45,'#d89476').length<20000);}
});
test('quad winding faces outward for downstream surface tools',()=>{
 const {vertices,faces}=skirtMesh(d);for(const face of faces){const [a,b,c]=face.map(i=>vertices[i]),u={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},v={x:c.x-a.x,y:c.y-a.y,z:c.z-a.z},normal={x:u.y*v.z-u.z*v.y,z:u.x*v.y-u.y*v.x};assert.ok(normal.x*a.x+normal.z*a.z>0);}
});
test('OBJ contains centimetre surface coordinates with safe indexed panel and seam groups',()=>{
 const obj=shellObj(d),lines=obj.split('\n'),vertices=lines.filter(l=>l.startsWith('v ')).map(l=>l.split(' ').slice(1).map(Number)),faces=lines.filter(l=>l.startsWith('f ')).map(l=>l.split(' ').slice(1).map(Number));assert.equal(vertices.length,64);assert.equal(faces.length,32);for(let i=0;i<32;i++){const a=vertices[i],b=vertices[i+32];assert.ok(Math.abs(Math.hypot(a[0],a[2])*2*Math.PI-80)<1e-5);assert.ok(Math.abs(Math.hypot(...a.map((v,j)=>v-b[j]))-60)<1e-5);}for(const face of faces){assert.equal(face.length,4);for(const index of face)assert.ok(Number.isInteger(index)&&index>=1&&index<=64);}assert.match(obj,/# Units: centimetres/);assert.match(obj,/g Front_Panel/);assert.match(obj,/g Back_Panel/);assert.match(obj,/l 1 33/);assert.match(obj,/l 17 49/);assert.doesNotMatch(obj,/mtllib|NaN|Infinity/);assert.equal(obj,shellObj(d));assert.throws(()=>shellObj({...d,slant:0}));
});
