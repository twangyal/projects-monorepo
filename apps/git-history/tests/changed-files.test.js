import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChangedCatalog, changedPage, changedHandoff, changedHistoryHandoff, changedJson } from '../git_history/web/changed-files.js';
const l = 'a'.repeat(40), r = 'b'.repeat(40), x = 'c'.repeat(40), y = 'd'.repeat(40);
const endpoint = (object_id = x, mode = '100644', kind = 'regular') => ({ kind, mode, object_id });
const row = (path = 'src/literal\t\n<file>.txt') => ({ path, change: 'modified', left: endpoint(), right: endpoint(y), addressable: true });
const catalog = entries => ({ schema_version: 1, kind: 'changed-file-catalog', repo_name: 'repo', left_requested_ref: 'old', left_revision: l, right_requested_ref: 'new', right_revision: r, directory: '', entries: entries || [row()], omitted_non_utf8_paths: 0 });
test('complete literal catalog is detached, deeply immutable and keeps exact pins/metadata', () => {
  const original = catalog(), accepted = validateChangedCatalog(original); assert.deepEqual(accepted, original);
  original.entries[0].path = 'changed'; assert.equal(accepted.entries[0].path, 'src/literal\t\n<file>.txt'); assert.ok(Object.isFrozen(accepted.entries[0].left));
});
test('added/deleted and mode/type changes retain absence and cannot masquerade as unchanged', () => {
  for (const [change, left, right] of [['added', null, endpoint()], ['deleted', endpoint(), null], ['mode-changed', endpoint(), endpoint(x, '100755')], ['type-changed', endpoint(), endpoint(y, '120000', 'symlink')]]) assert.equal(validateChangedCatalog(catalog([{ ...row(), change, left, right }])).entries[0].change, change);
  assert.throws(() => validateChangedCatalog(catalog([{ ...row(), right: endpoint() }])));
  assert.throws(() => validateChangedCatalog(catalog([{ ...row(), change: 'mode-changed' }])));
  assert.throws(() => validateChangedCatalog(catalog([{ ...row(), left: endpoint(x, '120000') }])));
});
test('exact schema/UTF8 order/path/prefix/revision/bounds reject rather than repair', () => {
  for (const bad of [{ ...catalog(), extra: true }, { ...catalog(), schema_version: 2 }, { ...catalog(), left_revision: 'x' }, { ...catalog(), omitted_non_utf8_paths: 10000 }, { ...catalog(), directory: './src' }, { ...catalog(), directory: 'src', entries: [row('src-extra/a')] }, catalog([row('z'), row('a')]), catalog([row('a'), row('a')]), catalog([row('\ud800')]), catalog([row('x'.repeat(4097))]), catalog([{ ...row('\\root'), addressable: true }])]) assert.throws(() => validateChangedCatalog(bad));
});
test('UTF8 ordering differs from UTF16 and unsupported but valid literal paths stay visible', () => {
  const values = validateChangedCatalog(catalog([row('\ue000'), row('𐀀')])); assert.equal(values.entries.length, 2);
  const odd = validateChangedCatalog(catalog([{ ...row('\\literal'), addressable: false }])); assert.equal(odd.entries[0].path, '\\literal'); assert.equal(changedHandoff(odd, 0), null);
});
test('100-row paging/filtering preserves original global indices without repinning', () => {
  const values = validateChangedCatalog(catalog(Array.from({ length: 205 }, (_, i) => row(`file-${String(i).padStart(3, '0')}.txt`))));
  const page = changedPage(values, '', 'all', 1); assert.equal(page.rows.length, 100); assert.equal(page.rows[0].index, 100); assert.equal(page.total, 205);
  const filtered = changedPage(values, 'file-20', 'modified', 0); assert.equal(filtered.rows.length, 5); assert.equal(filtered.rows[0].index, 200); assert.equal(values.left_revision, l);
});
test('handoff uses only captured pins/exact path and explicit missing mode; special entries never load', () => {
  const added = validateChangedCatalog(catalog([{ ...row('a'), change: 'added', left: null }]));
  assert.deepEqual(changedHandoff(added, 0), { path: 'a', left: { revision: l, requested_ref: 'old', selection: 'missing' }, right: { revision: r, requested_ref: 'new', selection: 'whole' } });
  assert.equal(changedHandoff(validateChangedCatalog(catalog([{ ...row(), change: 'type-changed', left: endpoint(x, '120000', 'symlink') }])), 0), null);
});
test('JSON follows sorted schema keys/two spaces/newline and literal Unicode controls', () => {
  const value = validateChangedCatalog(catalog([])), json = changedJson(value);
  assert.equal(json, '{\n  "directory": "",\n  "entries": [],\n  "kind": "changed-file-catalog",\n  "left_requested_ref": "old",\n  "left_revision": "'+l+'",\n  "omitted_non_utf8_paths": 0,\n  "repo_name": "repo",\n  "right_requested_ref": "new",\n  "right_revision": "'+r+'",\n  "schema_version": 1\n}\n');
  assert.ok(changedJson(validateChangedCatalog(catalog())).includes('literal\\t\\n<file>'));
});
test('history handoff independently selects a present regular endpoint using immutable catalog pins', () => {
  const value = validateChangedCatalog(catalog());
  assert.deepEqual(changedHistoryHandoff(value, 0, 'left'), { path: row().path, revision: l, requested_ref: 'old' });
  assert.deepEqual(changedHistoryHandoff(value, 0, 'right'), { path: row().path, revision: r, requested_ref: 'new' });
  for (const index of [-1, 1, 0.5, '0']) assert.equal(changedHistoryHandoff(value, index, 'left'), null);
  assert.equal(changedHistoryHandoff(value, 0, 'other'), null);
  const added = validateChangedCatalog(catalog([{ ...row(), change: 'added', left: null }]));
  assert.equal(changedHistoryHandoff(added, 0, 'left'), null); assert.equal(changedHistoryHandoff(added, 0, 'right').revision, r);
  const deleted = validateChangedCatalog(catalog([{ ...row(), change: 'deleted', right: null }]));
  assert.equal(changedHistoryHandoff(deleted, 0, 'right'), null); assert.equal(changedHistoryHandoff(deleted, 0, 'left').revision, l);
  for (const endpoint of [ { kind: 'symlink', mode: '120000', object_id: x }, { kind: 'gitlink', mode: '160000', object_id: x } ]) {
    const changed = validateChangedCatalog(catalog([{ ...row(), change: 'type-changed', left: endpoint }]));
    assert.equal(changedHistoryHandoff(changed, 0, 'left'), null); assert.equal(changedHistoryHandoff(changed, 0, 'right').revision, r);
  }
  const literal = validateChangedCatalog(catalog([{ ...row('\\literal'), addressable: false }]));
  assert.equal(changedHistoryHandoff(literal, 0, 'right'), null);
});
test('catalog admission rejects coerced modes, zero revision IDs and impossible tree paths or equal-pin changes', () => {
  for (const bad of [catalog([{ ...row(), left: endpoint(x, 100644) }]), { ...catalog(), left_revision: '0'.repeat(40) }, catalog([{ ...row('/absolute'), addressable: false }]), catalog([{ ...row('a//b'), addressable: false }]), catalog([{ ...row('a/../b'), addressable: false }]), { ...catalog(), right_revision: l }]) assert.throws(() => validateChangedCatalog(bad));
});
