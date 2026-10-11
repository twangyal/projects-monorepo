import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../src/model.ts';
import { History } from '../src/history.ts';

function project() {
  return model.createProject(model.createImageAsset({width:1,height:1,rgba:new Uint8ClampedArray([123,45,67,0])}, {fileName:'art.png',format:'png',width:1,height:1}));
}
test('named applied variants survive JSON and reversible edits without duplicating or changing artwork', () => {
  const original = project();
  const retained = model.validateProject({...original, variants:[{name:'Warm <study>',settings:{...original.settings,colorA:'#ff0000'}}]});
  assert.deepEqual(model.parseProjectJson(model.serializeProject(retained)),retained);
  assert.equal(retained.image.rgba, original.image.rgba);
  assert.equal(model.serializeProject(retained).split(original.image.rgba).length,2);
  const history = new History(original); history.commit(retained);
  assert.deepEqual(history.current,retained); assert.deepEqual(history.undo(),original); assert.deepEqual(history.redo(),retained);
  assert.deepEqual(model.updateProject(retained,{title:'Changed',settings:original.settings}).variants,retained.variants);
  assert.equal(Object.hasOwn(model.validateProject(original),'variants'),false);
});
test('variant admission is bounded, detached and rejects malformed names/settings or executable descriptors', () => {
  const original = project(), variant={name:'Warm',settings:{...original.settings}};
  const admitted=model.validateProject({...original,variants:[variant]});variant.settings.border=0;
  assert.equal(admitted.variants![0]!.settings.border,48);
  for(const variants of [null,{},[...Array(13)].map((_,i)=>({...variant,name:String(i)})),[variant,variant],[{...variant,name:' '}],[{...variant,name:'x\n'}],[{...variant,name:'x'.repeat(81)}],[{...variant,extra:true}],[{...variant,settings:{...variant.settings,border:129}}]]) assert.throws(()=>model.validateProject({...original,variants}));
  let calls=0; const values=[variant];Object.defineProperty(values,'0',{get(){calls++;return variant;},enumerable:true});
  assert.throws(()=>model.validateProject({...original,variants:values}));assert.equal(calls,0);
  const getter={...original};Object.defineProperty(getter,'variants',{get(){calls++;return [];},enumerable:true});
  assert.throws(()=>model.validateProject(getter));assert.equal(calls,0);
});
