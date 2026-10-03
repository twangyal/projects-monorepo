/** Bounded editable vector/raster layers and deterministic transform animation. */
export const WIDTH = 640;
export const HEIGHT = 360;
export const FPS = 12;
export const MAX_FRAMES = 96;
export const MAX_JSON_BYTES = 6 * 1024 * 1024;

export type Point = { x: number; y: number };
export type Stroke = { color: string; width: number; points: Point[] };
export type Pose = { x: number; y: number; scale: number; rotation: number; opacity: number };
export type Easing = 'linear' | 'hold' | 'ease';
export type Keyframe = Pose & { frame: number; easing: Easing };
export type DrawingLayer = { id: string; name: string; kind: 'drawing'; strokes: Stroke[]; keys: Keyframe[] };
export type ImageLayer = { id: string; name: string; kind: 'image'; image: { dataUrl: string; width: number; height: number }; keys: Keyframe[] };
export type Layer = DrawingLayer | ImageLayer;
export type Project = { schemaVersion: 1; title: string; background: string; frameCount: number; layers: Layer[] };

type Totals = { strokes: number; points: number; images: number };
const MAX_KEYS = 24;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || value.includes('\0')) {
    throw new Error(`${label} must contain 1–${maximum} characters.`);
  }
  return value;
}
function number(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a finite number from ${minimum} to ${maximum}.`);
  }
  return value;
}
function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  const result = number(value, minimum, maximum, label);
  if (!Number.isInteger(result)) throw new Error(`${label} must be an integer.`);
  return result;
}
function color(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`${label} must use #RRGGBB notation.`);
  return value;
}
function easing(value: unknown): Easing {
  if (value !== 'linear' && value !== 'hold' && value !== 'ease') throw new Error('Easing must be linear, hold, or ease.');
  return value;
}
function pose(value: unknown): Pose {
  const input = object(value, 'Pose');
  return {
    x: number(input.x, -640, 1280, 'Pose x'),
    y: number(input.y, -360, 720, 'Pose y'),
    scale: number(input.scale, 0.1, 4, 'Scale'),
    rotation: number(input.rotation, -720, 720, 'Rotation'),
    opacity: number(input.opacity, 0, 1, 'Opacity'),
  };
}
function keys(value: unknown, frameCount: number): Keyframe[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_KEYS) throw new Error('Each layer must have 1–24 keyframes.');
  let previous = -1;
  return Array.from(value, (entry, index) => {
    const input = object(entry, 'Keyframe');
    const frame = integer(input.frame, 0, frameCount - 1, 'Keyframe frame');
    if ((index === 0 && frame !== 0) || frame <= previous) throw new Error('Keyframes must start at frame 0 and have unique increasing frames.');
    previous = frame;
    return { ...pose(input), frame, easing: easing(input.easing) };
  });
}
function layer(value: unknown, frameCount: number, totals: Totals): Layer {
  const input = object(value, 'Layer');
  if (typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.id)) throw new Error('Layer ID must contain 1–64 letters, digits, underscores, or hyphens.');
  const shared = { id: input.id, name: text(input.name, 40, 'Layer name'), keys: keys(input.keys, frameCount) };
  if (input.kind === 'drawing') {
    if (!Array.isArray(input.strokes)) throw new Error('Drawing strokes must be an array.');
    totals.strokes += input.strokes.length;
    if (totals.strokes > 100) throw new Error('A project can contain at most 100 strokes.');
    const strokes = Array.from(input.strokes, entry => {
      const stroke = object(entry, 'Stroke');
      if (!Array.isArray(stroke.points) || stroke.points.length < 1 || stroke.points.length > 1000) throw new Error('Each stroke must contain 1–1000 points.');
      totals.points += stroke.points.length;
      if (totals.points > 10_000) throw new Error('A project can contain at most 10,000 points.');
      return { color: color(stroke.color, 'Stroke color'), width: number(stroke.width, 1, 40, 'Stroke width'),
        points: Array.from(stroke.points, entry => {
          const point = object(entry, 'Point');
          return { x: number(point.x, -1280, 1280, 'Point x'), y: number(point.y, -1280, 1280, 'Point y') };
        }) };
    });
    return { ...shared, kind: 'drawing', strokes };
  }
  if (input.kind === 'image') {
    totals.images++;
    if (totals.images > 4) throw new Error('A project can contain at most 4 images.');
    const image = object(input.image, 'Image');
    if (typeof image.dataUrl !== 'string' || image.dataUrl.length > MAX_IMAGE_BYTES || !image.dataUrl.startsWith('data:image/png;base64,')) {
      throw new Error('Images must be embedded PNG data URLs of at most 1.5 MiB.');
    }
    const encoded = image.dataUrl.slice('data:image/png;base64,'.length);
    if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Image data must contain valid base64.');
    return { ...shared, kind: 'image', image: { dataUrl: image.dataUrl,
      width: integer(image.width, 1, 800, 'Image width'), height: integer(image.height, 1, 800, 'Image height') } };
  }
  throw new Error('Layer kind must be drawing or image.');
}

/** Reconstruct only known fields. Image pixels must also be checked by the image loader. */
export function validateProject(value: unknown): Project {
  const input = object(value, 'Project');
  if (input.schemaVersion !== 1) throw new Error('Unsupported project schema version.');
  const frameCount = integer(input.frameCount, 12, MAX_FRAMES, 'Timeline frame count');
  if (!Array.isArray(input.layers) || input.layers.length > 8) throw new Error('A project can contain at most 8 layers.');
  const totals = { strokes: 0, points: 0, images: 0 };
  const layers = Array.from(input.layers, entry => layer(entry, frameCount, totals));
  if (new Set(layers.map(entry => entry.id)).size !== layers.length) throw new Error('Layer IDs must be unique.');
  const project: Project = { schemaVersion: 1, title: text(input.title, 80, 'Project title'),
    background: color(input.background, 'Background'), frameCount, layers };
  if (new TextEncoder().encode(JSON.stringify(project)).byteLength > MAX_JSON_BYTES) throw new Error('Project JSON exceeds the 6 MiB limit.');
  return project;
}

export function createDrawingLayer(name = 'Drawing'): DrawingLayer {
  return { id: crypto.randomUUID(), name: text(name, 40, 'Layer name'), kind: 'drawing', strokes: [],
    keys: [{ frame: 0, x: WIDTH / 2, y: HEIGHT / 2, scale: 1, rotation: 0, opacity: 1, easing: 'linear' }] };
}
export function createProject(): Project {
  return { schemaVersion: 1, title: 'Untitled motion', background: '#F7F4EE', frameCount: 48, layers: [createDrawingLayer()] };
}

/** Original parametric ellipse, sun and moving comet, generated without external assets. */
export function createDemo(): Project {
  const orbit = createDrawingLayer('Orbit path');
  orbit.strokes = [{ color: '#BAC9C8', width: 3, points: Array.from({ length: 97 }, (_, index) => {
    const angle = index / 96 * Math.PI * 2;
    return { x: 180 * Math.cos(angle), y: 75 * Math.sin(angle) };
  }) }];
  const sun = createDrawingLayer('Little sun');
  sun.strokes = [ { color: '#E7AE59', width: 18, points: Array.from({ length: 49 }, (_, index) => {
    const angle = index / 48 * Math.PI * 2;
    return { x: 18 * Math.cos(angle), y: 18 * Math.sin(angle) };
  }) }, ...Array.from({ length: 8 }, (_, index) => {
    const angle = index * Math.PI / 4;
    return { color: '#E7AE59', width: 4, points: [31, 42].map(radius => ({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) })) };
  }) ];
  const comet = createDrawingLayer('Traveling comet');
  comet.strokes = [ { color: '#367D81', width: 7, points: [ { x: -20, y: -12 }, { x: 15, y: 0 }, { x: -20, y: 12 } ] },
    { color: '#7EA6A2', width: 4, points: [{ x: -42, y: 0 }, { x: -10, y: 0 }] } ];
  comet.keys = [0, 12, 24, 36, 47].map((frame, index) => {
    const angle = index * Math.PI / 2;
    return { frame, x: WIDTH / 2 + 180 * Math.cos(angle), y: HEIGHT / 2 + 75 * Math.sin(angle),
      scale: 1, rotation: index * 90, opacity: 1, easing: 'ease' };
  });
  return validateProject({ schemaVersion: 1, title: 'Orbit study — original demo', background: '#F7F4EE', frameCount: 48, layers: [orbit, sun, comet] });
}

export function evaluatePose(input: Layer, frame: number): Pose {
  if (!Number.isFinite(frame)) throw new Error('Animation frame must be finite.');
  const timeline = keys(input.keys, MAX_FRAMES);
  if (frame <= 0) return pose(timeline[0]);
  for (let index = 1; index < timeline.length; index++) {
    const right = timeline[index];
    if (frame < right.frame) {
      const left = timeline[index - 1];
      let fraction = (frame - left.frame) / (right.frame - left.frame);
      if (left.easing === 'hold') fraction = 0;
      else if (left.easing === 'ease') fraction = fraction * fraction * (3 - 2 * fraction);
      const interpolate = (key: keyof Pose) => left[key] + (right[key] - left[key]) * fraction;
      return { x: interpolate('x'), y: interpolate('y'), scale: interpolate('scale'),
        rotation: interpolate('rotation'), opacity: interpolate('opacity') };
    }
  }
  return pose(timeline[timeline.length - 1]);
}

export function upsertKeyframe(input: Layer, frame: number, value: Pose, requestedEasing?: Easing): Layer {
  integer(frame, 0, MAX_FRAMES - 1, 'Keyframe frame');
  const result = layer(input, MAX_FRAMES, { strokes: 0, points: 0, images: 0 });
  const existing = result.keys.find(key => key.frame === frame);
  const replacement: Keyframe = { ...pose(value), frame, easing: easing(requestedEasing ?? existing?.easing ?? 'linear') };
  if (!existing && result.keys.length >= MAX_KEYS) throw new Error('A layer can contain at most 24 keyframes.');
  result.keys = [...result.keys.filter(key => key.frame !== frame), replacement].sort((a, b) => a.frame - b.frame);
  return result;
}
export function removeKeyframe(input: Layer, frame: number): Layer {
  integer(frame, 0, MAX_FRAMES - 1, 'Keyframe frame');
  if (frame === 0) throw new Error('The first keyframe at frame 0 cannot be removed.');
  const result = layer(input, MAX_FRAMES, { strokes: 0, points: 0, images: 0 });
  if (!result.keys.some(key => key.frame === frame)) throw new Error('There is no keyframe at this frame.');
  result.keys = result.keys.filter(key => key.frame !== frame);
  return result;
}
export function resizeTimeline(input: Project, frameCount: number): Project {
  integer(frameCount, 12, MAX_FRAMES, 'Timeline frame count');
  const result = validateProject(input);
  if (frameCount < result.frameCount) {
    const endpoint = frameCount - 1;
    result.layers = result.layers.map(entry => {
      const endpointPose = evaluatePose(entry, endpoint);
      const retained = { ...entry, keys: entry.keys.filter(key => key.frame <= endpoint) };
      return upsertKeyframe(retained, endpoint, endpointPose);
    });
  }
  result.frameCount = frameCount;
  return validateProject(result);
}
export function localPoint(point: Point, value: Pose): Point {
  const transform = pose(value);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Pointer coordinates must be finite.');
  const angle = transform.rotation * Math.PI / 180;
  const x = point.x - transform.x;
  const y = point.y - transform.y;
  const result = { x: (Math.cos(angle) * x + Math.sin(angle) * y) / transform.scale,
    y: (-Math.sin(angle) * x + Math.cos(angle) * y) / transform.scale };
  if (!Number.isFinite(result.x) || !Number.isFinite(result.y)) throw new Error('Transformed pointer coordinates are too large.');
  return result;
}
