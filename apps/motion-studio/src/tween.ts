/** Reviewed geometric artwork proposals; no learned or semantic correspondence. */
import { validateProject, MAX_DRAWING_CELS, MAX_JSON_BYTES } from './model.ts';
import type { Point, Stroke, DrawingCel, DrawingLayer, Project } from './model.ts';

export const TWEEN_SAMPLES = 64;
export const MAX_TWEEN_PAIRS = 8;
export interface TweenSelection { layerId: string; startFrame: number; endFrame: number }
export interface TweenPair { startStroke: number; endStroke: number; reverseEnd: boolean }
export interface TweenChoices { pairs: TweenPair[]; frames: number[] }
export interface TweenUsage { layerCels: number; projectStrokes: number; projectPoints: number; projectBytes: number }
export interface TweenProposal {
  selection: TweenSelection; choices: TweenChoices; generated: DrawingCel[]; before: TweenUsage; after: TweenUsage;
}

// Identity, exact public fields and the complete canonical source are all pinned.
// Never retain a second full image/candidate graph in this receipt.
const receipts = new WeakMap<TweenProposal, { source: string; proposal: string }>();
const encoder = new TextEncoder();

function record(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${label} must be a plain record.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  if (names.length !== fields.length || fields.some(key => !Object.hasOwn(descriptors, key))
    || names.some(key => typeof key !== 'string' || !fields.includes(key)
      || !('value' in descriptors[key]) || !descriptors[key].enumerable)) {
    throw new Error(`${label} requires exact data fields, without accessors.`);
  }
  return value as Record<string, unknown>;
}
function dataArray(value: unknown, min: number, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < min || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) {
    throw new Error(`${label} requires a plain dense array of ${min}–${max} entries.`);
  }
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error(`${label} requires own data entries.`);
  }
  return value;
}
function bounded(value: unknown, min: number, max: number, label: string, integer = false, positiveZero = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max
    || (integer && !Number.isInteger(value)) || (positiveZero && Object.is(value, -0))) {
    throw new Error(`${label} is outside its finite${integer ? ' integer' : ''} bounds.`);
  }
  return value;
}
const zero = (n: number) => n === 0 ? 0 : n;
// Equivalent affine interpolation evaluated from the nearer endpoint. The
// weighted sum can round a constant legal1280/40 above its admission bound.
// This preserves constant coordinates exactly without clamping any geometry.
const interpolate = (a: number, b: number, t: number) => zero(t <= .5 ? a + (b - a) * t : b - (b - a) * (1 - t));
function points(value: unknown, positiveZero = false): Point[] {
  return dataArray(value, 1, 1000, 'Stroke points').map(entry => {
    const p = record(entry, ['x', 'y'], 'Point');
    return { x: zero(bounded(p.x, -1280, 1280, 'Point x', false, positiveZero)),
      y: zero(bounded(p.y, -1280, 1280, 'Point y', false, positiveZero)) };
  });
}
function admitSelection(value: unknown): TweenSelection {
  const input = record(value, ['layerId', 'startFrame', 'endFrame'], 'Tween selection');
  if (typeof input.layerId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.layerId)) throw new Error('Select an existing drawing layer.');
  const startFrame = bounded(input.startFrame, 0, 95, 'Starting frame', true);
  const endFrame = bounded(input.endFrame, 0, 95, 'Ending frame', true);
  if (endFrame - startFrame < 2) throw new Error('Endpoint drawings need at least one free interior frame.');
  return { layerId: input.layerId, startFrame: zero(startFrame), endFrame };
}
function admitChoices(value: unknown, selection: TweenSelection, count: number): TweenChoices {
  const input = record(value, ['pairs', 'frames'], 'Tween choices');
  const pairs = dataArray(input.pairs, count, count, 'Stroke pairs').map((entry, i) => {
    const p = record(entry, ['startStroke', 'endStroke', 'reverseEnd'], 'Stroke pair');
    const startStroke = bounded(p.startStroke, 0, count - 1, 'Starting stroke', true);
    const endStroke = bounded(p.endStroke, 0, count - 1, 'Ending stroke', true);
    if (startStroke !== i || typeof p.reverseEnd !== 'boolean') throw new Error('Pair each starting stroke in order with explicit direction.');
    return { startStroke: zero(startStroke), endStroke: zero(endStroke), reverseEnd: p.reverseEnd };
  });
  if (new Set(pairs.map(p => p.endStroke)).size !== count) throw new Error('Each ending stroke must be paired exactly once.');
  let previous = selection.startFrame;
  const frames = dataArray(input.frames, 1, 22, 'New drawing frames').map(entry => {
    const frame = bounded(entry, selection.startFrame + 1, selection.endFrame - 1, 'New drawing frame', true);
    if (frame <= previous) throw new Error('New drawing frames must be distinct and increasing.');
    previous = frame; return frame;
  });
  return { pairs, frames };
}
function endpoints(project: Project, selection: TweenSelection): { layer: DrawingLayer; start: DrawingCel; end: DrawingCel } {
  const layer = project.layers.find(entry => entry.id === selection.layerId);
  if (!layer || layer.kind !== 'drawing') throw new Error('Select an existing vector drawing layer.');
  const index = layer.cels.findIndex(cel => cel.frame === selection.startFrame);
  const start = layer.cels[index], end = layer.cels[index + 1];
  if (!start || !end || end.frame !== selection.endFrame) throw new Error('Choose two adjacent authored drawings.');
  if (start.strokes.length < 1 || start.strokes.length > MAX_TWEEN_PAIRS || start.strokes.length !== end.strokes.length) {
    throw new Error('Endpoints need the same nonzero count of 1–8 explicitly paired strokes.');
  }
  return { layer, start, end };
}

export function planTweenFrames(startFrame: number, endFrame: number, count: number): number[] {
  bounded(startFrame, 0, 95, 'Starting frame', true); bounded(endFrame, 0, 95, 'Ending frame', true);
  bounded(count, 1, 22, 'Number of new drawings', true);
  if (count > endFrame - startFrame - 1) throw new Error('There are not enough free interior frames.');
  return Array.from({ length: count }, (_, j) => startFrame + Math.floor((j + 1) * (endFrame - startFrame) / (count + 1)));
}

export function resampleStrokePoints(input: readonly Point[], reverse = false): Point[] {
  if (typeof reverse !== 'boolean') throw new Error('Stroke reversal must be explicit boolean.');
  const path = points(input); if (reverse) path.reverse();
  const ends = [0];
  for (let i = 1; i < path.length; i++) ends.push(ends[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  const total = ends.at(-1)!;
  if (total === 0) return Array.from({ length: TWEEN_SAMPLES }, () => ({ ...path[0] }));
  let segment = 1;
  return Array.from({ length: TWEEN_SAMPLES }, (_, k) => {
    if (k === 0) return { ...path[0] };
    if (k === TWEEN_SAMPLES - 1) return { ...path.at(-1)! };
    const distance = total * k / (TWEEN_SAMPLES - 1);
    while (segment < path.length - 1 && (ends[segment] < distance || ends[segment] === ends[segment - 1])) segment++;
    const fraction = (distance - ends[segment - 1]) / (ends[segment] - ends[segment - 1]);
    const a = path[segment - 1], b = path[segment];
    return { x: interpolate(a.x, b.x, fraction), y: interpolate(a.y, b.y, fraction) };
  });
}
function interpolateColor(a: string, b: string, t: number): string {
  return '#' + [1, 3, 5].map(offset => Math.round((1 - t) * parseInt(a.slice(offset, offset + 2), 16)
    + t * parseInt(b.slice(offset, offset + 2), 16)).toString(16).padStart(2, '0')).join('');
}
function usage(project: Project, layerId: string): TweenUsage {
  let projectStrokes = 0, projectPoints = 0;
  for (const layer of project.layers) if (layer.kind === 'drawing') for (const cel of layer.cels) {
    projectStrokes += cel.strokes.length;
    for (const stroke of cel.strokes) projectPoints += stroke.points.length;
  }
  const layer = project.layers.find(entry => entry.id === layerId) as DrawingLayer;
  return { layerCels: layer.cels.length, projectStrokes, projectPoints, projectBytes: encoder.encode(JSON.stringify(project)).byteLength };
}
function candidate(source: Project, selection: TweenSelection, generated: DrawingCel[]): Project {
  return validateProject({ ...source, layers: source.layers.map(layer => layer.id === selection.layerId && layer.kind === 'drawing'
    ? { ...layer, cels: [...layer.cels, ...generated].sort((a, b) => a.frame - b.frame) } : layer) });
}

export function buildDrawingTween(project: Project, selected: TweenSelection, requested: TweenChoices): TweenProposal {
  const source = validateProject(project), selection = admitSelection(selected);
  const { layer, start, end } = endpoints(source, selection);
  const choices = admitChoices(requested, selection, start.strokes.length);
  if (layer.cels.length + choices.frames.length > MAX_DRAWING_CELS) throw new Error('A drawing layer can retain at most 24 drawings.');
  const paths = choices.pairs.map(pair => ({ a: resampleStrokePoints(start.strokes[pair.startStroke].points),
    b: resampleStrokePoints(end.strokes[pair.endStroke].points, pair.reverseEnd) }));
  const generated = choices.frames.map(frame => {
    const t = (frame - selection.startFrame) / (selection.endFrame - selection.startFrame);
    const strokes: Stroke[] = choices.pairs.map((pair, i) => {
      const a = start.strokes[pair.startStroke], b = end.strokes[pair.endStroke];
      return { color: interpolateColor(a.color, b.color, t), width: interpolate(a.width, b.width, t),
        points: paths[i].a.map((p, k) => ({ x: interpolate(p.x, paths[i].b[k].x, t),
          y: interpolate(p.y, paths[i].b[k].y, t) })) };
    });
    return { frame, strokes };
  });
  const complete = candidate(source, selection, generated);
  const proposal: TweenProposal = { selection, choices, generated, before: usage(source, selection.layerId), after: usage(complete, selection.layerId) };
  receipts.set(proposal, { source: JSON.stringify(source), proposal: JSON.stringify(proposal) });
  return proposal;
}

/** Validate public data without canonicalizing it before the exact receipt check. */
function validateProposal(value: TweenProposal, source: Project): void {
  const p = record(value, ['selection', 'choices', 'generated', 'before', 'after'], 'Reviewed proposal');
  const selection = admitSelection(p.selection);
  if (Object.is(value.selection.startFrame, -0) || Object.is(value.selection.endFrame, -0)) throw new Error('Reviewed frame values changed.');
  const { start } = endpoints(source, selection);
  const choices = admitChoices(p.choices, selection, start.strokes.length);
  if (value.choices.pairs.some(pair => Object.is(pair.startStroke, -0) || Object.is(pair.endStroke, -0))) throw new Error('Reviewed stroke indices changed.');
  const cels = dataArray(p.generated, choices.frames.length, choices.frames.length, 'Generated drawings');
  cels.forEach((entry, i) => {
    const cel = record(entry, ['frame', 'strokes'], 'Generated drawing');
    if (bounded(cel.frame, 1, 94, 'Generated frame', true) !== choices.frames[i]) throw new Error('Generated frames changed.');
    dataArray(cel.strokes, start.strokes.length, start.strokes.length, 'Generated strokes').forEach(entry => {
      const stroke = record(entry, ['color', 'width', 'points'], 'Generated stroke');
      if (typeof stroke.color !== 'string' || !/^#[0-9a-f]{6}$/.test(stroke.color)) throw new Error('Generated color changed.');
      bounded(stroke.width, 1, 40, 'Generated width');
      dataArray(stroke.points, TWEEN_SAMPLES, TWEEN_SAMPLES, 'Generated points'); points(stroke.points, true);
    });
  });
  for (const label of ['before', 'after'] as const) {
    const u = record(p[label], ['layerCels', 'projectStrokes', 'projectPoints', 'projectBytes'], 'Proposal usage');
    bounded(u.layerCels, 1, 24, 'Drawing count', true);
    bounded(u.projectStrokes, 0, 100, 'Stroke count', true, true);
    bounded(u.projectPoints, 0, 10000, 'Point count', true, true);
    bounded(u.projectBytes, 1, MAX_JSON_BYTES, 'Project bytes', true);
  }
}
function admittedCandidate(current: Project, proposal: TweenProposal): Project {
  const receipt = receipts.get(proposal);
  if (!receipt) throw new Error('Review this proposal in the current workspace before applying it.');
  const source = validateProject(current);
  validateProposal(proposal, source);
  if (JSON.stringify(source) !== receipt.source || JSON.stringify(proposal) !== receipt.proposal) {
    throw new Error('The workspace or proposal changed. Review the in-betweens again.');
  }
  return candidate(source, proposal.selection, proposal.generated);
}
export function previewDrawingTween(current: Project, proposal: TweenProposal): Project { return admittedCandidate(current, proposal); }
export function applyDrawingTween(current: Project, proposal: TweenProposal): Project { return admittedCandidate(current, proposal); }
