import test from 'node:test';
import assert from 'node:assert/strict';
import { colourWord, designDifferences, nextVersionName } from '../src/design-diff.ts';
import { createProject, type Project } from '../src/model.ts';
import { optionsOf, template, withOptions } from '../src/product.ts';

const project = (product = template('shirt'), extra: Partial<Project> = {}): Project => ({ ...createProject(), title: 'Spring shirt', product, ...extra });

test('a saved copy and the current design are compared line by line, in plain words', () => {
  const saved = project();
  assert.deepEqual(designDifferences(saved, project()), []);
  const shirt = template('shirt');
  const changed = withOptions({ ...shirt, measurements: { ...shirt.measurements, chest: 112 }, parts: { ...shirt.parts, front: { ...shirt.parts.front, color: '#1f2a4f' } } },
    { ...optionsOf(shirt), chestPocket: false });
  const lines = designDifferences(saved, project(changed, { title: 'Spring shirt navy', wornWith: template('joggers') }));
  assert.deepEqual(lines, [
    'Name: “Spring shirt” → “Spring shirt navy”',
    'Chest: 108 → 112 cm',
    'Chest pocket: on → off',
    `Front body: Cotton poplin, ${colourWord(shirt.parts.front.color)} → Cotton poplin, navy`,
    'Chest pocket: removed',
    'Worn with: nothing → Joggers',
  ]);
  // A different garment is named as such.
  assert.ok(designDifferences(saved, project(template('bomber'))).includes('Garment: Button-up shirt → Bomber jacket'));
});

test('colours are named as the descriptions name them, and versions are numbered on from the last', () => {
  assert.equal(colourWord('#1f2a4f'), 'navy');
  assert.equal(nextVersionName('Oxford shirt', []), 'Oxford shirt · v1');
  assert.equal(nextVersionName('Oxford shirt', ['Oxford shirt · v1', 'oxford shirt · v4', 'Other · v9']), 'Oxford shirt · v5');
  assert.equal(nextVersionName('  ', []), 'Design · v1');
});
