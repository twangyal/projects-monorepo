import { validateProject, validateSettings, decodeMask } from './model.ts';
import { validateRaster } from './png.ts';
import { LIMITS } from './types.ts';
import type { Point, Plane, Settings, Project, Raster, Rendered } from './types.ts';

function validPlane(plane: Plane): void {
  if (plane !== 0 && plane !== 1 && plane !== 2) throw new Error('Choose the near, subject or far depth plane.');
}
function scale(settings: Settings, plane: Plane): number {
  const ratio = settings.targetFocal / settings.sourceFocal;
  if (settings.mode === 'fixed') return ratio;
  if (plane === 1 || ratio === 1) return 1;
  const depth = plane === 0 ? settings.near : settings.far;
  return ratio * depth / (depth + ratio - 1);
}
export function planeScale(settings: Settings, plane: Plane): number {
  validPlane(plane); return scale(validateSettings(settings), plane);
}
export function projectPoint(point: Point, settings: Settings, plane: Plane, width: number, height: number): Point {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > LIMITS.photoSide || height > LIMITS.photoSide) throw new Error('Projection dimensions must be integers from 1 through 1280.');
  if (!point || typeof point !== 'object' || Array.isArray(point) || Object.keys(point).length !== 2
      || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > width || point.y < 0 || point.y > height) throw new Error('Use a finite point within the source image edges.');
  const validated = validateSettings(settings); validPlane(plane);
  const amount = scale(validated, plane);
  return { x: width / 2 + amount * (point.x - width / 2) + validated.shiftX * width,
    y: height / 2 + amount * (point.y - height / 2) + validated.shiftY * height };
}
const unit = (value: number): number => Math.max(0, Math.min(1, value));
const byte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

/** Inverse sample each authored plane; alpha and geometric coverage are distinct. */
export function renderPixels(source: Raster, project: Project): Rendered {
  validateRaster(source);
  const valid = validateProject(project);
  const { width, height, rgba: pixels } = source;
  if (width !== valid.photo.width || height !== valid.photo.height) throw new Error('Source raster dimensions must match the project photo.');
  const labels = decodeMask(valid.depth);
  const settings = valid.settings;
  const planes: { label: number; amount: number }[] = settings.mode === 'fixed'
    ? [{ label: -1, amount: settings.targetFocal / settings.sourceFocal }]
    : [2, 1, 0].map(plane => ({ label: plane, amount: scale(settings, plane as Plane) }));
  const rgba = new Uint8ClampedArray(width * height * 4);
  const cx = width / 2, cy = height / 2, tx = settings.shiftX * width, ty = settings.shiftY * height;
  let missing = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let red = 0, green = 0, blue = 0, alpha = 0, coverage = 0;
      for (const { label, amount } of planes) {
        const sx = cx + (x + 0.5 - cx - tx) / amount - 0.5;
        const sy = cy + (y + 0.5 - cy - ty) / amount - 0.5;
        const left = Math.floor(sx), top = Math.floor(sy), fx = sx - left, fy = sy - top;
        let pr = 0, pg = 0, pb = 0, pa = 0, pc = 0;
        for (let dy = 0; dy < 2; dy++) {
          const iy = top + dy;
          if (iy < 0 || iy >= height) continue;
          for (let dx = 0; dx < 2; dx++) {
            const ix = left + dx;
            if (ix < 0 || ix >= width) continue;
            const index = iy * width + ix;
            if (label !== -1 && labels[index] !== label) continue;
            const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
            const offset = index * 4, weightedAlpha = pixels[offset + 3]! / 255 * weight;
            pr += pixels[offset]! * weightedAlpha; pg += pixels[offset + 1]! * weightedAlpha; pb += pixels[offset + 2]! * weightedAlpha;
            pa += weightedAlpha; pc += weight;
          }
        }
        pa = unit(pa); pc = unit(pc);
        red = pr + red * (1 - pa); green = pg + green * (1 - pa); blue = pb + blue * (1 - pa);
        alpha = unit(pa + alpha * (1 - pa)); coverage = unit(pc + coverage * (1 - pc));
      }
      const offset = (y * width + x) * 4, alphaByte = byte(alpha * 255);
      if (alphaByte) { rgba[offset] = byte(red / alpha); rgba[offset + 1] = byte(green / alpha); rgba[offset + 2] = byte(blue / alpha); rgba[offset + 3] = alphaByte; }
      missing += 1 - coverage;
    }
  }
  return { width, height, rgba, missingFraction: unit(missing / (width * height)) };
}

export function presentFrame(ctx: CanvasRenderingContext2D, frame: Raster): void {
  validateRaster(frame);
  if (!ctx || typeof ctx.putImageData !== 'function') throw new Error('A Canvas 2D context is required to present the frame.');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
}
