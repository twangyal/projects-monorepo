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

test('shared fitted body changes use named measurements and normalize automatic optional values', () => {
  const saved = project();
  const current = project(undefined, { topBody: { chest: 100, waist: 80, hip: 100, chestDepth: 22, height: 175, hipDepth: 21, upperArmGirth: 32, neckGirth: 38, underbust: 90, torsoLength: 45 } });
  assert.deepEqual(designDifferences(saved, current), [
    'Body chest girth: automatic → 100 cm', 'Body waist girth: automatic → 80 cm', 'Body hip girth: automatic → 100 cm',
    'Body chest depth: automatic → 22 cm', 'Body height: automatic → 175 cm', 'Body waist to hip: automatic → 21 cm',
    'Body upper-arm girth: automatic → 32 cm', 'Body neck girth: automatic → 38 cm', 'Body underbust girth: automatic → 90 cm',
    'Body shoulder to waist: automatic → 45 cm',
  ]);
  const basic = { chest: 100, waist: null, hip: null, chestDepth: null };
  assert.deepEqual(designDifferences(project(undefined, { topBody: basic }), project(undefined, { topBody: { ...basic, height: null, hipDepth: null, torsoLength: null, underbust: null, upperArmGirth: null, neckGirth: null } })), []);
  assert.deepEqual(designDifferences(current, saved), designDifferences(saved, current).map(line => line.replace(/automatic → (.+)$/, '$1 → automatic')));
});

test('body and worn-copy changes are compared even without an explicit edited product', () => {
  const saved = project(undefined, { product: undefined, wornWith: template('trousers') });
  const current = structuredClone(saved); current.topBody = { chest: 100, waist: null, hip: null, chestDepth: null };
  current.wornWith!.parts.front.color = '#1f2a4f';
  const before = structuredClone([saved, current]);
  const lines = designDifferences(saved, current);
  assert.equal(lines[0], 'Body chest girth: automatic → 100 cm');
  assert.ok(lines.some(line => /^Worn with · Front legs: .+ → .+, navy$/.test(line)));
  assert.deepEqual([saved, current], before);
});

test('both other outfit pieces reuse measurement, fit and styling comparisons without editing them', () => {
  const saved = project(template('hoodie'), { wornWith: template('blank'), wornAlso: template('trousers') });
  const current = structuredClone(saved);
  current.wornWith!.measurements = { ...current.wornWith!.measurements, chest: 108 };
  current.wornWith!.fit = { backNeckDrop: 4 };
  current.wornAlso!.parts.front = { ...current.wornAlso!.parts.front, color: '#1f2a4f', grainAngle: 45 };
  const before = structuredClone([saved, current]);
  const lines = designDifferences(saved, current);
  assert.ok(lines.some(line => /^Worn with · Chest: .+ → 108 cm$/.test(line)));
  assert.ok(lines.some(line => /Worn with · .*automatic → 4 cm/.test(line)));
  assert.ok(lines.some(line => /^And with · Front legs: .+ → .+, navy, grain 45°$/.test(line)));
  assert.deepEqual([saved, current], before);
});

test('a construction edit that renames a worn hoodie still shows its zip and colour changes', () => {
  const saved = project(template('blank'), { wornWith: template('hoodie') });
  saved.wornWith!.parts.front.color = '#1f2a4f';
  const current = structuredClone(saved);
  current.wornWith = withOptions(current.wornWith!, { ...optionsOf(current.wornWith!), zip: true });
  current.wornWith.parts.front.color = '#ffffff';
  const lines = designDifferences(saved, current);
  assert.ok(lines.includes('Worn with: Pullover hoodie → Zip hoodie'));
  assert.ok(lines.includes('Worn with · Front zip: off → on'));
  assert.ok(lines.some(line => /^Worn with · Front body: .+, navy → .+, white$/.test(line)));
  assert.equal(lines.filter(line => /Pullover hoodie → Zip hoodie/.test(line)).length, 1);
});
