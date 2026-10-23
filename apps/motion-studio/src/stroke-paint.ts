import type { Stroke } from './model.ts';
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
/** Paint admitted retained geometry. Fill closes its interior without closing the outline. */
export function paintStroke(context: Context, stroke: Stroke, tint?: string): void {
  context.strokeStyle = context.fillStyle = tint ?? stroke.color;
  context.lineWidth = stroke.width; context.beginPath();
  const first = stroke.points[0];
  if (stroke.points.every(point => point.x === first.x && point.y === first.y)) {
    context.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2); context.fill();
  } else {
    context.moveTo(first.x, first.y);
    for (let i = 1; i < stroke.points.length; i++) context.lineTo(stroke.points[i].x, stroke.points[i].y);
    if (stroke.fill) { context.fillStyle = tint ?? stroke.fill; context.fill('nonzero'); }
    context.stroke();
  }
}
