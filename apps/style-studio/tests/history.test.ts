import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectHistory } from '../src/history.ts';
import { serializeProject } from '../src/domain.ts';
import { LIMITS, type Project } from '../src/types.ts';

function project(title = 'Initial'): Project {
  return {
    schemaVersion: 1, title, examples: [], looks: [], photos: [],
    pieces: [{ id: '1'.repeat(32), name: 'Shirt', category: 'top', photoId: null,
      tags: { palette: 'neutral', fit: 'regular', style: 'classic', formality: 'casual' } }],
  };
}

function largeProject(): Project {
  const bytes = Buffer.from([255, 216]);
  const parts: Buffer[] = [bytes];
  let remaining = LIMITS.photoBytes - 17;
  while (remaining) {
    const size = Math.min(remaining, 65537);
    const segment = Buffer.alloc(size);
    segment.set([255, 254]); segment.writeUInt16BE(size - 2, 2);
    parts.push(segment); remaining -= size;
  }
  parts.push(Buffer.from([255, 192, 0, 11, 8, 2, 208, 2, 208, 1, 1, 17, 0, 255, 217]));
  const dataUrl = `data:image/jpeg;base64,${Buffer.concat(parts).toString('base64')}`;
  const value = project('Large 0');
  value.photos = Array.from({ length: 20 }, (_, i) => ({
    id: (i + 100).toString(16).padStart(32, '0'), mime: 'image/jpeg', width: 720, height: 720, dataUrl,
  }));
  value.pieces = value.photos.map((photo, i) => ({
    ...project().pieces[0], id: (i + 1).toString(16).padStart(32, '0'),
    category: i < 7 ? 'top' : i < 14 ? 'bottom' : 'shoes', photoId: photo.id,
  }));
  return value;
}

test('initial state and current getter detach nested caller data', () => {
  const initial = project();
  const history = new ProjectHistory(initial);
  initial.title = 'Changed outside'; initial.pieces[0].tags.style = 'sporty';
  const current = history.current;
  current.pieces[0].name = 'Mutated getter'; current.pieces[0].tags.palette = 'bright';
  assert.equal(history.current.title, 'Initial');
  assert.equal(history.current.pieces[0].name, 'Shirt');
  assert.equal(history.current.pieces[0].tags.style, 'classic');
  assert.equal(history.current.pieces[0].tags.palette, 'neutral');
  assert.equal(history.canUndo, false); assert.equal(history.canRedo, false);
  assert.equal(history.undo(), null); assert.equal(history.redo(), null);
});

test('applied, undo and redo boundaries return detached snapshots', () => {
  const history = new ProjectHistory(project());
  const next = project('Second');
  assert.equal(history.apply(next), true);
  next.pieces[0].tags.fit = 'relaxed';
  assert.equal(history.current.pieces[0].tags.fit, 'regular');
  const undone = history.undo()!;
  undone.title = 'Mutated undo'; undone.pieces[0].name = 'Changed';
  assert.equal(history.current.title, 'Initial');
  assert.equal(history.current.pieces[0].name, 'Shirt');
  const redone = history.redo()!;
  redone.pieces[0].tags.style = 'playful';
  assert.equal(history.current.title, 'Second');
  assert.equal(history.current.pieces[0].tags.style, 'classic');
});

test('rejected and identical edits preserve current state and available redo', () => {
  const history = new ProjectHistory(project());
  history.apply(project('Second')); history.undo();
  assert.equal(history.apply(structuredClone(history.current)), false);
  assert.equal(history.canRedo, true);
  assert.throws(() => history.apply({ ...project('Invalid'), unexpected: true } as Project), /field|key|unknown|profile/i);
  assert.equal(history.current.title, 'Initial'); assert.equal(history.canUndo, false); assert.equal(history.canRedo, true);
  assert.equal(history.redo()!.title, 'Second');
});

test('editing after undo clears redo without retaining the abandoned future', () => {
  const history = new ProjectHistory(project());
  history.apply(project('Second')); history.apply(project('Third')); history.undo();
  assert.equal(history.apply(project('Replacement')), true);
  assert.equal(history.canRedo, false); assert.equal(history.redo(), null);
  assert.equal(history.undo()!.title, 'Second');
  assert.equal(history.redo()!.title, 'Replacement');
});

test('twenty total snapshots include current and trim the oldest undo states', () => {
  const history = new ProjectHistory(project('0'));
  for (let i = 1; i <= 25; i++) history.apply(project(String(i)));
  const titles = [history.current.title];
  while (history.canUndo) titles.push(history.undo()!.title);
  assert.equal(titles.length, LIMITS.historySnapshots);
  assert.equal(titles[0], '25'); assert.equal(titles.at(-1), '6');
  assert.equal(history.undo(), null);
  let redoCount = 0;
  while (history.canRedo) { history.redo(); redoCount++; }
  assert.equal(redoCount, LIMITS.historySnapshots - 1);
  assert.equal(history.current.title, '25');
});

test('photo-bearing snapshots trim to the serialized byte cap while retaining current', () => {
  const initial = largeProject();
  const bytes = new TextEncoder().encode(serializeProject(initial)).byteLength;
  const history = new ProjectHistory(initial);
  for (let i = 1; i < 10; i++) history.apply({ ...initial, title: `Large ${i}` });
  const retained: Project[] = [history.current];
  while (history.canUndo) retained.push(history.undo()!);
  assert.equal(retained[0].title, 'Large 9');
  assert.equal(retained.length, Math.min(10, Math.floor(LIMITS.historyBytes / bytes)));
  assert.ok(retained.length < LIMITS.historySnapshots);
  const total = retained.reduce((sum, value) => sum + new TextEncoder().encode(serializeProject(value)).byteLength, 0);
  assert.ok(total <= LIMITS.historyBytes);
  assert.ok(total + bytes > LIMITS.historyBytes);
});

test('invalid initial state is rejected', () => {
  assert.throws(() => new ProjectHistory({ ...project(), title: '' }), /title|name|character/i);
});
