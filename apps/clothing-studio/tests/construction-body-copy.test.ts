import test from 'node:test';
import assert from 'node:assert/strict';
import { productFromConstruction } from '../src/construction-product.ts';
import { createProject, validateProject, ProjectHistory, parseProject, serializeProject } from '../src/model.ts';
import { garmentBody } from '../src/garment-drape.ts';
const construction={kind:'flared-skirt' as const,waist:90,hem:190,slant:65};
const source={waist:76,hip:102,hipDepth:18.5};
const upper={chest:106,waist:88,hip:110,chestDepth:26,height:190,hipDepth:25};

test('copy carries applied skirt fitting and preserves upper body settings as one detached history step',()=>{
  const original=validateProject({...createProject(),construction,bodyMeasurements:source,topBody:upper});
  const before=structuredClone(original),next=productFromConstruction(original);
  assert.deepEqual(next.topBody,{chest:106,waist:76,hip:102,chestDepth:26,height:190,hipDepth:18.5});
  assert.deepEqual(next.bodyMeasurements,source);assert.deepEqual(next.construction,construction);assert.deepEqual(original,before);
  const history=new ProjectHistory(original);history.commit(next);
  assert.deepEqual(history.undo(),before);assert.deepEqual(history.redo(),next);
  assert.deepEqual(parseProject(serializeProject(next)),next);
  next.bodyMeasurements!.waist=80;assert.equal(next.topBody!.waist,76);assert.deepEqual(original,before);
  const body=garmentBody(next.product!,next.topBody!.chest,{waist:76,hip:102,hipDepth:18.5});
  assert.equal(body.waist,76);assert.equal(body.hip,102);assert.equal(body.landmarks!.waist!-body.landmarks!.hip!,18.5);
});
test('first explicit copied body establishes the product default chest without inventing upper measurements',()=>{
  const next=productFromConstruction({...createProject(),construction,bodyMeasurements:source});
  assert.deepEqual(next.topBody,{chest:102,waist:76,hip:102,chestDepth:null,hipDepth:18.5});
  assert.equal(Object.hasOwn(next.topBody!,'height'),false);
});
test('absent applied source body keeps target settings or absence exactly, including optional null values',()=>{
  const absent=productFromConstruction({...createProject(),construction});assert.equal(Object.hasOwn(absent,'topBody'),false);
  const body={chest:106,waist:null,hip:null,chestDepth:null,height:null,hipDepth:null};
  assert.deepEqual(productFromConstruction({...createProject(),construction,topBody:body}).topBody,body);
});
test('copied measurement extremes are kept and an incompatible waist refuses only the drape',()=>{
  const next=productFromConstruction({...createProject(),construction,bodyMeasurements:{waist:180,hip:220,hipDepth:40}});
  assert.ok(next.topBody,'the explicit body must be copied');assert.equal(next.topBody.waist,180);assert.equal(next.topBody!.hip,220);assert.equal(next.topBody!.hipDepth,40);
  assert.throws(()=>garmentBody(next.product!,next.topBody!.chest,{waist:180,hip:220,hipDepth:40}),/waist must be at least 1 cm smaller/);
  assert.deepEqual(next.product!.measurements,{waist:90,hem:190,slant:65});
  assert.throws(()=>productFromConstruction({...createProject(),construction,bodyMeasurements:{waist:76,hip:102,hipDepth:41}}),/hipDepth/);
});
