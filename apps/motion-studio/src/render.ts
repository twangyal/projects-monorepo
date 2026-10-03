import { HEIGHT, WIDTH, MAX_FRAMES, evaluatePose, validateProject, type Layer, type Project } from './model.ts';
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
function bounds(layer: Layer): { width: number; height: number } {
  if (layer.kind === 'image') {
    const factor = Math.min(1, 320 / layer.image.width, 240 / layer.image.height);
    return { width: layer.image.width * factor, height: layer.image.height * factor };
  }
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const stroke of layer.strokes) for (const point of stroke.points) {
    const radius = stroke.width / 2;
    left = Math.min(left, point.x - radius); right = Math.max(right, point.x + radius);
    top = Math.min(top, point.y - radius); bottom = Math.max(bottom, point.y + radius);
  }
  return { width: Number.isFinite(left) ? Math.max(1, right - left) : 1, height: Number.isFinite(top) ? Math.max(1, bottom - top) : 1 };
}
export function layerBounds(layer: Layer): { width: number; height: number } {
  const safe = validateProject({ schemaVersion: 1, title: 'Geometry', background: '#FFFFFF', frameCount: MAX_FRAMES, layers: [layer] });
  return bounds(safe.layers[0]);
}
/** Shared preview/export artwork renderer. Editor overlays are intentionally separate. */
export function renderFrame(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, project: Project, frame: number, assets: Assets): void {
  const safe = validateProject(project);
  if (!Number.isFinite(frame) || frame < 0 || frame > safe.frameCount - 1) throw new Error('Render frame must be within the project timeline.');
  for (const layer of safe.layers) if (layer.kind === 'image') {
    const bitmap = assets.get(layer.id);
    if (!bitmap || bitmap.width !== layer.image.width || bitmap.height !== layer.image.height) throw new Error('Image assets are missing or do not match this project.');
  }
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
          const size = bounds(layer); ctx.drawImage(assets.get(layer.id)!, -size.width / 2, -size.height / 2, size.width, size.height);
        } else {
          ctx.lineCap = ctx.lineJoin = 'round'; ctx.setLineDash([]);
          for (const stroke of layer.strokes) {
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
