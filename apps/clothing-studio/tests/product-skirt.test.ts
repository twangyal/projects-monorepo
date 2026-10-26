import { test } from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { template, validateProduct, patternPieces, teeMesh, garmentHeight, isBottoms, legMeasurements, topMeasurements } from '../src/product.ts';
import { buildTechPack, measurementDiagram } from '../src/techpack.ts';
import { patternSvg, patternDxf } from '../src/pattern-export.ts';

const skirt = () => template('flared-skirt');
test('skirt is a strict saved product with shared styles and no top/leg-only data', () => {
  const p = skirt();
  assert.equal(p.base, 'skirt'); assert.ok(isBottoms(p));
  assert.deepEqual(p.measurements, { waist:80, hem:140, slant:60 });
  assert.deepEqual(Object.keys(p.parts), ['front','back']);
  assert.deepEqual(validateProduct(JSON.parse(JSON.stringify(p))), p);
  assert.throws(() => topMeasurements(p)); assert.throws(() => legMeasurements(p));
  for (const measurements of [{waist:80,hem:81,slant:60},{waist:80,hem:300,slant:20},{waist:NaN,hem:140,slant:60},{waist:80,hem:140,slant:60,inseam:18}]) {
    assert.throws(() => validateProduct({...p,measurements}));
  }
  assert.throws(() => validateProduct({...p,fit:{}}));
  assert.throws(() => validateProduct({...p,neckline:'v'}));
});

test('skirt flat sectors and assembled surface preserve independent measured arcs and seams', () => {
  for (const m of [{waist:80,hem:140,slant:60},{waist:50,hem:300,slant:120},{waist:150,hem:155,slant:20}]) {
    const p=validateProduct({...skirt(),measurements:m}), pieces=patternPieces(p), meshes=teeMesh(p,Delaunator);
    assert.equal(pieces.length,2); assert.equal(meshes.length,2);
    const radial=(m.hem-m.waist)/(2*Math.PI), height=Math.sqrt(m.slant**2-radial**2);
    assert.ok(Math.abs(garmentHeight(p)-height)<1e-9);
    // Each panel's true area is half the frustum's lateral area; polygon approximates the arcs.
    for(const piece of pieces){assert.equal(piece.cutCount,1);assert.ok(Math.abs(piece.areaCm2-(m.waist+m.hem)*m.slant/4)/piece.areaCm2<0.002);}
    for(const mesh of meshes){
      assert.ok(mesh.positions.every(Number.isFinite)); assert.equal(mesh.uvs.length/2,mesh.positions.length/3);
      const ys=mesh.positions.filter((_,i)=>i%3===1);assert.ok(Math.abs(Math.min(...ys))<1e-9);assert.ok(Math.abs(Math.max(...ys)-height)<1e-9);
      // Each radial column joins the exact waist and hem radii; triangles face outside.
      for(let i=0;i<mesh.indices.length;i+=3){
        const [a,b,c]=mesh.indices.slice(i,i+3).map(n=>mesh.positions.slice(n*3,n*3+3));
        const u=b.map((v,k)=>v-a[k]),v=c.map((n,k)=>n-a[k]);
        const nx=u[1]*v[2]-u[2]*v[1],nz=u[0]*v[1]-u[1]*v[0];
        assert.ok(nx*(a[0]+b[0]+c[0])+nz*(a[2]+b[2]+c[2])>0);
      }
    }
    const a=meshes[0].positions,b=meshes[1].positions;
    const sideA=a.filter((_,i)=>Math.abs(a[i-i%3+2])<1e-8),sideB=b.filter((_,i)=>Math.abs(b[i-i%3+2])<1e-8);
    assert.deepEqual(sideA.map(n=>Math.abs(n)<1e-8?0:Math.round(n*1e7)).sort((a,b)=>a-b),sideB.map(n=>Math.abs(n)<1e-8?0:Math.round(n*1e7)).sort((a,b)=>a-b));
  }
});

test('skirt exports and tech pack use skirt measures without invented sleeves or elastic', () => {
  const p=skirt(),pack=buildTechPack(p,'2026-10-26');
  assert.equal(pack.base,'Flared skirt');
  assert.deepEqual(pack.poms.map(x=>x.name),['Waist circumference','Hem circumference','Side seam slant']);
  assert.equal(pack.poms[0].values.M,80);
  assert.ok(!JSON.stringify(pack).includes('elastic'));
  assert.match(measurementDiagram(p),/Measurement diagram/);
  assert.match(patternSvg(p),/Front body/); assert.match(patternDxf(p),/Back body/);
  // Existing templates remain valid after expanding the product schema.
  for(const id of ['blank','hoodie','trousers'])assert.deepEqual(validateProduct(template(id)),template(id));
});

test('skirt UVs follow flat centimetres and both mesh boundaries preserve measured circumferences',()=>{
  const p=skirt(),mesh=teeMesh(p,Delaunator)[0],m=p.measurements as {waist:number;hem:number;slant:number};
  const columns=64,rows=12;
  for(const [row,circumference] of [[0,m.waist],[rows,m.hem]]){
    for(let c=0;c<=columns;c++){
      const i=(row*(columns+1)+c)*3;
      assert.ok(Math.abs(Math.hypot(mesh.positions[i],mesh.positions[i+2])-circumference/(2*Math.PI))<1e-9);
    }
  }
  // The centre radial yarn is straight and is exactly the entered side slant in UV space.
  const a=(columns/2)*2,b=(rows*(columns+1)+columns/2)*2;
  assert.ok(Math.abs(Math.hypot(mesh.uvs[b]-mesh.uvs[a],mesh.uvs[b+1]-mesh.uvs[a+1])-m.slant)<1e-9);
  const pieces=patternPieces(p),inner=m.slant*m.waist/(m.hem-m.waist),angle=(m.hem-m.waist)/(2*m.slant);
  assert.ok(Math.abs(inner*angle-m.waist/2)<1e-9);
  const o=pieces[0].outline;
  const length=o.slice(0,97).reduce((n,v,i,arr)=>i?n+Math.hypot(v.x-arr[i-1].x,v.y-arr[i-1].y):0,0);
  assert.ok(Math.abs(length-m.waist/2)<0.002);
});

test('skirt measurement getters and inherited or symbol fields refuse without execution',()=>{
  let read=false;const measurements={hem:140,slant:60};Object.defineProperty(measurements,'waist',{enumerable:true,get(){read=true;return 80;}});
  assert.throws(()=>validateProduct({...skirt(),measurements}));assert.equal(read,false);
  assert.throws(()=>validateProduct({...skirt(),measurements:Object.assign(Object.create({waist:80}),{hem:140,slant:60})}));
  assert.throws(()=>validateProduct({...skirt(),measurements:{waist:80,hem:140,slant:60,[Symbol('extra')]:1}}));
});
