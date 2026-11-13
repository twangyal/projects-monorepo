import test from 'node:test';
import assert from 'node:assert/strict';
import { template, TEMPLATES } from '../src/product.ts';
import { layoutPattern, patternSvg, patternDxf, validatePatternAllowance } from '../src/pattern-export.ts';
import { productTileLayouts, tiledProductPatternHtml } from '../src/product-print-pattern.ts';
import { buildOutfitBundle } from '../src/outfit-bundle.ts';
import { createProject } from '../src/model.ts';
import { gradedProduct } from '../src/size-grades.ts';
const width = (points:{x:number;y:number}[]) => Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x));
function unpack(bytes:Uint8Array) {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), result = new Map<string,string>(); let at=0;
  while (view.getUint32(at,true)===0x04034b50) {
    const size=view.getUint32(at+18,true), n=view.getUint16(at+26,true), extra=view.getUint16(at+28,true), start=at+30+n+extra;
    result.set(new TextDecoder().decode(bytes.subarray(at+30,at+30+n)),new TextDecoder().decode(bytes.subarray(start,start+size))); at=start+size;
  }
  return result;
}
test('allowance defaults to one cm and rejects invalid values before producing output', () => {
  assert.equal(validatePatternAllowance(),1);
  for(const n of [0,.625,1,1.5,2]) assert.equal(validatePatternAllowance(n),n);
  for(const n of [NaN,Infinity,-.01,2.01,'1',null]) {
    assert.throws(()=>validatePatternAllowance(n),/allowance/i);
    assert.throws(()=>patternSvg(template('blank'),n as number),/allowance/i);
    assert.throws(()=>tiledProductPatternHtml(template('blank'),'a4',n as number),/allowance/i);
  }
  assert.equal(patternSvg(template('blank')),patternSvg(template('blank'),1));
  assert.equal(patternDxf(template('blank')),patternDxf(template('blank'),1));
});
test('zero and custom cutting offsets preserve the finished sewing geometry for every base', () => {
  for(const item of TEMPLATES) {
    const product=template(item.id), before=structuredClone(product), zero=layoutPattern(product,0), narrow=layoutPattern(product,.5), wide=layoutPattern(product,1.5);
    for(let i=0;i<zero.pieces.length;i++) {
      assert.deepEqual(zero.pieces[i].cutting,zero.pieces[i].sewing);
      assert.ok(Math.abs(width(narrow.pieces[i].sewing)-width(wide.pieces[i].sewing))<1e-8);
      assert.ok(width(wide.pieces[i].cutting)>width(narrow.pieces[i].cutting));
      assert.ok(wide.pieces[i].cutting.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
      assert.deepEqual(wide.pieces[i].piece,zero.pieces[i].piece);
    }
    assert.deepEqual(product,before);
  }
});
test('graded individual formats and tiles label and use the actual allowance at full scale', () => {
  const product=gradedProduct(template('shirt'),'L');
  for(const allowance of [0,.625,2]) {
    assert.match(patternSvg(product,allowance),new RegExp(`${allowance} cm seam allowance`));
    assert.ok(patternDxf(product,allowance).includes(`${allowance} cm uniform seam allowance`));
    for(const paper of ['a4','letter'] as const) {
      const html=tiledProductPatternHtml(product,paper,allowance), layouts=productTileLayouts(product,paper,allowance);
      assert.ok(html.includes(`${allowance} cm seam allowance included`)); assert.match(html,/size L/); assert.match(html,/5 cm × 5 cm/);
      assert.ok(layouts.every(piece=>piece.detail.includes(`${allowance} cm uniform seam allowance`)));
    }
  }
});
test('outfit allowance propagates to every chosen grade and is recorded without changing the project', () => {
  const source={...createProject(),product:template('hoodie'),wornWith:template('blank'),wornAlso:template('trousers')}, before=structuredClone(source);
  const files=unpack(buildOutfitBundle(source,'2026-11-13','L',1.5)), manifest=JSON.parse(files.get('manifest.json')!);
  assert.equal(manifest.seamAllowanceCm,1.5); assert.equal(manifest.garments.length,3);
  for(const [index,product] of [source.product,source.wornWith,source.wornAlso].entries()) {
    const entry=manifest.garments[index], graded=gradedProduct(product,'L');
    assert.equal(files.get(entry.files.svg),patternSvg(graded,1.5)); assert.equal(files.get(entry.files.dxf),patternDxf(graded,1.5));
  }
  assert.match(files.get('README.txt')!,/1.5 cm/); assert.deepEqual(source,before);
  assert.throws(()=>buildOutfitBundle(source,'2026-11-13',undefined,Infinity),/allowance/i);
});
