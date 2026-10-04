import type { Composition } from './types.ts';

export interface TrackReference { trackId: string; assetId: string }
export interface MelodyDocument {
  schemaVersion: 1;
  composition: Composition;
  references: TrackReference[];
}
export type ReferenceKind = 'microphone' | 'audio-file' | 'demo';
export interface ReferenceAsset {
  id: string;
  kind: ReferenceKind;
  captureTempo: number;
  decodedSampleRate: number;
  decodedChannels: number;
  decodedFrames: number;
  analyzedFrames: number;
  frameCount: number;
  pcm: Uint8Array;
}
export interface ReferenceBundle { document: MelodyDocument; assets: ReferenceAsset[] }
export interface ReferenceWindow { startFrame: number; endFrame: number }
export const REFERENCE_LIMITS = Object.freeze({
  sampleRate: 22050, seconds: 20, frames: 441000,
  sourceBytes: 10 * 1024 * 1024, decodedChannels: 32,
  assetBytes: 882000, currentAssets: 8, historyStates: 51,
  historyAssetBytes: 64 * 1024 * 1024,
  documentBytes: 2 * 1024 * 1024, backupBytes: 12 * 1024 * 1024,
  operationMs: 30000, jsonDepth: 16,
} as const);
