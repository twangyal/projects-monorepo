import { CATEGORIES, FITS, FORMALITIES, PALETTES, STYLES } from './types.ts';
import type { FeatureVector, OutfitPieces, Tags } from './types.ts';

const GROUPS = [PALETTES, FITS, STYLES, FORMALITIES] as const;
const KEYS = ['palette', 'fit', 'style', 'formality'] as const;

/** Accept only vectors representable by tagged examples or three-piece outfits. */
export function validateFeatures(value: unknown, origin: 'tagged' | 'outfit'): FeatureVector {
  if (origin !== 'tagged' && origin !== 'outfit') throw new Error('Feature origin must be tagged or outfit.');
  if (!Array.isArray(value) || value.length !== 14) throw new Error('Supply exactly 14 feature values.');
  const allowed = origin === 'tagged' ? [0, 1] : [0, 1 / 3, 2 / 3, 1];
  const vector: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isFinite(item) || !allowed.includes(item)) {
      throw new Error(origin === 'tagged' ? 'Tagged features must be one-hot values of 0 or 1.'
        : 'Outfit features must be 0, 1/3, 2/3, or 1.');
    }
    vector.push(item);
  }
  let offset = 0;
  for (const group of GROUPS) {
    const sum = vector.slice(offset, offset + group.length).reduce((total, item) => total + item, 0);
    if (Math.abs(sum - 1) > 1e-8) throw new Error('Each feature group must sum to one.');
    offset += group.length;
  }
  return vector as unknown as FeatureVector;
}

export function featuresFromTags(tags: Tags): FeatureVector {
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)
    || Object.keys(tags).length !== 4 || KEYS.some(key => !Object.hasOwn(tags, key))) {
    throw new Error('Supply exactly palette, fit, style, and formality tags.');
  }
  const values: number[] = [];
  GROUPS.forEach((group, index) => {
    const tag = tags[KEYS[index]];
    if (!(group as readonly string[]).includes(tag)) throw new Error(`Choose a supported ${KEYS[index]} tag.`);
    values.push(...group.map(option => option === tag ? 1 : 0));
  });
  return values as unknown as FeatureVector;
}

export function tagsFromFeatures(features: FeatureVector): Tags {
  const vector = validateFeatures(features, 'tagged');
  const values: string[] = [];
  let offset = 0;
  for (const group of GROUPS) {
    values.push(group[vector.slice(offset, offset + group.length).indexOf(1)]);
    offset += group.length;
  }
  return { palette: values[0], fit: values[1], style: values[2], formality: values[3] } as Tags;
}

export function averageFeatures(pieces: OutfitPieces): FeatureVector {
  if (!Array.isArray(pieces) || pieces.length !== 3
    || CATEGORIES.some((category, index) => pieces[index]?.category !== category)) {
    throw new Error('Choose exactly one piece in category order: top, bottom, shoes.');
  }
  const vectors = pieces.map(piece => featuresFromTags(piece.tags));
  return vectors[0].map((_, index) => vectors.reduce((sum, vector) => sum + vector[index], 0) / 3) as unknown as FeatureVector;
}
