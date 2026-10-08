/** Bounded editable vector/raster layers and deterministic transform animation. */
export const WIDTH = 640;
export const HEIGHT = 360;
export const FPS = 12;
export const MAX_FRAMES = 96;
export const SCHEMA_VERSION = 2;
export const MAX_DRAWING_CELS = 24;
export const MAX_JSON_BYTES = 6 * 1024 * 1024 + 168;

export type Point = { x: number; y: number };
export type Stroke = { color: string; width: number; points: Point[] };
export type Pose = { x: number; y: number; scale: number; rotation: number; opacity: number };
export type Easing = 'linear' | 'hold' | 'ease';
export type Keyframe = Pose & { frame: number; easing: Easing };
export type DrawingCel = { frame: number; strokes: Stroke[] };
export type DrawingLayer = { id: string; name: string; kind: 'drawing'; cels: DrawingCel[]; keys: Keyframe[] };
export type ImageLayer = { id: string; name: string; kind: 'image'; image: { dataUrl: string; width: number; height: number }; keys: Keyframe[] };
export type Layer = DrawingLayer | ImageLayer;
export type Project = { schemaVersion: 2; title: string; background: string; frameCount: number; layers: Layer[] };

type Totals = { strokes: number; points: number; images: number };
const MAX_KEYS = 24;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

function object(value: unknown, label: string, fields?: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`${label} must be a plain object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !('value' in descriptors[key]) || !descriptors[key].enumerable
      || (fields && !fields.includes(key))) throw new Error(`${label} has unsupported fields or accessors.`);
  }
  if (fields && fields.some(key => !Object.hasOwn(descriptors, key))) throw new Error(`${label} is missing required fields.`);
  return value as Record<string, unknown>;
}
function array(value: unknown, minimum: number, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < minimum || value.length > maximum) {
    throw new Error(`${label} must contain ${minimum}–${maximum} entries.`);
  }
  if (Reflect.ownKeys(value).length !== value.length + 1) throw new Error(`${label} must be a plain dense data array.`);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor)) throw new Error(`${label} must be a dense data array.`);
  }
  return value;
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
const POSE_FIELDS = ['x', 'y', 'scale', 'rotation', 'opacity'];
function keys(value: unknown, frameCount: number, strict = false): Keyframe[] {
  const entries = array(value, 1, MAX_KEYS, 'Layer keyframes');
  let previous = -1;
  return entries.map((entry, index) => {
    const input = object(entry, 'Keyframe', strict ? [...POSE_FIELDS, 'frame', 'easing'] : undefined);
    const frame = integer(input.frame, 0, frameCount - 1, 'Keyframe frame');
    if ((index === 0 && frame !== 0) || frame <= previous) throw new Error('Keyframes must start at frame 0 and have unique increasing frames.');
    previous = frame;
    return { ...pose(input), frame, easing: easing(input.easing) };
  });
}
function strokes(value: unknown, totals: Totals, strict: boolean): Stroke[] {
  const entries = array(value, 0, 100, 'Drawing strokes');
  totals.strokes += entries.length;
  if (totals.strokes > 100) throw new Error('A project can contain at most 100 strokes across all drawings.');
  return entries.map(entry => {
    const stroke = object(entry, 'Stroke', strict ? ['color', 'width', 'points'] : undefined);
    const points = array(stroke.points, 1, 1000, 'Stroke points');
    totals.points += points.length;
    if (totals.points > 10_000) throw new Error('A project can contain at most 10,000 points across all drawings.');
    return { color: color(stroke.color, 'Stroke color'), width: number(stroke.width, 1, 40, 'Stroke width'),
      points: points.map(entry => {
        const point = object(entry, 'Point', strict ? ['x', 'y'] : undefined);
        return { x: number(point.x, -1280, 1280, 'Point x'), y: number(point.y, -1280, 1280, 'Point y') };
      }) };
  });
}
function layer(value: unknown, frameCount: number, totals: Totals, legacy = false): Layer {
  const input = object(value, 'Layer');
  if (typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.id)) throw new Error('Layer ID must contain 1–64 letters, digits, underscores, or hyphens.');
  const fields = ['id', 'name', 'kind', 'keys'];
  if (!legacy) object(input, 'Layer', [...fields, input.kind === 'drawing' ? 'cels' : 'image']);
  const shared = { id: input.id, name: text(input.name, 40, 'Layer name'), keys: keys(input.keys, frameCount, !legacy) };
  if (input.kind === 'drawing') {
    if (legacy) {
      if (Object.hasOwn(input, 'cels')) throw new Error('A schema-1 drawing cannot contain cels.');
      return { ...shared, kind: 'drawing', cels: [{ frame: 0, strokes: strokes(input.strokes, totals, false) }] };
    }
    let previous = -1;
    const cels = array(input.cels, 1, MAX_DRAWING_CELS, 'Drawing cels').map((entry, index) => {
      const cel = object(entry, 'Drawing cel', ['frame', 'strokes']);
      const frame = integer(cel.frame, 0, frameCount - 1, 'Drawing cel frame');
      if ((index === 0 && frame !== 0) || frame <= previous) throw new Error('Drawing cels must start at frame 0 and have unique increasing frames.');
      previous = frame;
      return { frame, strokes: strokes(cel.strokes, totals, true) };
    });
    return { ...shared, kind: 'drawing', cels };
  }
  if (input.kind === 'image') {
    if (Object.hasOwn(input, 'cels') || Object.hasOwn(input, 'strokes')) throw new Error('Images cannot contain drawing fields.');
    totals.images++;
    if (totals.images > 4) throw new Error('A project can contain at most 4 images.');
    const image = object(input.image, 'Image', legacy ? undefined : ['dataUrl', 'width', 'height']);
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

/** Migrate genuine legacy known fields, or admit strict canonical2, without changing input. */
export function validateProject(value: unknown): Project {
  const input = object(value, 'Project');
  const legacy = input.schemaVersion === 1;
  if (!legacy && input.schemaVersion !== SCHEMA_VERSION) throw new Error('Unsupported project schema version.');
  if (!legacy) object(input, 'Project', ['schemaVersion', 'title', 'background', 'frameCount', 'layers']);
  const frameCount = integer(input.frameCount, 12, MAX_FRAMES, 'Timeline frame count');
  const entries = array(input.layers, 0, 8, 'Project layers');
  const totals = { strokes: 0, points: 0, images: 0 };
  const layers = entries.map(entry => layer(entry, frameCount, totals, legacy));
  if (new Set(layers.map(entry => entry.id)).size !== layers.length) throw new Error('Layer IDs must be unique.');
  const project: Project = { schemaVersion: SCHEMA_VERSION, title: text(input.title, 80, 'Project title'),
    background: color(input.background, 'Background'), frameCount, layers };
  const encoder = new TextEncoder();
  if (legacy) {
    const original = { ...project, schemaVersion: 1, layers: layers.map(entry => entry.kind === 'drawing'
      ? { id: entry.id, name: entry.name, keys: entry.keys, kind: entry.kind, strokes: entry.cels[0].strokes } : entry) };
    if (encoder.encode(JSON.stringify(original)).byteLength > 6 * 1024 * 1024) throw new Error('Legacy project JSON exceeds the 6 MiB limit.');
  }
  if (encoder.encode(JSON.stringify(project)).byteLength > MAX_JSON_BYTES) throw new Error('Project JSON exceeds the 6 MiB + 168 byte limit.');
  return project;
}

export function createDrawingLayer(name = 'Drawing'): DrawingLayer {
  return { id: crypto.randomUUID(), name: text(name, 40, 'Layer name'), kind: 'drawing', cels: [{ frame: 0, strokes: [] }],
    keys: [{ frame: 0, x: WIDTH / 2, y: HEIGHT / 2, scale: 1, rotation: 0, opacity: 1, easing: 'linear' }] };
}
export function createProject(): Project {
  return { schemaVersion: SCHEMA_VERSION, title: 'Untitled motion', background: '#F7F4EE', frameCount: 48, layers: [createDrawingLayer()] };
}

/** Original parametric ellipse, sun and moving comet, generated without external assets. */
export function createDemo(): Project {
  const orbit = createDrawingLayer('Orbit path');
  orbit.cels[0].strokes = [{ color: '#BAC9C8', width: 3, points: Array.from({ length: 97 }, (_, index) => {
    const angle = index / 96 * Math.PI * 2;
    return { x: 180 * Math.cos(angle), y: 75 * Math.sin(angle) };
  }) }];
  const sun = createDrawingLayer('Little sun');
  sun.cels[0].strokes = [ { color: '#E7AE59', width: 18, points: Array.from({ length: 49 }, (_, index) => {
    const angle = index / 48 * Math.PI * 2;
    return { x: 18 * Math.cos(angle), y: 18 * Math.sin(angle) };
  }) }, ...Array.from({ length: 8 }, (_, index) => {
    const angle = index * Math.PI / 4;
    return { color: '#E7AE59', width: 4, points: [31, 42].map(radius => ({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) })) };
  }) ];
  const comet = createDrawingLayer('Traveling comet');
  comet.cels[0].strokes = [ { color: '#367D81', width: 7, points: [ { x: -20, y: -12 }, { x: 15, y: 0 }, { x: -20, y: 12 } ] },
    { color: '#7EA6A2', width: 4, points: [{ x: -42, y: 0 }, { x: -10, y: 0 }] } ];
  comet.keys = [0, 12, 24, 36, 47].map((frame, index) => {
    const angle = index * Math.PI / 2;
    return { frame, x: WIDTH / 2 + 180 * Math.cos(angle), y: HEIGHT / 2 + 75 * Math.sin(angle),
      scale: 1, rotation: index * 90, opacity: 1, easing: 'ease' };
  });
  return validateProject({ schemaVersion: SCHEMA_VERSION, title: 'Orbit study — original demo', background: '#F7F4EE', frameCount: 48, layers: [orbit, sun, comet] });
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
export function resizeTimeline(input: Project, frameCount: number, options?: { discardLater?: boolean }): Project {
  integer(frameCount, 12, MAX_FRAMES, 'Timeline frame count');
  let discardLater = false;
  if (options !== undefined) {
    const settings = object(options, 'Resize options');
    if (Object.keys(settings).some(key => key !== 'discardLater')
      || (Object.hasOwn(settings, 'discardLater') && typeof settings.discardLater !== 'boolean')) {
      throw new Error('Resize options support only a boolean discardLater.');
    }
    discardLater = settings.discardLater === true;
  }
  const result = validateProject(input);
  const loss = resizeLoss(result, frameCount);
  if (!discardLater && (loss.removedCels.length || loss.removedKeys.length)) {
    throw new Error('Shortening removes later drawings or keyframes; explicit discardLater consent is required.');
  }
  if (frameCount < result.frameCount) {
    const endpoint = frameCount - 1;
    result.layers = result.layers.map(entry => {
      const endpointPose = evaluatePose(entry, endpoint);
      const retained = { ...entry, keys: entry.keys.filter(key => key.frame <= endpoint) };
      if (retained.kind === 'drawing') retained.cels = retained.cels.filter(cel => cel.frame <= endpoint);
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

export type TimelineResizeLoss = {
  removedCels: { layerId: string; frame: number }[];
  removedKeys: { layerId: string; frame: number }[];
};

/** Shared bounded cut rule. Rendering uses this on its already-admitted snapshot. */
export function drawingCelIndex(cels: readonly DrawingCel[], frame: number): number {
  if (!Number.isFinite(frame)) throw new Error('Animation frame must be finite.');
  const entries = array(cels, 1, MAX_DRAWING_CELS, 'Drawing cels');
  let previous = -1;
  let selected = 0;
  for (let index = 0; index < entries.length; index++) {
    const cel = object(entries[index], 'Drawing cel');
    const start = integer(cel.frame, 0, MAX_FRAMES - 1, 'Drawing cel frame');
    if ((index === 0 && start !== 0) || start <= previous) throw new Error('Drawing cels must start at frame 0 and have unique increasing frames.');
    previous = start;
    if (start <= frame) selected = index;
  }
  return selected;
}
export function evaluateDrawingCel(input: DrawingLayer, frame: number): DrawingCel {
  if (!Number.isFinite(frame)) throw new Error('Animation frame must be finite.');
  const admitted = layer(input, MAX_FRAMES, { strokes: 0, points: 0, images: 0 });
  if (admitted.kind !== 'drawing') throw new Error('Only drawing layers have drawing cels.');
  return admitted.cels[drawingCelIndex(admitted.cels, frame)];
}
function drawingTarget(input: Project, layerId: string, frame: number): { project: Project; drawing: DrawingLayer } {
  const project = validateProject(input);
  integer(frame, 0, project.frameCount - 1, 'Drawing cel frame');
  const selected = project.layers.find(entry => entry.id === layerId);
  if (!selected || selected.kind !== 'drawing') throw new Error('Select an existing drawing layer.');
  return { project, drawing: selected };
}
function insertCel(input: Project, layerId: string, frame: number, duplicate: boolean): Project {
  const { project, drawing } = drawingTarget(input, layerId, frame);
  if (drawing.cels.some(cel => cel.frame === frame)) throw new Error('A drawing already starts at this frame; choose a new boundary.');
  if (drawing.cels.length >= MAX_DRAWING_CELS) throw new Error('A layer can contain at most 24 drawing cels.');
  // Validation below copies each occurrence independently, including this duplicate.
  const artwork = duplicate ? drawing.cels[drawingCelIndex(drawing.cels, frame)].strokes : [];
  drawing.cels.push({ frame, strokes: artwork });
  drawing.cels.sort((left, right) => left.frame - right.frame);
  try { return validateProject(project); }
  catch (error) {
    if (duplicate && error instanceof Error) throw new Error(`Copying a drawing consumes the project artwork budget. ${error.message}`);
    throw error;
  }
}
export function addBlankDrawingCel(input: Project, layerId: string, frame: number): Project {
  return insertCel(input, layerId, frame, false);
}
export function duplicateDrawingCel(input: Project, layerId: string, frame: number): Project {
  return insertCel(input, layerId, frame, true);
}
export function replaceDrawingCelStrokes(input: Project, layerId: string, celFrame: number, replacement: Stroke[]): Project {
  const { project, drawing } = drawingTarget(input, layerId, celFrame);
  const cel = drawing.cels.find(entry => entry.frame === celFrame);
  if (!cel) throw new Error('There is no drawing boundary at this frame.');
  cel.strokes = replacement;
  return validateProject(project);
}
export function removeDrawingCel(input: Project, layerId: string, celFrame: number): Project {
  const { project, drawing } = drawingTarget(input, layerId, celFrame);
  if (celFrame === 0) throw new Error('The first drawing at frame 0 cannot be removed.');
  if (!drawing.cels.some(entry => entry.frame === celFrame)) throw new Error('There is no drawing boundary at this frame.');
  drawing.cels = drawing.cels.filter(entry => entry.frame !== celFrame);
  return validateProject(project);
}
function resizeLoss(input: Project, frameCount: number): TimelineResizeLoss {
  return {
    removedCels: input.layers.flatMap(entry => entry.kind === 'drawing'
      ? entry.cels.filter(cel => cel.frame >= frameCount).map(cel => ({ layerId: entry.id, frame: cel.frame })) : []),
    removedKeys: input.layers.flatMap(entry => entry.keys.filter(key => key.frame >= frameCount)
      .map(key => ({ layerId: entry.id, frame: key.frame }))),
  };
}
export function timelineResizeLoss(input: Project, frameCount: number): TimelineResizeLoss {
  const project = validateProject(input);
  integer(frameCount, 12, MAX_FRAMES, 'Timeline frame count');
  return resizeLoss(project, frameCount);
}
