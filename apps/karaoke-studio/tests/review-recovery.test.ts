import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRecoveryRecord, parseRecoveryRecord, readRecoveryDraft, MAX_RECOVERY_RECORDS } from '../src/review-recovery-store.ts';

const binding = 'a'.repeat(64), rows = [{ start: '', end: ' 4e0 ', text: 'Unfinished 🎵\nwords', excluded: true }, { start: '5.00', end: '8', text: 'Keep me' }];
const make = () => makeRecoveryRecord('clip-one', 'reference', binding, rows, [0, 1]);

test('a private recovery record keeps raw checkpoint fields and exact reading identity', () => {
  const record = make();
  assert.equal(record.projectId, 'clip-one'); assert.equal(record.binding, binding); assert.equal(record.source, 'reference');
  assert.equal(MAX_RECOVERY_RECORDS, 20);
  assert.deepEqual(parseRecoveryRecord(structuredClone(record), 'clip-one'), record);
  const recovered = readRecoveryDraft(record, binding, 2);
  assert.deepEqual(recovered, { draft: rows, checked: [0, 1] });
  recovered.draft[0].text = 'Changed'; assert.equal(rows[0].text, 'Unfinished 🎵\nwords');
  assert.notEqual(make().revision, record.revision);
});

test('another clip, reading or row graph cannot be restored into this review', () => {
  const record = make();
  assert.throws(() => parseRecoveryRecord(record, 'clip-two'));
  assert.throws(() => readRecoveryDraft(record, 'b'.repeat(64), 2), /matching|reading/i);
  assert.throws(() => readRecoveryDraft(record, binding, 1));
});

test('recovery metadata and checkpoint bounds refuse malformed copies without normalizing drafts', () => {
  const record = make();
  for (const changed of [null, [], {...record,version:2}, {...record,extra:true}, {...record,source:'other'}, {...record,binding:'x'},
    {...record,revision:''}, {...record,savedAt:NaN}, {...record,count:201}, {...record,checkpoint:'{}'}, {...record,checkpoint:' '.repeat(1048577)}]) {
    assert.throws(() => parseRecoveryRecord(changed, 'clip-one'));
  }
  assert.throws(() => makeRecoveryRecord('clip-one','reference',binding,[{...rows[0],text:'x'.repeat(2049)}],[]));
  assert.deepEqual(rows[0], { start: '', end: ' 4e0 ', text: 'Unfinished 🎵\nwords', excluded: true });
});
