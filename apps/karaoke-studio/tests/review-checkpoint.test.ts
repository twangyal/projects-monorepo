import test from 'node:test';
import assert from 'node:assert/strict';
import { readReviewCheckpoint, serializeReviewCheckpoint, reviewCheckpointBinding } from '../src/review-checkpoint.ts';

const binding = 'a'.repeat(64);
const draft = [{ start: '', end: ' 4e0 ', text: 'Unfinished\ncorrection 🎵', excluded: true }, { start: '5', end: '8', text: 'Keep this phrase' }];
test('a checkpoint preserves literal unfinished drafts, exclusions and checked decisions without sharing data', () => {
  const text = serializeReviewCheckpoint(binding, draft, [0, 1]);
  const result = readReviewCheckpoint(text, binding, 2);
  assert.deepEqual(result, { draft, checked: [0, 1] });
  result.draft[0].text = 'Later'; assert.equal(draft[0].text, 'Unfinished\ncorrection 🎵');
});
test('checkpoint binding changes with clip, source, duration or original recognition', async () => {
  const original = { model: 'fixture', cues: [{ start: 1, end: 4, text: 'Original' }] };
  const key = await reviewCheckpointBinding('clip-one', 16, 'reference', original);
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(await reviewCheckpointBinding('clip-one', 16, 'reference', structuredClone(original)), key);
  for (const args of [['clip-two',16,'reference',original],['clip-one',15,'reference',original],['clip-one',16,'candidate',original],['clip-one',16,'passage',original],['clip-one',16,'reference',{ ...original, model: 'other' }],['clip-one',16,'reference',{ ...original, cues: [{start:1,end:4,text:'New reading'}] }]] as const) {
    assert.notEqual(await reviewCheckpointBinding(args[0], args[1], args[2], args[3]), key);
  }
});
test('different recognition bindings and row counts refuse before returning any draft', () => {
  const text = serializeReviewCheckpoint(binding, draft, [1]);
  assert.throws(() => readReviewCheckpoint(text, 'b'.repeat(64), 2), /matching|recognition|different/i);
  assert.throws(() => readReviewCheckpoint(text, binding, 1));
});
test('malformed and excessive checkpoint data refuse atomically', () => {
  const good = JSON.parse(serializeReviewCheckpoint(binding, draft, [1]));
  for (const bad of [{...good,version:2},{...good,extra:true},{...good,checked:[1,1]},{...good,checked:[-1]},{...good,checked:[2]},
    {...good,draft:[{...draft[0],start:1},draft[1]]},{...good,draft:[{...draft[0],excluded:'yes'},draft[1]]},
    {...good,draft:[{...draft[0],extra:true},draft[1]]},{...good,draft:[{...draft[0],text:'x'.repeat(2049)},draft[1]]},
    {...good,draft:[{...draft[0],end:'0'.repeat(65)},draft[1]]}]) assert.throws(() => readReviewCheckpoint(JSON.stringify(bad), binding, 2));
  for (const bad of ['{', 'null', '[]', ' '.repeat(1048577)]) assert.throws(() => readReviewCheckpoint(bad, binding, 2));
  assert.deepEqual(draft[0], {start:'',end:' 4e0 ',text:'Unfinished\ncorrection 🎵',excluded:true});
  assert.throws(() => serializeReviewCheckpoint(binding, Array.from({length:201},()=>draft[0]), []));
});
