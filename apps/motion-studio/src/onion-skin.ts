import {WIDTH, HEIGHT, validateProject, drawingCelIndex, evaluatePose, type Project, type Pose, type Stroke} from './model.ts';
export type NeighborDrawing = {side: 'previous' | 'next'; frame: number; strokes: Stroke[]; pose: Pose};
/** Adjacent exposure artwork, positioned at the selected layer's current pose. */
export function neighborDrawings(input: Project, layerId: string, frame: number): NeighborDrawing[] {
  const project = validateProject(input);
  if (!Number.isInteger(frame) || frame < 0 || frame >= project.frameCount) throw new Error('Guide frame must be within the project timeline.');
  const layer = project.layers.find(item => item.id === layerId);
  if (!layer || layer.kind !== 'drawing') return [];
  const index = drawingCelIndex(layer.cels, frame), pose = evaluatePose(layer, frame);
  const adjacent: {side: NeighborDrawing['side']; index: number}[] = [{side: 'previous', index: index - 1}, {side: 'next', index: index + 1}];
  return adjacent.filter(item => item.index >= 0 && item.index < layer.cels.length).map(item => ({side: item.side, frame: layer.cels[item.index].frame, strokes: layer.cels[item.index].strokes, pose: {...pose}}));
}
/** Owns only the transparent editor overlay; no committed renderer consumes this. */
export function renderNeighborDrawings(context: CanvasRenderingContext2D, guides: NeighborDrawing[]): void {
  context.save();
  try {
    context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, WIDTH, HEIGHT);
    context.globalCompositeOperation = 'source-over'; context.filter = 'none'; context.shadowBlur = 0; context.shadowOffsetX = context.shadowOffsetY = 0;
    context.lineCap = context.lineJoin = 'round'; context.setLineDash([]);
    for (const guide of guides) {
      context.save();
      try {
        context.translate(guide.pose.x, guide.pose.y); context.rotate(guide.pose.rotation * Math.PI / 180); context.scale(guide.pose.scale, guide.pose.scale);
        context.globalAlpha = .25 * guide.pose.opacity; context.strokeStyle = context.fillStyle = guide.side === 'previous' ? '#087f8c' : '#c43d64';
        for (const stroke of guide.strokes) {
          context.lineWidth = stroke.width; context.beginPath();
          const first = stroke.points[0];
          if (stroke.points.every(point => point.x === first.x && point.y === first.y)) { context.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2); context.fill(); }
          else { context.moveTo(first.x, first.y); for (let i = 1; i < stroke.points.length; i++) context.lineTo(stroke.points[i].x, stroke.points[i].y); context.stroke(); }
        }
      } finally { context.restore(); }
    }
  } finally { context.restore(); }
}
