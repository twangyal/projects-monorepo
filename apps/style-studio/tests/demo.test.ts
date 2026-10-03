import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoProject } from '../src/demo.ts';
import { validateProject } from '../src/domain.ts';

test('explicit demo is a valid original six-piece twelve-example profile with a detached saved look', () => {
  const demo = createDemoProject(); assert.deepEqual(validateProject(demo), demo);
  assert.equal(demo.pieces.length, 6); assert.equal(demo.examples.length, 12); assert.equal(demo.looks.length, 1); assert.deepEqual(demo.photos, []);
  for (const category of ['top', 'bottom', 'shoes']) assert.equal(demo.pieces.filter(piece => piece.category === category).length, 2);
  for (const label of ['like', 'pass']) assert.equal(demo.examples.filter(example => example.label === label).length, 6);
  assert.ok(demo.examples.every(example => /sample/i.test(example.caption)));
  assert.ok(new Set(demo.examples.map(example => JSON.stringify(example.features))).size > 2);
  demo.pieces[0].name = 'Edited'; assert.notEqual(demo.looks[0].pieces[0].name, 'Edited');
  assert.notEqual(createDemoProject().pieces[0].name, 'Edited');
});
