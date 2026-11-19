import test from 'node:test';
import assert from 'node:assert/strict';
import { keepSingers } from '../src/cue-edit.ts';
import { applyReviewedLine, applyReviewedPassage } from '../src/automatic-review.ts';
import type { Cue } from '../src/lyrics.ts';
const current = (): Cue[] => [{start:1,end:3,text:'Two words',wordStarts:[1.2,2.4],singer:1},{start:4,end:6,text:'Old words',singer:2}];
const rows = () => [{start:'1.000',end:'3',text:'Two words'},{start:'4',end:'6',text:'Better words'}];
test('unchanged reviewed cues inherit detached manual word starts independently of incoming singer choice', () => {
  const cues=current(), incoming: Cue[]=[{start:1,end:3,text:'Two words',singer:2},{start:4,end:6,text:'Better words'}];
  const result=keepSingers(cues,incoming);
  assert.deepEqual(result[0],{...cues[0],singer:2});assert.equal(result[1].singer,2);
  result[0].wordStarts![0]=1.5;assert.deepEqual(cues[0].wordStarts,[1.2,2.4]);assert.equal(incoming[0].wordStarts,undefined);
});
test('changed wording, boundaries and grouping cannot inherit stale hand timing; explicit incoming starts take precedence', () => {
  const cues=current();
  for(const cue of [{start:1,end:3,text:'Changed words'},{start:1.1,end:3,text:'Two words'},{start:1,end:3.1,text:'Two words'},{start:1,end:6,text:'Two words Old words'}]) assert.equal(keepSingers(cues,[cue])[0].wordStarts,undefined);
  const incoming={start:1,end:3,text:'Two words',wordStarts:[1.4,2.8]};
  const result=keepSingers(cues,[incoming])[0];assert.deepEqual(result.wordStarts,[1.4,2.8]);
  result.wordStarts![0]=1.7;assert.deepEqual(incoming.wordStarts,[1.4,2.8]);
  const bad=current();bad[0].wordStarts=[NaN,Infinity];assert.equal(keepSingers(bad,[{start:1,end:3,text:'Two words'}])[0].wordStarts,undefined);
});
test('actual one-line and mixed passage application keep exact unchanged hand-timed cues', () => {
  const cues=current(),draft=rows(),before=structuredClone({cues,draft});
  assert.deepEqual(applyReviewedLine(cues,draft,0,16).cues[0],cues[0]);
  const result=applyReviewedPassage(cues,draft,0,1,16);assert.equal(result.changed,true);
  assert.deepEqual(result.cues[0],cues[0]);assert.deepEqual(result.cues[1],{start:4,end:6,text:'Better words',singer:2});
  assert.deepEqual({cues,draft},before);
});
