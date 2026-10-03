import assert from 'node:assert/strict';
import test from 'node:test';
import { averageFeatures, featuresFromTags, tagsFromFeatures, validateFeatures } from '../src/features.ts';
import type { FeatureVector, OutfitPieces, Tags } from '../src/types.ts';
const tags: Tags = { palette: 'warm', fit: 'relaxed', style: 'classic', formality: 'smart' };
test('fixed one-hot feature contract round trips and detaches', () => {
  const vector = featuresFromTags(tags);
  assert.deepEqual(vector, [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual(tagsFromFeatures(vector), tags);
  assert.notEqual(validateFeatures(vector, 'tagged'), vector);
});
test('outfit features average actual ordered pieces without mutation', () => {
  const pieces = ['top', 'bottom', 'shoes'].map((category, index) => ({
    id: String(index + 1).padStart(32, '0'), name: category, category,
    tags: { ...tags, palette: index === 0 ? 'cool' : 'warm' }, photoId: null,
  })) as unknown as OutfitPieces;
  const before = structuredClone(pieces);
  const vector = averageFeatures(pieces);
  assert.deepEqual(vector.slice(0, 4), [0, 2 / 3, 1 / 3, 0]);
  assert.deepEqual(validateFeatures(vector, 'outfit'), vector);
  assert.deepEqual(pieces, before);
  assert.throws(() => tagsFromFeatures(vector), /one.hot|tagged/i);
  assert.throws(() => averageFeatures([pieces[1], pieces[0], pieces[2]]), /categor|order/i);
});
test('feature boundaries reject malformed, nonfinite and unrepresentable groups', () => {
  const good = featuresFromTags(tags);
  for (const value of [null, {}, [], [...good, 0], good.slice(1),
    good.map((v, i) => i === 0 ? NaN : v), good.map((v, i) => i === 0 ? Infinity : v),
    good.map((v, i) => i === 1 ? -1 : v), good.map((v, i) => i === 1 ? 0 : v),
    [0.5, 0.5, ...good.slice(2)], [1 / 3, 2 / 3, ...good.slice(2)],
  ]) assert.throws(() => validateFeatures(value, 'tagged'));
  assert.throws(() => validateFeatures([0.5, 0.5, ...good.slice(2)], 'outfit'));
  assert.throws(() => validateFeatures(good, 'invalid' as 'tagged'));
  for (const value of [null, { ...tags, palette: 'red' }, { ...tags, extra: true }, { palette: 'warm' }]) {
    assert.throws(() => featuresFromTags(value as Tags));
  }
  const thirds = [1 / 3, 2 / 3, ...good.slice(2)] as unknown as FeatureVector;
  assert.deepEqual(validateFeatures(thirds, 'outfit'), thirds);
});
