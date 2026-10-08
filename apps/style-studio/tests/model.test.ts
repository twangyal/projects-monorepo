import assert from 'node:assert/strict';
import test from 'node:test';
import { featuresFromTags } from '../src/features.ts';
import { assessOutfit, generateAlternatives, scorePreference, trainPreferenceModel } from '../src/model.ts';
import type { FeatureVector, Label, ModelResult, Piece, PreferenceExample, Tags, TrainedModel } from '../src/types.ts';
const id = (n: number) => n.toString(16).padStart(32, '0');
const base: Tags = { palette: 'neutral', fit: 'regular', style: 'classic', formality: 'casual' };
const vector = (tags: Partial<Tags> = {}) => featuresFromTags({ ...base, ...tags });
const example = (n: number, label: Label, tags: Partial<Tags> = {}): PreferenceExample => ({
  id: id(n), caption: `Example ${n}`, label, origin: 'tagged', features: vector(tags), photoId: null, sourceLookId: null,
});
function trained(examples: PreferenceExample[]): TrainedModel {
  const result = trainPreferenceModel(examples);
  assert.equal(result.status, 'trained');
  return result;
}
function paletteLessons(): PreferenceExample[] {
  return ['fitted', 'regular'].flatMap((fit, f) => ['minimal', 'classic', 'sporty'].flatMap((style, s) => [
    example(1 + f * 6 + s * 2, 'like', { palette: 'warm', fit: fit as Tags['fit'], style: style as Tags['style'] }),
    example(2 + f * 6 + s * 2, 'pass', { palette: 'cool', fit: fit as Tags['fit'], style: style as Tags['style'] }),
  ]));
}
const piece = (n: number, category: Piece['category'], tags: Partial<Tags> = {}): Piece => ({
  id: id(n), name: `Piece ${n}`, category, tags: { ...base, ...tags }, photoId: null,
});
test('cold start counts actual labels and never manufactures scores', () => {
  for (const examples of [[], Array.from({ length: 7 }, (_, i) => example(i, i < 3 ? 'like' : 'pass')),
    Array.from({ length: 8 }, (_, i) => example(i, i < 2 ? 'like' : 'pass'))]) {
    const result = trainPreferenceModel(examples);
    assert.equal(result.status, 'insufficient');
    assert.equal(result.counts.total, examples.length);
    assert.equal(result.counts.likes, examples.filter(e => e.label === 'like').length);
    assert.equal(assessOutfit(vector(), result), null);
    if (result.status === 'insufficient') assert.match(result.reason, /8.*3|three.*eight/i);
  }
});
test('learner generalizes a synthetic preference to held-out combinations deterministically', () => {
  const examples = paletteLessons(); const before = structuredClone(examples); const model = trained(examples);
  const warm = vector({ palette: 'warm', fit: 'relaxed', style: 'playful', formality: 'formal' });
  const cool = vector({ palette: 'cool', fit: 'relaxed', style: 'playful', formality: 'formal' });
  assert.ok(!examples.some(e => JSON.stringify(e.features) === JSON.stringify(warm)));
  assert.ok(scorePreference(warm, model).score > 70);
  assert.ok(scorePreference(cool, model).score < 30);
  assert.equal(model.steps, 600);
  assert.ok(Number.isFinite(model.loss) && model.loss < Math.log(2));
  assert.deepEqual(model.counts, { total: 12, likes: 6, passes: 6 });
  assert.deepEqual(examples, before);
  assert.deepEqual(trainPreferenceModel([...examples].reverse()), model);
  assert.deepEqual(assessOutfit(warm, model), scorePreference(warm, model));
});
test('correcting real labels reverses held-out predictions instead of using fashion rules', () => {
  const lessons = paletteLessons();
  const corrected = lessons.map(e => ({ ...e, label: (e.label === 'like' ? 'pass' : 'like') as Label }));
  const probe = vector({ palette: 'warm', fit: 'relaxed', style: 'playful' });
  assert.ok(scorePreference(probe, trained(lessons)).score > 70);
  assert.ok(scorePreference(probe, trained(corrected)).score < 30);
});
test('class balance prevents majority-count bias and objective includes L2', () => {
  const neutral = trained([...Array.from({ length: 4 }, (_, i) => example(i, 'like')),
    ...Array.from({ length: 16 }, (_, i) => example(i + 4, 'pass'))]);
  assert.equal(scorePreference(vector(), neutral).score, 50);
  assert.ok(Math.abs(neutral.loss - Math.log(2)) < 1e-12);
  const model = trained(paletteLessons()); let loss = 0;
  for (const e of paletteLessons()) {
    const z = model.intercept + e.features.reduce((s, v, i) => s + v * model.weights[i], 0);
    const y = e.label === 'like' ? 1 : 0;
    loss += (Math.max(z, 0) - z * y + Math.log1p(Math.exp(-Math.abs(z)))) / 12;
  }
  loss += .05 * model.weights.reduce((s, w) => s + w * w, 0);
  assert.ok(Math.abs(loss - model.loss) < 1e-12);
});
test('contributions explain largest present signed terms with stable ties', () => {
  const model = trained(paletteLessons());
  const custom = { ...model, intercept: 0, weights: [2, 0, 0, 0, 0, -2, 0, 0, 1, 0, 0, .5, 0, 0] };
  const result = scorePreference(vector(), custom);
  assert.equal(result.score, Math.round(100 / (1 + Math.exp(-1.5))));
  assert.deepEqual(result.contributions.map(c => c.index), [0, 5, 8]);
  assert.deepEqual(result.contributions.map(c => c.contribution), [2, -2, 1]);
  assert.equal(result.contributions[0].name, 'palette:neutral');
  assert.deepEqual(scorePreference(vector(), { ...model, weights: Array(14).fill(0) }).contributions, []);
});
test('training and scoring reject nonfinite and invalid external inputs', () => {
  const lessons = paletteLessons();
  for (const bad of [null, Array(81).fill(lessons[0]), [...lessons, lessons[0]],
    lessons.map((e, i) => i ? e : { ...e, label: 'maybe' }),
    lessons.map((e, i) => i ? e : { ...e, id: 'short' }),
    lessons.map((e, i) => i ? e : { ...e, features: Array(14).fill(NaN) })]) {
    assert.throws(() => trainPreferenceModel(bad as PreferenceExample[]));
  }
  const model = trained(lessons);
  for (const bad of [{ ...model, intercept: NaN }, { ...model, weights: [1] },
    { ...model, weights: Array(14).fill(Infinity) }, { ...model, likedCentroid: Array(14).fill(NaN) }]) {
    assert.throws(() => scorePreference(vector(), bad as TrainedModel));
  }
  assert.throws(() => assessOutfit(Array(14).fill(NaN) as unknown as FeatureVector, trainPreferenceModel([])));
});
test('cold alternatives are deterministic unranked ideas with hard occasion rules', () => {
  const wardrobe = [piece(3, 'shoes'), piece(1, 'top'), piece(2, 'bottom')]; const cold = trainPreferenceModel([]);
  const result = generateAlternatives(wardrobe, cold, { mode: 'explore', occasion: 'casual' });
  assert.equal(result.ranked, false); assert.equal(result.eligibleCount, 1);
  assert.deepEqual(result.candidates[0].pieceIds, [id(1), id(2), id(3)]);
  assert.deepEqual([result.candidates[0].taste, result.candidates[0].novelty, result.candidates[0].rankScore], [null, null, null]);
  assert.match(result.reason ?? '', /unranked|not.*personal/i);
  for (const occasion of ['smart', 'formal'] as const) {
    const excluded = generateAlternatives(wardrobe, cold, { mode: 'match', occasion });
    assert.equal(excluded.eligibleCount, 0); assert.match(excluded.reason ?? '', /occasion|eligible/i);
  }
  const smart = wardrobe.map(p => ({ ...p, tags: { ...p.tags, formality: 'smart' as const } }));
  assert.equal(generateAlternatives(smart, cold, { mode: 'match', occasion: 'casual' }).eligibleCount, 0);
  assert.equal(generateAlternatives(smart, cold, { mode: 'match', occasion: 'smart' }).eligibleCount, 1);
});
test('exploration uses declared novelty rule and differs from learned matching', () => {
  const model = trained(paletteLessons());
  const wardrobe = (['top', 'bottom', 'shoes'] as const).flatMap((category, i) => [
    piece(i * 2 + 1, category, { palette: 'warm', fit: 'fitted', style: 'classic' }),
    piece(i * 2 + 2, category, { palette: 'cool', fit: 'relaxed', style: 'playful', formality: 'formal' }),
  ]);
  const match = generateAlternatives(wardrobe, model, { mode: 'match', occasion: 'any' });
  const explore = generateAlternatives(wardrobe, model, { mode: 'explore', occasion: 'any' });
  assert.equal(match.ranked, true); assert.notDeepEqual(match.candidates[0].pieceIds, explore.candidates[0].pieceIds);
  assert.ok(match.candidates[0].taste!.score > explore.candidates[0].taste!.score);
  for (const c of explore.candidates) {
    const novelty = c.features.reduce((s, v, i) => s + Math.abs(v - model.likedCentroid[i]), 0) / 8;
    assert.equal(c.novelty, novelty); assert.equal(c.rankScore, .35 * c.taste!.score / 100 + .65 * novelty);
  }
  assert.deepEqual(generateAlternatives([...wardrobe].reverse(), model, { mode: 'explore', occasion: 'any' }), explore);
});
test('1728-combination bound, lexical ties and pairwise diversity fallback are explicit', () => {
  const cold = trainPreferenceModel([]);
  const wardrobe = (['top', 'bottom', 'shoes'] as const).flatMap((category, c) => Array.from({ length: 12 }, (_, i) => piece(c * 12 + i, category)));
  const result = generateAlternatives(wardrobe, cold, { mode: 'match', occasion: 'any' });
  assert.equal(result.eligibleCount, 1728); assert.equal(result.candidates.length, 3); assert.equal(result.diversityFallback, false);
  for (const [i, a] of result.candidates.entries()) for (const b of result.candidates.slice(i + 1)) {
    assert.ok(a.pieceIds.filter(id => b.pieceIds.includes(id)).length <= 1);
  }
  const small = [piece(1, 'top'), piece(2, 'top'), piece(3, 'top'), piece(4, 'bottom'), piece(5, 'shoes')];
  const fallback = generateAlternatives(small, cold, { mode: 'match', occasion: 'any' });
  assert.equal(fallback.candidates.length, 3); assert.equal(fallback.diversityFallback, true);
  assert.match(fallback.reason ?? '', /shared pieces/i);
  assert.deepEqual(fallback.candidates.map(c => c.pieceIds[0]), [id(1), id(2), id(3)]);
  for (const bad of [[...wardrobe, piece(50, 'top')], [...small, small[0]], [piece(1, 'hat' as Piece['category'])]]) {
    assert.throws(() => generateAlternatives(bad, cold, { mode: 'match', occasion: 'any' }));
  }
  assert.throws(() => generateAlternatives(small, cold, { mode: 'random' as 'match', occasion: 'any' }));
  assert.throws(() => generateAlternatives(small, cold, { mode: 'match', occasion: 'work' as 'any' }));
  assert.throws(() => generateAlternatives(small, { status: 'unknown' } as unknown as ModelResult, { mode: 'match', occasion: 'any' }));
});

test('600 prescribed updates match an independent scalar logistic recurrence', () => {
  // Only warm versus cool differs. Shared features and intercept cancel by symmetry.
  const lessons = Array.from({ length: 4 }, (_, i) => [example(i * 2, 'like', { palette: 'warm' }),
    example(i * 2 + 1, 'pass', { palette: 'cool' })]).flat();
  let scalar = 0;
  for (let step = 0; step < 600; step++) scalar += .2 * ((1 - 1 / (1 + Math.exp(-scalar))) / 2 - .1 * scalar);
  const model = trained(lessons);
  assert.ok(Math.abs(model.weights[1] - scalar) < 1e-12);
  assert.ok(Math.abs(model.weights[2] + scalar) < 1e-12);
  assert.ok(Math.abs(model.intercept) < 1e-12);
  assert.ok(model.weights.filter((_, i) => i !== 1 && i !== 2).every(w => Math.abs(w) < 1e-12));
});

test('occasion eligibility is exactly the declared rule across all 27 formality combinations', () => {
  const wardrobe = (['top', 'bottom', 'shoes'] as const).flatMap((category, c) =>
    (['casual', 'smart', 'formal'] as const).map((formality, f) => piece(c * 3 + f, category, { formality })));
  const model = trainPreferenceModel([]);
  for (const [occasion, expected] of [['any', 27], ['casual', 7], ['smart', 8], ['formal', 1]] as const) {
    assert.equal(generateAlternatives(wardrobe, model, { mode: 'match', occasion }).eligibleCount, expected);
  }
  const overCategory = Array.from({ length: 13 }, (_, i) => piece(i, 'top'));
  assert.throws(() => generateAlternatives(overCategory, model, { mode: 'match', occasion: 'any' }), /12.*categor/i);
  assert.equal(generateAlternatives([], model, { mode: 'match', occasion: 'any' }).candidates.length, 0);
});

test('outfit-origin lessons train their actual averaged thirds and stable sigmoid handles extreme finite logits', () => {
  const mixed = vector().map((value, i) => i === 0 ? 1 / 3 : i === 1 ? 2 / 3 : value) as unknown as FeatureVector;
  const lessons = paletteLessons();
  lessons[0] = { ...lessons[0], origin: 'outfit', sourceLookId: id(400), features: mixed };
  const model = trained(lessons);
  assert.ok(Number.isFinite(model.loss));
  assert.equal(scorePreference(mixed, { ...model, intercept: 1e300 }).score, 100);
  assert.equal(scorePreference(mixed, { ...model, intercept: -1e300 }).score, 0);
  assert.throws(() => scorePreference(vector(), { ...model, weights: Array(14).fill(Number.MAX_VALUE) }), /finite/i);
});

test('sparse training input cannot invent unlabeled Pass counts', () => {
  const sparse = Array<PreferenceExample>(4);
  sparse[0] = example(1, 'like');
  assert.throws(() => trainPreferenceModel(sparse), /specified fields|examples/i);
});
