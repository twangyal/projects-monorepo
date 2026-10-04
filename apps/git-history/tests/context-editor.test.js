import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CONTEXT_BYTES, MAX_CONTEXT_RECORDS, ContextEditorError, createContextDraft,
  validateContextDraft, addContextRecord, updateContextRecord, removeContextRecord,
  rebindContextDraft, serializeContextDraft, evidenceCommits } from '../git_history/web/context-editor.js';

const revision = 'a'.repeat(40);
const commit = 'b'.repeat(40);
const record = (title = ' Literal <title> ') => ({ commit, url: 'https://github.com/owner/repo/pull/42#issuecomment-123',
  title, author: ' Attributed author ', excerpt: 'Exact\nexcerpt\twith "token" and <script>.' });
const draft = () => ({ schema_version: 1, revision, records: [record()] });

test('creates explicit empty revision-bound envelope and preserves literal ordered records', () => {
  assert.equal(MAX_CONTEXT_RECORDS, 50);
  assert.equal(MAX_CONTEXT_BYTES, 262144);
  assert.deepEqual(createContextDraft(revision), { schema_version: 1, revision, records: [] });
  const input = draft();
  const result = validateContextDraft(input);
  assert.deepEqual(result, input);
  assert.notEqual(result, input);
  assert.notEqual(result.records, input.records);
  assert.notEqual(result.records[0], input.records[0]);
  result.records[0].excerpt = 'Changed';
  assert.equal(input.records[0].excerpt, record().excerpt);
  assert.equal(serializeContextDraft(draft()), '{"schema_version": 1, "revision": "'+revision+'", "records": [{"commit": "'+commit+'", "url": "https://github.com/owner/repo/pull/42#issuecomment-123", "title": " Literal <title> ", "author": " Attributed author ", "excerpt": "Exact\\nexcerpt\\twith \\"token\\" and <script>."}]}');
});

test('ordered add/edit/remove/rebind are atomic, detached and never substitute a commit', () => {
  const input = draft();
  const nextRecord = record('Second');
  const next = addContextRecord(input, nextRecord);
  assert.deepEqual(next.records.map(value => value.title), [' Literal <title> ', 'Second']);
  nextRecord.title = 'Mutated';
  assert.equal(next.records[1].title, 'Second');
  const edited = updateContextRecord(next, 0, record('First edited'));
  assert.equal(edited.records[1].title, 'Second');
  const removed = removeContextRecord(edited, 0);
  assert.deepEqual(removed.records.map(value => value.title), ['Second']);
  assert.equal(rebindContextDraft(removed, 'c'.repeat(64)).revision, 'c'.repeat(64));
  assert.equal(rebindContextDraft(removed, 'c'.repeat(64)).records[0].commit, commit);
  assert.deepEqual(input, draft());
  for (const index of [-1, 1.5, 2, NaN, '0']) {
    assert.throws(() => updateContextRecord(input, index, record()));
    assert.throws(() => removeContextRecord(input, index));
  }
  assert.throws(() => addContextRecord(input, record('')));
  assert.deepEqual(input, draft());
});

test('50 records admit and51 refuse before publishing any modified input', () => {
  const input = { ...draft(), records: Array.from({ length: 50 }, () => record()) };
  assert.equal(validateContextDraft(input).records.length, 50);
  const before = JSON.stringify(input);
  assert.throws(() => addContextRecord(input, record()), /50/);
  assert.throws(() => validateContextDraft({ ...input, records: [...input.records, record()] }), /50/);
  assert.equal(JSON.stringify(input), before);
});

test('code-point limits admit astral text and reject malformed Unicode/control literals without leaking them', () => {
  const input = draft();
  for (const [field, maximum] of [['title', 300], ['author', 200], ['excerpt', 4000]]) {
    assert.doesNotThrow(() => updateContextRecord(input, 0, { ...record(), [field]: '🎵'.repeat(maximum) }));
    assert.throws(() => updateContextRecord(input, 0, { ...record(), [field]: '🎵'.repeat(maximum + 1) }));
    for (const text of ['', ' \n\t', '\u0085', '\ud800', '\udfff', 'private\rtext', 'secret\0text', 'private\u007ftext']) {
      assert.throws(() => updateContextRecord(input, 0, { ...record(), [field]: text }), error => {
        assert.ok(error instanceof ContextEditorError);
        assert.equal(error.recordIndex, 1);
        assert.equal(error.message.includes('private'), false);
        assert.equal(error.message.includes('secret'), false);
        return true;
      });
    }
    // Python str.strip does not strip BOM; mirror its nonblank semantics literally.
    assert.doesNotThrow(() => updateContextRecord(input, 0, { ...record(), [field]: '\ufeff' }));
  }
});

test('strict shape, full lowercase IDs and dense own records reject ambiguity without executing getters', () => {
  for (const id of ['', 'a'.repeat(39), 'A'.repeat(40), 'HEAD', 'a'.repeat(41), 'b'.repeat(63), 'a'.repeat(40) + '\n', 'b'.repeat(64) + '\u2028']) {
    assert.throws(() => createContextDraft(id));
    assert.throws(() => addContextRecord(draft(), { ...record(), commit: id }));
  }
  assert.doesNotThrow(() => addContextRecord(draft(), { ...record(), commit: 'b'.repeat(64) }));
  for (const value of [{ ...draft(), schema_version: true }, { ...draft(), entries: [] }, { ...draft(), records: new Array(1) },
    { ...draft(), records: [{ ...record(), source: 'Not a title' }] }]) assert.throws(() => validateContextDraft(value));
  let calls = 0;
  const item = record();
  Object.defineProperty(item, 'title', { enumerable: true, get() { calls++; return 'Title'; } });
  assert.throws(() => addContextRecord(draft(), item));
  assert.equal(calls, 0);
});

test('conservative safe URLs preserve accepted spelling and reject credentials, normalization tricks and wrong routes', () => {
  for (const url of ['https://github.com/o/r/issues/1#issuecomment-0', 'HTTPS://github.com/o/r/discussions/9#discussioncomment-0',
    'https://github.com/o/r/pull/1#discussion_r0', 'https://github.com/o/r/pull/1#pullrequestreview-0',
    'https://gitlab.com/group/nested/project/-/merge_requests/7#note_0', 'https://gitlab.com/g/p/-/issues/1']) {
    assert.equal(addContextRecord(draft(), { ...record(), url }).records[1].url, url);
  }
  for (const url of ['http://github.com/o/r/pull/1', 'https://user:secret@github.com/o/r/pull/1', 'https://github.com:443/o/r/pull/1',
    'https://GITHUB.COM/o/r/pull/1', 'https://github.com/o/r/pull/0', 'https://github.com/o/r/pull/01',
    'https://github.com/o/r/pull/1?', 'https://github.com/o/r/pull/1?q=x', 'https://github.com/o/r/pull/1#unknown',
    'https://github.com/o/r/pull/1%20', 'https://github.com/o/../pull/1', 'https://github.com/o/r/pull/1/',
    'https://gitlab.com/g/-/p/-/issues/1', 'https://gitlab.com/g/p/-/issues/1#issuecomment-1',
    'https://github.com/o/r\\pull/1', 'https://github.com/o/r/pull/1\u0085']) {
    assert.throws(() => addContextRecord(draft(), { ...record(), url }), error => {
      assert.equal(error.message.includes('secret'), false);
      return true;
    });
  }
});

test('canonical authoritative UTF8 byte ceiling is measured after spacing and literal Unicode, without truncation', () => {
  const input = { ...draft(), records: Array.from({ length: 50 }, () => ({ ...record(), excerpt: 'a'.repeat(4000) })) };
  assert.ok(new TextEncoder().encode(serializeContextDraft(input)).length < MAX_CONTEXT_BYTES);
  const huge = { ...input, records: input.records.map(value => ({ ...value, excerpt: '🎵'.repeat(4000) })) };
  assert.throws(() => validateContextDraft(huge), /256 KiB/);
  assert.throws(() => serializeContextDraft(huge), /256 KiB/);
  assert.equal(huge.records[0].excerpt.length, 8000);
});

test('picker uses only actual displayed full commit IDs in stable blame/change/rename order', () => {
  const c = 'c'.repeat(40);
  const d = 'd'.repeat(64);
  const report = { schema_version: 1, revision, blame: [{ commit }, { commit: c }, { commit }],
    changes: [{ commit: c }, { commit: d }], renames: [{ commit }, { commit: 'e'.repeat(40) }] };
  assert.deepEqual(evidenceCommits(report), [
    { commit, kind: 'blame', label: 'Blame evidence' },
    { commit: c, kind: 'blame', label: 'Blame evidence' },
    { commit: d, kind: 'change', label: 'Range-change evidence' },
    { commit: 'e'.repeat(40), kind: 'rename', label: 'Rename evidence' },
  ]);
  assert.deepEqual(evidenceCommits({ ...report, blame: [], changes: [], renames: [] }), []);
  assert.throws(() => evidenceCommits({ ...report, blame: [{ commit: 'HEAD' }] }));
  assert.throws(() => evidenceCommits({ ...report, schema_version: 2 }));
});


test('exact256KiB envelope admits andone further encoded byte refuses atomically', () => {
  const input = { ...draft(), records: Array.from({ length: 50 }, () => ({ ...record(), excerpt: 'a'.repeat(4000) })) };
  let remaining = MAX_CONTEXT_BYTES - new TextEncoder().encode(serializeContextDraft(input)).length;
  assert.ok(remaining > 0);
  for (const row of input.records) {
    const astral = Math.min(4000, Math.floor(remaining / 3));
    row.excerpt = '🎵'.repeat(astral) + 'a'.repeat(4000 - astral);
    remaining -= astral * 3;
  }
  input.records[0].author += 'x'.repeat(remaining);
  const accepted = serializeContextDraft(input);
  assert.equal(new TextEncoder().encode(accepted).length, MAX_CONTEXT_BYTES);
  assert.equal(validateContextDraft(input).records.length, 50);
  const before = JSON.stringify(input);
  assert.throws(() => updateContextRecord(input, 0, { ...input.records[0], author: input.records[0].author + 'x' }), /256 KiB/);
  assert.equal(JSON.stringify(input), before);
});
