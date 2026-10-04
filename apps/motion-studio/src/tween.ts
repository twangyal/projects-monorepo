/** Explicit, source-bound geometric proposals. No learned or inferred correspondence. */
import { MAX_FRAMES, MAX_DRAWING_CELS, MAX_JSON_BYTES, validateProject, type DrawingCel, type DrawingLayer, type Point, type Project, type Stroke } from './model.ts';

export const TWEEN_SAMPLES = 64;
export const MAX_TWEEN_PAIRS = 8;
export interface TweenSelection { layerId: string; startFrame: number; endFrame: number }
export interface TweenPair { startStroke: number; endStroke: number; reverseEnd: boolean }
export interface TweenChoices { pairs: TweenPair[]; frames: number[] }
export interface TweenUsage { layerCels: number; projectStrokes: number; projectPoints: number; projectBytes: number }
export interface TweenProposal {
  selection: TweenSelection; choices: TweenChoices;
  generated: DrawingCel[]; before: TweenUsage; after: TweenUsage;
}
const receipts = new WeakMap<TweenProposal, { source: string; proposal: string }>();
const encoder = new TextEncoder();
function fail(message: string): never { throw new Error(message); }
const positiveZero = (value: number): number => value === 0 ? 0 : value;
// Evaluate the same affine interpolation from its nearer endpoint. Even
// unequal legal values one ulp apart can overflow a bound in the weighted sum.
// This changes no bounds and performs no clamping or coordinate quantization.
const interpolate = (a: number, b: number, t: number): number =>
  positiveZero(t <= .5 ? a + (b - a) * t : b + (a - b) * (1 - t));

function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain data object.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const own = Reflect.ownKeys(descriptors);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) fail(`${label} has unsupported or missing fields.`);
  for (const key of keys) {
    const field = descriptors[key];
    if (!field || !field.enumerable || !('value' in field)) fail(`${label} must not contain accessors.`);
  }
  return value as Record<string, unknown>;
}
function array(value: unknown, minimum: number, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < minimum || value.length > maximum) fail(`${label} has an unsupported count.`);
  if (Reflect.ownKeys(value).length !== value.length + 1) fail(`${label} must be a dense data array.`);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !('value' in descriptor)) fail(`${label} must be a dense array without accessors.`);
  }
  return value;
}
function number(value: unknown, minimum: number, maximum: number, label: string, exactZero = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (exactZero && Object.is(value, -0))) fail(`${label} must be a finite bounded number.`);
  return positiveZero(value);
}
function integer(value: unknown, minimum: number, maximum: number, label: string, exactZero = false): number {
  const result = number(value, minimum, maximum, label, exactZero);
  if (!Number.isInteger(result)) fail(`${label} must be an integer.`);
  return result;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} must be true or false.`);
  return value;
}
function point(value: unknown, exactZero = false): Point {
  const input = object(value, ['x', 'y'], 'Stroke point');
  return { x: number(input.x, -1280, 1280, 'Point x', exactZero), y: number(input.y, -1280, 1280, 'Point y', exactZero) };
}
function selection(value: unknown, exactZero = false): TweenSelection {
  const input = object(value, ['layerId', 'startFrame', 'endFrame'], 'Tween selection');
  if (typeof input.layerId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.layerId)) fail('Choose an existing drawing layer.');
  const startFrame = integer(input.startFrame, 0, MAX_FRAMES - 1, 'Starting frame', exactZero);
  const endFrame = integer(input.endFrame, 0, MAX_FRAMES - 1, 'Ending frame', exactZero);
  if (endFrame <= startFrame + 1) fail('Choose two drawings with an interior frame between them.');
  return { layerId: input.layerId, startFrame, endFrame };
}
function choices(value: unknown, selected: TweenSelection, expectedPairs?: number, exactZero = false): TweenChoices {
  const input = object(value, ['pairs', 'frames'], 'Tween choices');
  const used = new Set<number>();
  const pairs = array(input.pairs, 1, MAX_TWEEN_PAIRS, 'Stroke pairs').map((value, index): TweenPair => {
    const pair = object(value, ['startStroke', 'endStroke', 'reverseEnd'], 'Stroke pair');
    const startStroke = integer(pair.startStroke, 0, MAX_TWEEN_PAIRS - 1, 'Starting stroke', exactZero);
    const endStroke = integer(pair.endStroke, 0, MAX_TWEEN_PAIRS - 1, 'Ending stroke', exactZero);
    if (startStroke !== index || used.has(endStroke)) fail('Pair every starting stroke with a different ending stroke, in starting order.');
    used.add(endStroke);
    return { startStroke, endStroke, reverseEnd: boolean(pair.reverseEnd, 'Ending direction') };
  });
  if ((expectedPairs !== undefined && pairs.length !== expectedPairs) || pairs.some(pair => pair.endStroke >= pairs.length)) fail('Pair every starting and ending stroke exactly once.');
  let previous = selected.startFrame;
  const frames = array(input.frames, 1, MAX_DRAWING_CELS - 2, 'New drawing frames').map(value => {
    const frame = integer(value, selected.startFrame + 1, selected.endFrame - 1, 'New drawing frame', exactZero);
    if (frame <= previous) fail('New drawing frames must be unique and increasing inside the endpoints.');
    previous = frame;
    return frame;
  });
  return { pairs, frames };
}

export function planTweenFrames(startFrame: number, endFrame: number, count: number): number[] {
  const start = integer(startFrame, 0, MAX_FRAMES - 1, 'Starting frame');
  const end = integer(endFrame, 0, MAX_FRAMES - 1, 'Ending frame');
  const total = integer(count, 1, MAX_DRAWING_CELS - 2, 'New drawing count');
  if (end <= start || total >= end - start) fail('Choose no more new drawings than there are interior frames.');
  return Array.from({ length: total }, (_, index) => start + Math.floor((index + 1) * (end - start) / (total + 1)));
}

type Segment = { a: Point; b: Point; length: number; from: number; to: number };
function sample(points: readonly Point[], reverse: boolean): Point[] {
  const ordered = reverse ? [...points].reverse() : points;
  const segments: Segment[] = [];
  let total = 0;
  for (let index = 1; index < ordered.length; index++) {
    const a = ordered[index - 1], b = ordered[index], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    segments.push({ a, b, length, from: total, to: total + length });
    total += length;
  }
  const copy = (p: Point): Point => ({ x: positiveZero(p.x), y: positiveZero(p.y) });
  if (total === 0) return Array.from({ length: TWEEN_SAMPLES }, () => copy(ordered[0]));
  let segment = 0;
  return Array.from({ length: TWEEN_SAMPLES }, (_, index) => {
    if (index === 0) return copy(ordered[0]);
    if (index === TWEEN_SAMPLES - 1) return copy(ordered.at(-1)!);
    const distance = total * index / (TWEEN_SAMPLES - 1);
    while (distance > segments[segment].to && segment + 1 < segments.length) segment++;
    const { a, b, from, length } = segments[segment], q = (distance - from) / length;
    return { x: interpolate(a.x, b.x, q), y: interpolate(a.y, b.y, q) };
  });
}
export function resampleStrokePoints(points: readonly Point[], reverse = false): Point[] {
  const input = array(points, 1, 1000, 'Stroke points').map(value => point(value));
  return sample(input, boolean(reverse, 'Ending direction'));
}

function selectedLayer(project: Project, selected: TweenSelection): DrawingLayer {
  const layer = project.layers.find(layer => layer.id === selected.layerId);
  if (!layer || layer.kind !== 'drawing') fail('Choose an existing drawing layer with two endpoint drawings.');
  return layer;
}
function usage(project: Project, layerId: string, json: string): TweenUsage {
  let projectStrokes = 0, projectPoints = 0;
  for (const layer of project.layers) if (layer.kind === 'drawing') for (const cel of layer.cels) {
    projectStrokes += cel.strokes.length;
    for (const stroke of cel.strokes) projectPoints += stroke.points.length;
  }
  const selected = project.layers.find(layer => layer.id === layerId) as DrawingLayer;
  return { layerCels: selected.cels.length, projectStrokes, projectPoints, projectBytes: encoder.encode(json).length };
}
function candidate(project: Project, selected: TweenSelection, generated: DrawingCel[]): Project {
  const layer = selectedLayer(project, selected);
  layer.cels = [...layer.cels, ...generated].sort((a, b) => a.frame - b.frame);
  return validateProject(project);
}
const channels = (color: string): number[] => [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
function interpolateColor(a: number[], b: number[], t: number): string {
  return '#' + a.map((channel, index) => Math.round((1 - t) * channel + t * b[index]).toString(16).padStart(2, '0')).join('');
}

export function buildDrawingTween(project: Project, selected: TweenSelection, requested: TweenChoices): TweenProposal {
  const admitted = validateProject(project), selectedSafe = selection(selected), layer = selectedLayer(admitted, selectedSafe);
  const index = layer.cels.findIndex(cel => cel.frame === selectedSafe.startFrame);
  const start = layer.cels[index], end = layer.cels[index + 1];
  if (!start || !end || end.frame !== selectedSafe.endFrame) fail('Choose adjacent existing drawings; no intervening artwork may be replaced.');
  if (start.strokes.length < 1 || start.strokes.length > MAX_TWEEN_PAIRS || start.strokes.length !== end.strokes.length) fail('Endpoint drawings need the same number of strokes, from 1 to 8. Blank or unmatched drawings cannot be tweened.');
  const selectedChoices = choices(requested, selectedSafe, start.strokes.length);
  const sourceJson = JSON.stringify(admitted), before = usage(admitted, selectedSafe.layerId, sourceJson);
  const addedStrokes = selectedChoices.frames.length * start.strokes.length;
  if (before.layerCels + selectedChoices.frames.length > MAX_DRAWING_CELS) fail('This proposal would exceed the 24-drawing layer limit.');
  if (before.projectStrokes + addedStrokes > 100) fail('This proposal would exceed 100 retained project strokes.');
  if (before.projectPoints + addedStrokes * TWEEN_SAMPLES > 10_000) fail('This proposal would exceed 10,000 retained project points.');
  const sampled = selectedChoices.pairs.map(pair => {
    const a = start.strokes[pair.startStroke], b = end.strokes[pair.endStroke];
    return { start: sample(a.points, false), end: sample(b.points, pair.reverseEnd), widthA: a.width, widthB: b.width, colorA: channels(a.color), colorB: channels(b.color) };
  });
  const generated = selectedChoices.frames.map(frame => {
    const t = (frame - selectedSafe.startFrame) / (selectedSafe.endFrame - selectedSafe.startFrame);
    const strokes: Stroke[] = sampled.map(stroke => ({
      color: interpolateColor(stroke.colorA, stroke.colorB, t), width: interpolate(stroke.widthA, stroke.widthB, t),
      points: stroke.start.map((a, index) => ({ x: interpolate(a.x, stroke.end[index].x, t), y: interpolate(a.y, stroke.end[index].y, t) })),
    }));
    return { frame, strokes };
  });
  const complete = candidate(admitted, selectedSafe, generated);
  const after = usage(complete, selectedSafe.layerId, JSON.stringify(complete));
  const proposal = { selection: selectedSafe, choices: selectedChoices, generated, before, after };
  receipts.set(proposal, { source: sourceJson, proposal: JSON.stringify(proposal) });
  return proposal;
}

function admittedUsage(value: unknown): TweenUsage {
  const input = object(value, ['layerCels', 'projectStrokes', 'projectPoints', 'projectBytes'], 'Tween usage');
  return { layerCels: integer(input.layerCels, 2, MAX_DRAWING_CELS, 'Layer drawing count', true), projectStrokes: integer(input.projectStrokes, 0, 100, 'Project stroke count', true), projectPoints: integer(input.projectPoints, 0, 10_000, 'Project point count', true), projectBytes: integer(input.projectBytes, 1, MAX_JSON_BYTES, 'Project byte count', true) };
}
function admitProposal(value: unknown): TweenProposal {
  const input = object(value, ['selection', 'choices', 'generated', 'before', 'after'], 'Tween proposal');
  const selected = selection(input.selection, true), requested = choices(input.choices, selected, undefined, true);
  const generated = array(input.generated, requested.frames.length, requested.frames.length, 'Generated drawings').map((value, index): DrawingCel => {
    const cel = object(value, ['frame', 'strokes'], 'Generated drawing');
    const frame = integer(cel.frame, selected.startFrame + 1, selected.endFrame - 1, 'Generated frame', true);
    if (frame !== requested.frames[index]) fail('Generated frames must match the reviewed selection.');
    const strokes = array(cel.strokes, requested.pairs.length, requested.pairs.length, 'Generated strokes').map((value): Stroke => {
      const stroke = object(value, ['color', 'width', 'points'], 'Generated stroke');
      if (typeof stroke.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(stroke.color)) fail('Generated color must be a six-digit hex color.');
      return { color: stroke.color, width: number(stroke.width, 1, 40, 'Generated width', true), points: array(stroke.points, TWEEN_SAMPLES, TWEEN_SAMPLES, 'Generated points').map(value => point(value, true)) };
    });
    return { frame, strokes };
  });
  return { selection: selected, choices: requested, generated, before: admittedUsage(input.before), after: admittedUsage(input.after) };
}
function reviewedCandidate(current: Project, proposal: TweenProposal): Project {
  const receipt = proposal && typeof proposal === 'object' ? receipts.get(proposal) : undefined;
  if (!receipt) fail('Review this drawing proposal again before previewing or applying it.');
  // Shape admission must not invoke accessors or normalize a mutated raw receipt.
  const safe = admitProposal(proposal);
  if (JSON.stringify(proposal) !== receipt.proposal) fail('The reviewed proposal changed. Review the drawing choices again.');
  const source = validateProject(current);
  if (JSON.stringify(source) !== receipt.source) fail('The source project changed. Review the drawing choices again.');
  return candidate(source, safe.selection, safe.generated);
}
export function previewDrawingTween(current: Project, proposal: TweenProposal): Project {
  return reviewedCandidate(current, proposal);
}
export function applyDrawingTween(current: Project, proposal: TweenProposal): Project {
  return reviewedCandidate(current, proposal);
}
