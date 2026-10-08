export type SurroundMode = 'solid' | 'checker';
export interface Settings { mode: SurroundMode; border: number; colorA: string; colorB: string; cellSize: number }
export interface SourceInfo { fileName: string; format: 'png' | 'procedural'; width: number; height: number }
export interface ImageAsset { id: string; width: number; height: number; rgba: string; source: SourceInfo }
export interface Project { schemaVersion: 1; id: string; title: string; image: ImageAsset; settings: Settings }
export interface EditState { title: string; settings: Settings }
export interface Raster { width: number; height: number; rgba: Uint8ClampedArray }
export interface Metrics {
  artworkChangedPixels: number; artworkMaxChannelDelta: number; surroundPixels: number; totalPixels: number;
  rgbRmse: number; maxRgbDelta: number; meanAbsoluteLuminanceDelta: number;
}
export interface Comparison { baseline: Raster; result: Raster; metrics: Metrics }
export interface PngHeader { width: number; height: number; colorType: 2 | 6 }
export const LIMITS = Object.freeze({
  sourceBytes: 8 * 1024 * 1024, sourceSide: 8192, sourcePixels: 16_000_000,
  ancillaryBytes: 256 * 1024, imageSide: 720, rgbaBytes: 720 * 720 * 4,
  projectBytes: 4 * 1024 * 1024, jsonDepth: 16,
  border: 128, cellMin: 4, cellMax: 128, outputSide: 976,
  pngBytes: 4 * 1024 * 1024, reportBytes: 16 * 1024 * 1024,
  historyStates: 30, historyBytes: 128 * 1024,
  jobTimeoutMs: 30_000, storageTimeoutMs: 5_000, storageQueue: 32,
  titleCharacters: 80, fileNameCharacters: 240, experimentReportBytes: 512 * 1024,
});
