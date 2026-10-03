import { averageFeatures, featuresFromTags, validateFeatures } from './features.ts';
import { CATEGORIES, FEATURE_NAMES, ID_PATTERN, LIMITS } from './types.ts';
import type {
  Candidate, Counts, FeatureVector, Mode, ModelResult, Occasion, OutfitPieces,
  Piece, PreferenceExample, Suggestions, TasteScore, TrainedModel,
} from './types.ts';

const STEPS = 600;
const RATE = .2;
const L2 = .1;
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const sigmoid = (z: number): number => z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
const dot = (a: readonly number[], b: readonly number[]): number => a.reduce((sum, value, i) => sum + value * b[i], 0);

function validId(value: unknown): boolean {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

function trainingExamples(examples: readonly PreferenceExample[]): PreferenceExample[] {
  if (!Array.isArray(examples) || examples.length > LIMITS.examples) throw new Error('Supply at most 80 labeled examples.');
  const ids = new Set<string>();
  const keys = ['id', 'caption', 'label', 'origin', 'features', 'photoId', 'sourceLookId'];
  const result = Array.from(examples).map(example => {
    if (!example || typeof example !== 'object' || Object.keys(example).length !== keys.length
      || keys.some(key => !Object.hasOwn(example, key)) || !validId(example.id) || ids.has(example.id)) {
      throw new Error('Examples need the specified fields and unique 32-character IDs.');
    }
    ids.add(example.id);
    if (example.label !== 'like' && example.label !== 'pass') throw new Error('Each example must be labeled Like or Pass.');
    if (typeof example.caption !== 'string' || !example.caption.trim() || example.caption.length > 160
      || Array.from(example.caption as string).some(char => {
        const code = char.codePointAt(0)!;
        return (code < 32 && ![9, 10, 13].includes(code)) || code === 127 || (code >= 0xd800 && code <= 0xdfff);
      })) throw new Error('Example captions must contain 1–160 valid text characters.');
    if (example.photoId !== null && !validId(example.photoId)) throw new Error('Example photo IDs must be valid or null.');
    if ((example.origin === 'tagged' && example.sourceLookId !== null)
      || (example.origin === 'outfit' && (!validId(example.sourceLookId) || example.photoId !== null))) {
      throw new Error('Example attribution must match its tagged or outfit origin.');
    }
    return { ...example, features: validateFeatures(example.features, example.origin) };
  });
  return result.sort((a, b) => compare(a.id, b.id));
}

/** Full-batch, class-balanced logistic regression, without fixed fashion scores. */
export function trainPreferenceModel(examples: readonly PreferenceExample[]): ModelResult {
  const ordered = trainingExamples(examples);
  const likes = ordered.filter(example => example.label === 'like').length;
  const counts: Counts = { total: ordered.length, likes, passes: ordered.length - likes };
  if (counts.total < 8 || likes < 3 || counts.passes < 3) {
    return { status: 'insufficient', counts,
      reason: 'Teach at least 8 examples, including 3 Like and 3 Pass, before personalized scoring.' };
  }
  const weights = Array<number>(14).fill(0);
  let intercept = 0;
  for (let step = 0; step < STEPS; step++) {
    const gradient = weights.map(weight => L2 * weight);
    let interceptGradient = 0;
    for (const example of ordered) {
      const positive = example.label === 'like';
      const error = (sigmoid(intercept + dot(weights, example.features)) - Number(positive))
        / (2 * (positive ? likes : counts.passes));
      interceptGradient += error;
      for (let i = 0; i < 14; i++) gradient[i] += error * example.features[i];
    }
    for (let i = 0; i < 14; i++) weights[i] -= RATE * gradient[i];
    intercept -= RATE * interceptGradient;
  }
  let loss = L2 / 2 * dot(weights, weights);
  const centroid = Array<number>(14).fill(0);
  for (const example of ordered) {
    const positive = example.label === 'like';
    const z = intercept + dot(weights, example.features);
    // Softplus avoids log(0) and exp(large positive values).
    loss += (Math.max(z, 0) - Number(positive) * z + Math.log1p(Math.exp(-Math.abs(z))))
      / (2 * (positive ? likes : counts.passes));
    if (positive) for (let i = 0; i < 14; i++) centroid[i] += example.features[i] / likes;
  }
  if (![...weights, intercept, loss].every(Number.isFinite)) throw new Error('The preference model could not produce finite results.');
  return { status: 'trained', counts, weights, intercept,
    likedCentroid: centroid as unknown as FeatureVector, steps: STEPS, loss };
}

function validateModel(model: ModelResult): void {
  if (!model || (model.status !== 'trained' && model.status !== 'insufficient')) throw new Error('Supply a trained or insufficient preference model.');
  const counts = model.counts;
  if (!counts || ![counts.total, counts.likes, counts.passes].every(n => Number.isInteger(n) && n >= 0 && n <= LIMITS.examples)
    || counts.total !== counts.likes + counts.passes) throw new Error('Model label counts are invalid.');
  const enough = counts.total >= 8 && counts.likes >= 3 && counts.passes >= 3;
  if (model.status === 'insufficient') {
    if (enough || typeof model.reason !== 'string' || !model.reason.trim()) throw new Error('Insufficient model guidance or counts are invalid.');
    return;
  }
  if (!enough || model.steps !== STEPS || !Number.isFinite(model.intercept) || !Number.isFinite(model.loss) || model.loss < 0
    || !Array.isArray(model.weights) || model.weights.length !== 14 || !Array.from(model.weights).every(Number.isFinite)) {
    throw new Error('Model weights and training results must be finite and valid.');
  }
  const centroid = model.likedCentroid;
  if (!Array.isArray(centroid) || centroid.length !== 14
    || !Array.from(centroid).every(n => Number.isFinite(n) && n >= 0 && n <= 1 + 1e-8)
    || [[0, 4], [4, 7], [7, 11], [11, 14]].some(([start, end]) =>
      Math.abs(centroid.slice(start, end).reduce((sum, n) => sum + n, 0) - 1) > 1e-8)) {
    throw new Error('The liked feature centroid must contain normalized finite groups.');
  }
}

function scoreValidated(features: FeatureVector, model: TrainedModel): TasteScore {
  const linear = model.intercept + dot(model.weights, features);
  if (!Number.isFinite(linear)) throw new Error('The model score exceeded finite numeric bounds.');
  const contributions = features.map((value, index) => ({ index, name: FEATURE_NAMES[index], value,
    weight: model.weights[index], contribution: value * model.weights[index] }))
    .filter(item => item.contribution !== 0)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution) || a.index - b.index).slice(0, 3);
  return { score: Math.round(100 * sigmoid(linear)), contributions };
}

export function scorePreference(features: FeatureVector, model: TrainedModel): TasteScore {
  const vector = validateFeatures(features, 'outfit');
  validateModel(model);
  if (model.status !== 'trained') throw new Error('Personalized scoring requires a trained model.');
  return scoreValidated(vector, model);
}

export function assessOutfit(features: FeatureVector, model: ModelResult): TasteScore | null {
  const vector = validateFeatures(features, 'outfit');
  validateModel(model);
  return model.status === 'trained' ? scoreValidated(vector, model) : null;
}

function occasionAllows(pieces: OutfitPieces, occasion: Occasion): boolean {
  const tags = pieces.map(piece => piece.tags.formality);
  if (occasion === 'any') return true;
  if (occasion === 'casual') return tags.every(tag => tag === 'casual' || tag === 'smart') && tags.includes('casual');
  if (occasion === 'smart') return tags.every(tag => tag === 'smart' || tag === 'formal');
  return tags.every(tag => tag === 'formal');
}

export function generateAlternatives(pieces: readonly Piece[], model: ModelResult,
  options: { mode: Mode; occasion: Occasion }): Suggestions {
  validateModel(model);
  if (!options || !['match', 'explore'].includes(options.mode)
    || !['any', 'casual', 'smart', 'formal'].includes(options.occasion)) throw new Error('Choose a supported mode and occasion.');
  if (!Array.isArray(pieces) || pieces.length > LIMITS.pieces) throw new Error('The wardrobe can contain at most 36 pieces.');
  const groups: Piece[][] = [[], [], []];
  const ids = new Set<string>();
  for (const piece of pieces) {
    if (!piece || !validId(piece.id) || ids.has(piece.id)) throw new Error('Wardrobe pieces need unique valid IDs.');
    ids.add(piece.id);
    const index = CATEGORIES.indexOf(piece.category);
    if (index < 0) throw new Error('Piece category must be top, bottom, or shoes.');
    featuresFromTags(piece.tags);
    groups[index].push(piece);
    if (groups[index].length > LIMITS.piecesPerCategory) throw new Error('Keep at most 12 pieces per category.');
  }
  const candidates: Candidate[] = [];
  for (const top of groups[0]) for (const bottom of groups[1]) for (const shoes of groups[2]) {
    const outfit: OutfitPieces = [top, bottom, shoes];
    if (!occasionAllows(outfit, options.occasion)) continue;
    const features = averageFeatures(outfit);
    const taste = model.status === 'trained' ? scoreValidated(features, model) : null;
    const novelty = model.status === 'trained'
      ? features.reduce((sum, value, i) => sum + Math.abs(value - model.likedCentroid[i]), 0) / 8 : null;
    const rankScore = taste && novelty !== null
      ? options.mode === 'match' ? taste.score / 100 : .35 * taste.score / 100 + .65 * novelty : null;
    candidates.push({ pieceIds: [top.id, bottom.id, shoes.id], features, taste, novelty, rankScore });
  }
  candidates.sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0)
    || compare(a.pieceIds.join(':'), b.pieceIds.join(':')));
  const selected: Candidate[] = [];
  const desired = Math.min(3, candidates.length);
  for (const candidate of candidates) {
    if (selected.every(other => candidate.pieceIds.filter(id => other.pieceIds.includes(id)).length <= 1)) selected.push(candidate);
    if (selected.length === desired) break;
  }
  const diversityFallback = selected.length < desired;
  if (diversityFallback) {
    for (const candidate of candidates) {
      if (!selected.includes(candidate)) selected.push(candidate);
      if (selected.length === desired) break;
    }
  }
  const reasons: string[] = [];
  if (!candidates.length) reasons.push('No eligible combinations meet this occasion rule. Add a top, bottom, and shoes with suitable declared formality tags.');
  if (model.status === 'insufficient') reasons.push('These are unranked outfit ideas, not personalized recommendations. ' + model.reason);
  if (diversityFallback) reasons.push('The available wardrobe required shared pieces between alternatives.');
  return { candidates: selected, eligibleCount: candidates.length, ranked: model.status === 'trained',
    diversityFallback, reason: reasons.length ? reasons.join(' ') : null };
}
