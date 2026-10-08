import test from 'node:test';
import assert from 'node:assert/strict';
import { LyricHistory, type LyricDraft } from '../src/draft-history.ts';

function draft(title = 'Practice'): LyricDraft {
  return { title, cues: [{ start: 0, end: 1, text: 'First' }], pastedText: 'First', pastedDirty: false };
}

test('undo restores removed lines and redo restores the edited draft without aliasing caller data', () => {
  const original = draft(), history = new LyricHistory(original), removed = draft();
  removed.cues = [];
  history.record(removed);
  removed.title = 'Changed elsewhere'; original.cues[0].text = 'Changed elsewhere';
  assert.equal(history.canUndo, true);
  assert.deepEqual(history.undo(), draft());
  assert.equal(history.dirty, false);
  const redone = history.redo()!;
  assert.deepEqual(redone.cues, []);
  redone.title = 'Changed outside history';
  assert.equal(history.current.title, 'Practice');
  assert.equal(history.dirty, true);
});

test('a new edit after undo discards redo, but a duplicate input does not', () => {
  const history = new LyricHistory(draft());
  history.record(draft('Second')); history.record(draft('Third')); history.undo();
  history.record(draft('Second'));
  assert.equal(history.canRedo, true);
  history.record(draft('Different'));
  assert.equal(history.canRedo, false);
  assert.equal(history.redo(), null);
  assert.equal(history.undo()!.title, 'Second');
});

test('history retains the latest 30 edits while remembering the saved baseline independently', () => {
  const history = new LyricHistory(draft());
  for (let i = 1; i <= 45; i++) history.record(draft(`Edit ${i}`));
  let count = 0;
  while (history.canUndo) { history.undo(); count++; }
  assert.equal(count, 30);
  assert.equal(history.current.title, 'Edit 15');
  assert.equal(history.dirty, true);
  history.record(draft());
  assert.equal(history.dirty, false);
});

test('invalid empty timing fields survive undo and redo instead of becoming zero or null', () => {
  const history = new LyricHistory(draft()), invalid = draft();
  invalid.cues[0].start = NaN;
  history.record(invalid); history.record(draft('Correction'));
  assert.ok(Number.isNaN(history.undo()!.cues[0].start));
  assert.equal(history.dirty, true);
  history.record(invalid);
  assert.equal(history.canRedo, true);
  history.undo();
  assert.equal(history.dirty, false);
  assert.ok(Number.isNaN(history.redo()!.cues[0].start));
});

test('raw pasted text and its unsaved guard are reversible independently of saved cues', () => {
  const history = new LyricHistory(draft()), pasted = draft();
  pasted.pastedText = 'New words'; pasted.pastedDirty = true;
  history.record(pasted);
  assert.equal(history.dirty, false);
  const generated = { ...pasted, cues: [{ start: 0, end: 1, text: 'New words' }], pastedDirty: false };
  history.record(generated);
  assert.deepEqual(history.undo(), pasted);
  assert.deepEqual(history.undo(), draft());
  assert.deepEqual(history.redo(), pasted);
});

test('typing in one field forms a single edit until blur or another operation', () => {
  const history = new LyricHistory(draft());
  history.record(draft('P'), 'title'); history.record(draft('Pa'), 'title'); history.record(draft('Party'), 'title');
  history.endGroup(); history.record(draft('Party tonight'), 'title');
  assert.equal(history.undo()!.title, 'Party');
  assert.equal(history.undo()!.title, 'Practice');
  assert.equal(history.canUndo, false);
  assert.equal(history.redo()!.title, 'Party');
  history.record(draft('New branch'), 'title');
  assert.equal(history.undo()!.title, 'Party');
});

test('different input fields and explicit actions do not merge typing groups', () => {
  const history = new LyricHistory(draft()), cueEdit = draft('Title edit');
  history.record(cueEdit, 'title'); cueEdit.cues[0].text = 'New lyric';
  history.record(cueEdit, 'cue'); history.record(draft('Action'));
  assert.equal(history.undo()!.cues[0].text, 'New lyric');
  assert.equal(history.undo()!.cues[0].text, 'First');
  assert.equal(history.undo()!.title, 'Practice');
});

test('a no-op explicit action still ends a typing group without discarding redo', () => {
  const history = new LyricHistory(draft());
  history.record(draft('First edit'), 'title');
  history.record(draft('First edit'));
  history.record(draft('Second edit'), 'title');
  assert.equal(history.undo()!.title, 'First edit');
  history.record(draft('First edit'));
  assert.equal(history.canRedo, true);
});

test('a fresh saved baseline has no history, and identical drafts do not add edits', () => {
  const history = new LyricHistory(draft('Saved revision'));
  history.record(draft('Saved revision'));
  assert.equal(history.dirty, false);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
  assert.equal(history.undo(), null);
});

test('raw timing spellings are reversible editor state without changing numeric saved equality', () => {
  const original = { ...draft(), rawTimings: [{ start: 0, end: 1, startText: '00.000', endText: '001.0' }] };
  const history = new LyricHistory(original);
  history.record({ ...original, rawTimings: [{ start: 0, end: 1, startText: '0', endText: '1' }] });
  assert.equal(history.canUndo, true);
  assert.equal(history.dirty, false);
  assert.deepEqual(history.undo(), original);
  assert.equal(history.dirty, false);
  const canonical = history.redo() as typeof original;
  assert.equal(canonical.rawTimings[0].startText, '0');
  canonical.rawTimings[0].startText = 'outside';
  assert.equal((history.current as typeof original).rawTimings[0].startText, '0');
});

test('an unchanged raw timing snapshot preserves redo and exact fractional values', () => {
  const original = { ...draft(), cues: [{ start: 1 / 3, end: 1, text: 'First' }], rawTimings: [{ start: 1 / 3, end: 1, startText: String(1 / 3), endText: '001.0' }] };
  const history = new LyricHistory(original);
  history.record({ ...original, cues: [{ start: .333, end: .875, text: 'Imported' }], rawTimings: [{ start: .333, end: .875, startText: '.333', endText: '.875' }] });
  assert.deepEqual(history.undo(), original);
  history.record(original);
  assert.equal(history.canRedo, true);
  assert.equal(history.current.cues[0].start, 1 / 3);
  assert.equal(history.redo()!.cues[0].start, .333);
});
