import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { HELD_OUT_2_SUITE, HELD_OUT_SUITE, SUITE, SUITE_VERSION, evaluateInterpreter } from '../src/web/instruction-suite.js';

test('the suites are well formed and do not overlap', () => {
  const said = new Set(SUITE.map(item => `${item.context}|${item.say.toLowerCase()}`));
  assert.equal(SUITE.length, 120);
  assert.equal(HELD_OUT_SUITE.length, 50);
  for (const item of HELD_OUT_SUITE) assert.equal(said.has(`${item.context}|${item.say.toLowerCase()}`), false, item.say);
  const earlier = new Set([...SUITE, ...HELD_OUT_SUITE].map(item => item.say.toLowerCase()));
  assert.equal(HELD_OUT_2_SUITE.length, 50);
  for (const item of HELD_OUT_2_SUITE) assert.equal(earlier.has(item.say.toLowerCase()), false, item.say);
});

test('the rule interpreter never performs a wrong page action on either suite', () => {
  for (const [suite, name] of [[SUITE, SUITE_VERSION], [HELD_OUT_SUITE, `${SUITE_VERSION}-held-out`]]) {
    const { summary, results } = evaluateInterpreter(interpret, suite, name);
    assert.equal(summary.unsafe, 0, JSON.stringify(results.filter(result => result.outcome === 'unsafe')));
  }
});

test('accuracy does not regress below the recorded 2026-10-12 measurements', () => {
  assert.equal(evaluateInterpreter(interpret).summary.correct, 120);
  assert.ok(evaluateInterpreter(interpret, HELD_OUT_SUITE, 'held-out').summary.correct >= 34);
});

test('a broken interpreter is scored as unsafe or abstaining, never crashing the evaluation', () => {
  const wrong = evaluateInterpreter(() => ({ type: 'activate', targetId: 99 }));
  assert.equal(wrong.summary.correct, 0);
  assert.equal(wrong.summary.unsafe, SUITE.length);
  const throwing = evaluateInterpreter(() => { throw new Error('model offline'); });
  assert.equal(throwing.summary.abstained, SUITE.length);
});

test('wrong checkbox range and selection actions are unsafe rather than abstentions in both scorers', async () => {
  const {evaluateInterpreterAsync}=await import('../src/web/instruction-suite.js');
  const suite=[{id:1,category:'state',context:'form',say:'check send me a copy',expected:{type:'check',targetId:4,checked:true}}];
  for(const wrong of [{type:'check',targetId:4,checked:false},{type:'check',targetId:1,checked:true},{type:'range',targetId:4,value:20},{type:'select-text',targetId:3,position:'all'}]){
    for(const result of [evaluateInterpreter(()=>wrong,suite),await evaluateInterpreterAsync(async()=>wrong,suite)]){
      assert.equal(result.summary.unsafe,1,JSON.stringify(wrong));assert.equal(result.summary.abstained,0);
    }
  }
});
