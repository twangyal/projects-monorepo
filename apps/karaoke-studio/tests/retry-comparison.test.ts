import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRetry } from '../src/retry-comparison.ts';
const cue = (start:number,end:number,text:string) => ({start,end,text});
test('one-to-one retry comparison separates wording and timing without changing either reading', () => {
  const current = [cue(1,3,'Hello, WORLD!'),cue(5,7,'Keep these words')], retry = [cue(1,3,'hello world'),cue(5.2,7.1,'Change those words')];
  const before = structuredClone({current,retry}), result = compareRetry(current,retry,10);
  assert.deepEqual(result.lines[0], {referenceIndices:[0],wordingChanged:false,timingChanged:false,regrouped:false,different:false});
  assert.deepEqual(result.lines[1], {referenceIndices:[1],wordingChanged:true,timingChanged:true,regrouped:false,different:true});
  assert.deepEqual(result.missingReferenceIndices, []); assert.deepEqual({current,retry},before);
});
test('timing changes count even when wording stays the same and touching endpoints do not match', () => {
  const result = compareRetry([cue(0,2,'same'),cue(4,5,'omitted')],[cue(.1,2,'same'),cue(5,6,'new')],8);
  assert.equal(result.lines[0].wordingChanged,false); assert.equal(result.lines[0].timingChanged,true); assert.equal(result.lines[0].different,true);
  assert.deepEqual(result.lines[1].referenceIndices,[]); assert.equal(result.lines[1].wordingChanged,null);
  assert.deepEqual(result.missingReferenceIndices,[1]);
});
test('split and merged time matches are regrouping rather than a word-error judgment', () => {
  const split = compareRetry([cue(1,5,'one two three four')],[cue(1,3,'one two'),cue(3,5,'three four')],8);
  assert.ok(split.lines.every(line => line.regrouped && line.different && line.wordingChanged === null));
  const merged = compareRetry([cue(1,3,'one two'),cue(3,5,'three four')],[cue(1,5,'one two three four')],8);
  assert.equal(merged.lines[0].regrouped,true); assert.deepEqual(merged.lines[0].referenceIndices,[0,1]); assert.equal(merged.lines[0].wordingChanged,null);
});
test('case and punctuation normalize while meaningful word boundaries and accents remain', () => {
  const same = (a:string,b:string) => compareRetry([cue(1,2,a)],[cue(1,2,b)],3).lines[0].wordingChanged;
  assert.equal(same('I can’t go','i cant go!'),false);
  assert.equal(same('你好世界','你好 世界'),false); assert.equal(same('Hello世界','hello 世界'),false);
  assert.equal(same('こんにちは 世界','こんにちは世界'),false);
  assert.equal(same('the rapist','therapist'),true); assert.equal(same('café','cafe'),true);
  assert.equal(same('<img src=x>','literal text'),true);
});
test('an empty reading exposes all additions or omissions and validation bounds work', () => {
  assert.deepEqual(compareRetry([cue(1,2,'keep')],[],3).missingReferenceIndices,[0]);
  assert.equal(compareRetry([],[cue(1,2,'new')],3).lines[0].different,true);
  assert.throws(()=>compareRetry([cue(1,3,'first'),cue(2,4,'overlap')],[],5),/nonoverlapping/);
  assert.throws(()=>compareRetry([],Array.from({length:201},(_,i)=>cue(i,i+1,'word')),300),/200/);
  assert.throws(()=>compareRetry([],[cue(1,2,'x'.repeat(241))],3),/240/);
});
test('maximum-size comparisons remain bounded and preserve every exact match', () => {
  const cues = Array.from({length:200},(_,i)=>cue(i*2,i*2+1,'hello '.repeat(15).trim()));
  const result = compareRetry(cues,cues,600); assert.equal(result.lines.length,200); assert.ok(result.lines.every(line=>!line.different));
});
