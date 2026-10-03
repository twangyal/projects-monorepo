export type Category = 'top' | 'bottom' | 'shoes';
export type Palette = 'neutral' | 'warm' | 'cool' | 'bright';
export type Fit = 'fitted' | 'regular' | 'relaxed';
export type Style = 'minimal' | 'classic' | 'sporty' | 'playful';
export type Formality = 'casual' | 'smart' | 'formal';
export interface Tags { palette: Palette; fit: Fit; style: Style; formality: Formality }
export type Label = 'like' | 'pass';
export type Mode = 'match' | 'explore';
export type Occasion = 'any' | 'casual' | 'smart' | 'formal';
export type FeatureVector = readonly [number, number, number, number, number, number, number,
  number, number, number, number, number, number, number];
export interface PhotoAsset { id: string; mime: 'image/jpeg'; width: 720; height: 720; dataUrl: string }
export interface Piece { id: string; name: string; category: Category; tags: Tags; photoId: string | null }
export interface PreferenceExample {
  id: string; caption: string; label: Label; origin: 'tagged' | 'outfit';
  features: FeatureVector; photoId: string | null; sourceLookId: string | null;
}
export type OutfitPieces = readonly [Piece, Piece, Piece];
export type PieceIds = readonly [string, string, string];
export interface SavedLook { id: string; name: string; notes: string; pieces: OutfitPieces }
export interface Project {
  schemaVersion: 1; title: string; pieces: Piece[]; examples: PreferenceExample[];
  looks: SavedLook[]; photos: PhotoAsset[];
}
export interface Counts { total: number; likes: number; passes: number }
export interface TrainedModel {
  status: 'trained'; counts: Counts; weights: readonly number[]; intercept: number;
  likedCentroid: FeatureVector; steps: 600; loss: number;
}
export interface InsufficientModel { status: 'insufficient'; counts: Counts; reason: string }
export type ModelResult = TrainedModel | InsufficientModel;
export interface FeatureContribution { index: number; name: string; value: number; weight: number; contribution: number }
export interface TasteScore { score: number; contributions: FeatureContribution[] }
export interface Candidate {
  pieceIds: PieceIds; features: FeatureVector; taste: TasteScore | null;
  novelty: number | null; rankScore: number | null;
}
export interface Suggestions {
  candidates: Candidate[]; eligibleCount: number; ranked: boolean;
  diversityFallback: boolean; reason: string | null;
}

export const PALETTES = ['neutral', 'warm', 'cool', 'bright'] as const;
export const FITS = ['fitted', 'regular', 'relaxed'] as const;
export const STYLES = ['minimal', 'classic', 'sporty', 'playful'] as const;
export const FORMALITIES = ['casual', 'smart', 'formal'] as const;
export const CATEGORIES = ['top', 'bottom', 'shoes'] as const;
export const FEATURE_NAMES = [
  'palette:neutral', 'palette:warm', 'palette:cool', 'palette:bright',
  'fit:fitted', 'fit:regular', 'fit:relaxed',
  'style:minimal', 'style:classic', 'style:sporty', 'style:playful',
  'formality:casual', 'formality:smart', 'formality:formal',
] as const;
// A true end assertion also excludes the final newline accepted by JS `$`.
export const ID_PATTERN = /^[a-f0-9]{32}(?![\s\S])/;
export const LIMITS = {
  pieces: 36, piecesPerCategory: 12, examples: 80, looks: 30, photos: 20,
  photoBytes: 204800, photoSide: 720, projectBytes: 8388608,
  sourcePhotoBytes: 8388608, sourcePhotoPixels: 16000000, sourcePhotoSide: 8192,
  historySnapshots: 20, historyBytes: 25165824,
} as const;
