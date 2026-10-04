export type Mode = 'fixed' | 'perspective';
export type Plane = 0 | 1 | 2;
export interface Point { x: number; y: number }
export interface PhotoAsset { id: string; dataUrl: string; width: number; height: number }
export interface Settings {
  mode: Mode; sourceFocal: number; targetFocal: number;
  shiftX: number; shiftY: number; near: number; far: number;
}
export interface DepthMask { width: number; height: number; labels: string }
export interface Project {
  schemaVersion: 1; id: string; title: string;
  photo: PhotoAsset; settings: Settings; depth: DepthMask;
}
export interface EditState { title: string; settings: Settings; depth: DepthMask }
export interface Raster { width: number; height: number; rgba: Uint8ClampedArray }
export interface Rendered extends Raster { missingFraction: number }
export interface PhotoHeader {
  format: 'png' | 'jpeg' | 'webp'; width: number; height: number;
  orientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
}

export const LIMITS = Object.freeze({
  sourceBytes: 8 * 1024 * 1024, sourceSide: 8192, sourcePixels: 16_000_000,
  photoSide: 1280, photoBytes: 7 * 1024 * 1024, projectBytes: 12 * 1024 * 1024,
  focalMin: 10, focalMax: 300, focalDecimals: 2, ratioMin: 0.25, ratioMax: 4,
  shiftMin: -0.5, shiftMax: 0.5, shiftDecimals: 4,
  nearMin: 0.1, nearMax: 0.95, farMin: 1.05, farMax: 10, depthDecimals: 3,
  planeClearance: 0.05, brushMin: 1, brushMax: 100, brushPoints: 2048,
  brushLength: 8192, historyStates: 30, historyBytes: 32 * 1024 * 1024,
  titleCharacters: 80, jsonDepth: 24, jobTimeoutMs: 30_000, pngBytes: 7 * 1024 * 1024,
});
