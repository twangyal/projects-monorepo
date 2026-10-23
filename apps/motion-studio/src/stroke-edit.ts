/** Pure retained-path queries and complete detached artwork edits. */
import { validateProject, type DrawingCel, type Point, type Project, type Stroke } from './model.ts';

export type StrokeTarget = { layerId: string; celFrame: number; strokeIndex: number };

function fields(value: unknown, names: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${label} must be a plain object.`);
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key)
      || !descriptors[key].enumerable || !('value' in descriptors[key]))) throw new Error(`${label} must contain exactly its supported data fields.`);
  return value as Record<string, unknown>;
}
function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  return value;
}
function point(value: unknown, label: string): Point {
  const input = fields(value, ['x', 'y'], label);
  return { x: finite(input.x, `${label} x`), y: finite(input.y, `${label} y`) };
}
function select(input: Project, target: StrokeTarget): { project: Project; cel: DrawingCel; index: number; stroke: Stroke } {
  const selection = fields(target, ['layerId', 'celFrame', 'strokeIndex'], 'Stroke target');
  if (typeof selection.layerId !== 'string') throw new Error('Select an existing drawing layer.');
  const frame = finite(selection.celFrame, 'Drawing cel frame'), index = finite(selection.strokeIndex, 'Stroke index');
  if (!Number.isInteger(frame) || !Number.isInteger(index) || frame < 0 || index < 0) throw new Error('Stroke target frame and index must be nonnegative integers.');
  const project = validateProject(input), layer = project.layers.find(entry => entry.id === selection.layerId);
  if (!layer || layer.kind !== 'drawing') throw new Error('Select an existing drawing layer.');
  const cel = layer.cels.find(entry => entry.frame === frame);
  if (!cel) throw new Error('Select an exact existing drawing boundary.');
  const stroke = cel.strokes[index];
  if (!stroke) throw new Error('Select an existing stroke in that drawing.');
  return { project, cel, index, stroke };
}

/** Admit only a bounded retained stroke list through the same schema as edits.
 * The fixed query shell has no generated identity, state or image allocation.
 */
function retained(strokes: readonly Stroke[]): Stroke[] {
  const project = validateProject({ schemaVersion: 2, title: 'Stroke query', background: '#000000', frameCount: 12,
    layers: [{ id: 'query', name: 'Stroke query', kind: 'drawing',
      keys: [{ frame: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, easing: 'linear' }],
      cels: [{ frame: 0, strokes }] }] });
  const layer = project.layers[0];
  if (layer.kind !== 'drawing') throw new Error('Stroke query requires a drawing.');
  return layer.cels[0].strokes;
}
export function hitStroke(strokes: readonly Stroke[], query: Point, padding: number): number | null {
  const cursor = point(query, 'Hit point'), extra = finite(padding, 'Hit padding');
  if (extra < 0) throw new Error('Hit padding cannot be negative.');
  const admitted = retained(strokes);
  for (let index = admitted.length - 1; index >= 0; index--) {
    const stroke = admitted[index], radius = stroke.width / 2 + extra;
    const close = (nearest: Point) => Math.hypot(cursor.x - nearest.x, cursor.y - nearest.y) <= radius;
    if (stroke.fill) {
      let winding = 0;
      for (let i = 0; i < stroke.points.length; i++) {
        const a = stroke.points[i], b = stroke.points[(i + 1) % stroke.points.length];
        const cross = (b.x - a.x) * (cursor.y - a.y) - (cursor.x - a.x) * (b.y - a.y);
        if (a.y <= cursor.y && b.y > cursor.y && cross > 0) winding++;
        else if (a.y > cursor.y && b.y <= cursor.y && cross < 0) winding--;
      }
      if (winding !== 0) return index;
    }
    if (close(stroke.points[0])) return index;
    for (let vertex = 1; vertex < stroke.points.length; vertex++) {
      const a = stroke.points[vertex - 1], b = stroke.points[vertex];
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (length === 0) { if (close(a)) return index; continue; }
      const wx = cursor.x - a.x, wy = cursor.y - a.y;
      const dot = wx * dx + wy * dy;
      // Use the literal scalar formula for ordinary stage coordinates. The
      // equivalent unit projection avoids overflow for very large queries.
      const ratio = Number.isFinite(dot) ? dot / (dx * dx + dy * dy)
        : (wx * (dx / length) + wy * (dy / length)) / length;
      const t = Math.max(0, Math.min(1, ratio));
      const nearest = t === 0 ? a : t === 1 ? b : { x: a.x + t * dx, y: a.y + t * dy };
      if (close(nearest)) return index;
    }
  }
  return null;
}
export function translateStroke(input: Project, target: StrokeTarget, delta: Point): Project {
  const displacement = point(delta, 'Stroke displacement');
  const { project, stroke } = select(input, target);
  stroke.points = stroke.points.map(value => ({
    x: displacement.x === 0 ? value.x : value.x + displacement.x,
    y: displacement.y === 0 ? value.y : value.y + displacement.y,
  }));
  return validateProject(project);
}
/** Correct one local vertex without changing its neighbors or brush. */
export function setStrokePoint(input: Project, target: StrokeTarget, pointIndex: number, value: Point): Project {
  const position = point(value, 'Stroke point'), index = finite(pointIndex, 'Point index');
  const { project, stroke } = select(input, target);
  if (!Number.isInteger(index) || index < 0 || index >= stroke.points.length) throw new Error('Select an existing point in this stroke.');
  stroke.points[index] = position;
  return validateProject(project);
}
export function insertStrokeMidpoint(input: Project, target: StrokeTarget, pointIndex: number): Project {
  const index = finite(pointIndex, 'Point index'), { project, stroke } = select(input, target);
  if (!Number.isInteger(index) || index < 0 || index >= stroke.points.length - 1) throw new Error('Select a point with a following neighbor to insert a midpoint.');
  const a = stroke.points[index], b = stroke.points[index + 1];
  stroke.points.splice(index + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  return validateProject(project);
}
export function deleteStrokePoint(input: Project, target: StrokeTarget, pointIndex: number): Project {
  const index = finite(pointIndex, 'Point index'), { project, stroke } = select(input, target);
  if (!Number.isInteger(index) || index < 0 || index >= stroke.points.length) throw new Error('Select an existing point in this stroke.');
  if (stroke.points.length === 1) throw new Error('Keep at least one point in the stroke. Delete the whole stroke to remove it.');
  stroke.points.splice(index, 1);
  return validateProject(project);
}
export function setStrokeAppearance(input: Project, target: StrokeTarget, appearance: { color: string; width: number; fill?: string | null }): Project {
  const values = fields(appearance, ['color', 'width', ...(Object.hasOwn(appearance, 'fill') ? ['fill'] : [])], 'Stroke appearance');
  if (typeof values.color !== 'string') throw new Error('Stroke color must use #RRGGBB notation.');
  const width = finite(values.width, 'Stroke width');
  const { project, stroke } = select(input, target);
  stroke.color = values.color; stroke.width = width;
  if (Object.hasOwn(values, 'fill')) {
    if (values.fill === null) delete stroke.fill;
    else { if (typeof values.fill !== 'string') throw new Error('Stroke fill must use #RRGGBB notation.'); stroke.fill = values.fill; }
  }
  return validateProject(project);
}
export function deleteStroke(input: Project, target: StrokeTarget): Project {
  const { project, cel, index } = select(input, target);
  cel.strokes.splice(index, 1);
  return validateProject(project);
}

export function reorderStroke(input: Project, target: StrokeTarget, direction: 'forward' | 'backward'): Project {
  if (direction !== 'forward' && direction !== 'backward') throw new Error('Choose forward or backward paint order.');
  const {project,cel,index} = select(input,target), neighbor=index+(direction==='forward'?1:-1);
  if(neighbor<0 || neighbor>=cel.strokes.length) return project;
  [cel.strokes[index],cel.strokes[neighbor]]=[cel.strokes[neighbor],cel.strokes[index]];
  return validateProject(project);
}

/** Insert an independent copy immediately above the selected path in paint order. */
export function duplicateStroke(input: Project, target: StrokeTarget): Project {
  const { project, cel, index, stroke } = select(input, target);
  cel.strokes.splice(index + 1, 0, structuredClone(stroke));
  return validateProject(project);
}
/** Reflect local path coordinates about its own bounds, keeping point direction/order. */
export function mirrorStroke(input: Project, target: StrokeTarget, axis: 'horizontal' | 'vertical'): Project {
  if (axis !== 'horizontal' && axis !== 'vertical') throw new Error('Choose horizontal or vertical mirroring.');
  const { project, stroke } = select(input, target);
  const property = axis === 'horizontal' ? 'x' : 'y';
  const values = stroke.points.map(p => p[property]), low = Math.min(...values), high = Math.max(...values);
  if (low !== high) stroke.points = stroke.points.map(p => ({ ...p, [property]: low + high - p[property] }));
  return validateProject(project);
}

/** Transform path geometry around its local bounds center, leaving brush width fixed. */
export function transformStroke(input: Project, target: StrokeTarget, action: 'grow' | 'shrink' | 'clockwise' | 'counterclockwise'): Project {
  if (!['grow','shrink','clockwise','counterclockwise'].includes(action)) throw new Error('Choose stroke growth, shrinkage or a quarter turn.');
  const { project, stroke } = select(input, target);
  const xs = stroke.points.map(p => p.x), ys = stroke.points.map(p => p.y);
  const lowX = Math.min(...xs), highX = Math.max(...xs), lowY = Math.min(...ys), highY = Math.max(...ys);
  if (lowX === highX && lowY === highY) return project;
  const cx = (lowX + highX) / 2, cy = (lowY + highY) / 2;
  stroke.points = stroke.points.map(p => {
    const dx = p.x - cx, dy = p.y - cy;
    if (action === 'clockwise') return { x: cx - dy, y: cy + dx };
    if (action === 'counterclockwise') return { x: cx + dy, y: cy - dx };
    const factor = action === 'grow' ? 2 : .5;
    return { x: cx + dx * factor, y: cy + dy * factor };
  });
  return validateProject(project);
}
