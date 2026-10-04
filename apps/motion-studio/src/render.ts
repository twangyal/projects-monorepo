import { HEIGHT, WIDTH, MAX_FRAMES, SCHEMA_VERSION, drawingCelIndex, evaluatePose, validateProject, type Layer, type Project } from './model.ts';
import { decodeImageAsset } from './images.ts';
export type Assets = Map<string, ImageBitmap>;
export function closeAssets(assets: Assets): void { for (const bitmap of assets.values()) bitmap.close(); assets.clear(); }
/** Decode all layers as a transaction; a failure releases every already decoded bitmap. */
export async function loadAssets(project: Project): Promise<Assets> {
  const safe = validateProject(project), assets: Assets = new Map();
  try {
    for (const layer of safe.layers) if (layer.kind === 'image') assets.set(layer.id, await decodeImageAsset(layer.image));
    return assets;
  } catch (error) { closeAssets(assets); throw error; }
}
function bounds(layer: Layer, frame: number): { width: number; height: number } {
  if (layer.kind === 'image') {
    const factor = Math.min(1, 320 / layer.image.width, 240 / layer.image.height);
    return { width: layer.image.width * factor, height: layer.image.height * factor };
  }
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const stroke of layer.cels[drawingCelIndex(layer.cels, frame)].strokes) for (const point of stroke.points) {
    const radius = stroke.width / 2;
    left = Math.min(left, point.x - radius); right = Math.max(right, point.x + radius);
    top = Math.min(top, point.y - radius); bottom = Math.max(bottom, point.y + radius);
  }
  return { width: Number.isFinite(left) ? Math.max(1, right - left) : 1, height: Number.isFinite(top) ? Math.max(1, bottom - top) : 1 };
}
export function layerBounds(layer: Layer, frame = 0): { width: number; height: number } {
  if (!Number.isFinite(frame)) throw new Error('Animation frame must be finite.');
  const safe = validateProject({ schemaVersion: SCHEMA_VERSION, title: 'Geometry', background: '#FFFFFF', frameCount: MAX_FRAMES, layers: [layer] });
  return bounds(safe.layers[0], frame);
}
type RenderContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type FrameRenderer = { readonly frameCount: number; render(ctx: RenderContext, frame: number): void };

function checkAssets(project: Project, assets: Assets): void {
  for (const layer of project.layers) if (layer.kind === 'image') {
    const bitmap = assets.get(layer.id);
    if (!bitmap || bitmap.width !== layer.image.width || bitmap.height !== layer.image.height) throw new Error('Image assets are missing or do not match this project.');
  }
}

/** Capture one detached admitted project and fixed bitmap bindings for a render sequence.
 * The caller owns bitmap lifetime; closing one invalidates further rendering.
 * No project, cel, stroke or mutable asset map escapes through this interface.
 */
export function createFrameRenderer(project: Project, assets: Assets): FrameRenderer {
  const safe = validateProject(project), bound: Assets = new Map();
  checkAssets(safe, assets);
  for (const layer of safe.layers) if (layer.kind === 'image') bound.set(layer.id, assets.get(layer.id)!);
  return Object.freeze({
    frameCount: safe.frameCount,
    render(ctx: RenderContext, frame: number): void {
      if (!Number.isFinite(frame) || frame < 0 || frame > safe.frameCount - 1) throw new Error('Render frame must be within the project timeline.');
      // ImageBitmap.close() is observable even after its map binding is captured.
      // Refuse before clearing the destination if an owner released an asset.
      checkAssets(safe, bound);
      drawFrame(ctx, safe, frame, bound);
    },
  });
}

/** Shared preview/PNG/GIF kernel. Editor overlays are intentionally separate. */
export function renderFrame(ctx: RenderContext, project: Project, frame: number, assets: Assets): void {
  createFrameRenderer(project, assets).render(ctx, frame);
}

function drawFrame(ctx: RenderContext, safe: Project, frame: number, assets: Assets): void {
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0; ctx.shadowOffsetX = ctx.shadowOffsetY = 0; ctx.filter = 'none';
    ctx.fillStyle = safe.background; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    for (const layer of safe.layers) {
      const pose = evaluatePose(layer, frame);
      ctx.save();
      try {
        ctx.translate(pose.x, pose.y); ctx.rotate(pose.rotation * Math.PI / 180); ctx.scale(pose.scale, pose.scale); ctx.globalAlpha = pose.opacity;
        if (layer.kind === 'image') {
          const size = bounds(layer, frame); ctx.drawImage(assets.get(layer.id)!, -size.width / 2, -size.height / 2, size.width, size.height);
        } else {
          ctx.lineCap = ctx.lineJoin = 'round'; ctx.setLineDash([]);
          // Use the model's same bounded cut rule, without cloning held artwork.
          const cel = layer.cels[drawingCelIndex(layer.cels, frame)];
          for (const stroke of cel.strokes) {
            ctx.strokeStyle = ctx.fillStyle = stroke.color; ctx.lineWidth = stroke.width; ctx.beginPath();
            if (stroke.points.length === 1) {
              const point = stroke.points[0]; ctx.arc(point.x, point.y, stroke.width / 2, 0, Math.PI * 2); ctx.fill();
            } else {
              ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
              for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
              ctx.stroke();
            }
          }
        }
      } finally { ctx.restore(); }
    }
  } finally { ctx.restore(); }
}
