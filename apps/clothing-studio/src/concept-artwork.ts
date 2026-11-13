import { validateProject, type Project } from './model.ts';
import { garmentPath, GARMENT_WIDTH, GARMENT_HEIGHT } from './graphics.ts';
import { conceptBodyBox } from './concept-product.ts';
import { ARTWORK_SHOULDER_OFFSET } from './artwork-placement.ts';
import { panelSize, topMeasurements, type Artwork, type Product } from './product.ts';

/** Body marks become a transparent graphic, never a photograph, garment fill or inferred sewing line. */
export function renderConceptArtwork(value: Project, product: Product, document = globalThis.document): Artwork | null {
  const project = validateProject(value);
  if (!project.strokes.length) return null;
  const box = conceptBodyBox(project), scale = Math.min(3, 1024 / box.width, 1024 / box.height);
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(box.width * scale); canvas.height = Math.ceil(box.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not make the concept sketch artwork. Try copying without body marks.');
  ctx.scale(scale, scale); ctx.translate(-box.left, -box.top);
  ctx.beginPath(); ctx.rect(box.left, box.top, box.width, box.height); ctx.clip();
  ctx.clip(new Path2D(garmentPath(project.garment)));
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const stroke of project.strokes) {
    ctx.beginPath(); ctx.strokeStyle = stroke.color; ctx.fillStyle = stroke.color; ctx.lineWidth = stroke.width;
    for (const [i, point] of stroke.points.entries()) {
      const x = point.x * GARMENT_WIDTH, y = point.y * GARMENT_HEIGHT;
      if (stroke.points.length === 1) { ctx.arc(x, y, stroke.width / 2, 0, Math.PI * 2); ctx.fill(); }
      else if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    if (stroke.points.length > 1) ctx.stroke();
  }
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let visible = false;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) { visible = true; break; }
  if (!visible) return null;
  const panel = panelSize(topMeasurements(product));
  const widthCm = Math.min(40, panel.width, (panel.length - ARTWORK_SHOULDER_OFFSET) * canvas.width / canvas.height);
  return { part: 'front', name: 'Concept body sketch', dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height,
    xCm: 0, yCm: 0, widthCm: Math.round(widthCm * 100) / 100 };
}
