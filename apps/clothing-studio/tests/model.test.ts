import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProject, parseProject, serializeProject, validateProject, ProjectHistory,
  MAX_PROJECT_BYTES, MAX_PHOTO_DATA_URL_LENGTH, MAX_PHOTO_EDGE,
  MAX_STROKES, MAX_STROKE_POINTS, MAX_TOTAL_POINTS, MAX_HISTORY_STEPS,
} from '../src/model.ts';
import type { Project } from '../src/model.ts';

const fixture = (): Project => ({
  schemaVersion: 1, title: 'First concept', note: 'A local note <script>',
  garment: { bodyWidth: 220, bodyLength: 250, sleeveLength: 45, neckline: 'round', color: '#d89476', pattern: 'plain', patternColor: '#f7ead7' },
  strokes: [{ id: 'stroke-one', color: '#112233', width: 4, points: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.9 }] }],
  placement: { x: 0.5, y: 0.42, width: 0.6, height: 0.5, rotation: 0, opacity: 1 },
  photo: { dataUrl: 'data:image/jpeg;base64,AA==', width: 600, height: 800, name: 'Sample.jpg' },
});

function assertIndependent(source: Project, result: Project): void {
  assert.notEqual(result, source);
  assert.notEqual(result.garment, source.garment);
  assert.notEqual(result.placement, source.placement);
  assert.notEqual(result.strokes, source.strokes);
  source.strokes.forEach((stroke, index) => {
    assert.notEqual(result.strokes[index], stroke);
    assert.notEqual(result.strokes[index].points, stroke.points);
    stroke.points.forEach((point, pointIndex) => assert.notEqual(result.strokes[index].points[pointIndex], point));
  });
  if (source.photo) assert.notEqual(result.photo, source.photo);
}

function change(project: Project, title: string): Project {
  return { ...project, title };
}

test('factories create independent valid projects fitted to a sample preview', () => {
  const first = createProject();
  const second = createProject();
  assert.equal(first.photo, null);
  assert.deepEqual(first.strokes, []);
  assert.equal(first.note, '');
  assert.deepEqual(validateProject(first), first);
  assertIndependent(first, second);
  first.garment.bodyWidth = 200;
  assert.equal(second.garment.bodyWidth, 220);
});

test('validation reconstructs known properties at every depth without coercion or aliases', () => {
  const project = fixture();
  Object.assign(project, { harmlessExtra: true });
  Object.assign(project.garment, { extra: 'ignored' });
  Object.assign(project.strokes[0].points[0], { extra: 42 });
  const result = validateProject(project);
  assert.deepEqual(result, fixture());
  assertIndependent(project, result);
  result.strokes[0].points[0].x = 0.3;
  result.photo!.name = 'Changed.jpg';
  assert.equal(project.strokes[0].points[0].x, 0.1);
  assert.equal(project.photo!.name, 'Sample.jpg');
  const withSpaces = fixture();
  withSpaces.title = '  preserved title  ';
  assert.equal(validateProject(withSpaces).title, withSpaces.title);
  withSpaces.garment.color = '#ABCDEF';
  assert.equal(validateProject(withSpaces).garment.color, '#ABCDEF');
});

test('every numeric bound accepts its exact minimum and maximum', () => {
  for (const high of [false, true]) {
    const project = fixture();
    project.garment = { ...project.garment, bodyWidth: high ? 260 : 160, bodyLength: high ? 300 : 180, sleeveLength: high ? 65 : 25 };
    project.placement = { x: high ? 1 : 0, y: high ? 1 : 0, width: high ? 1.5 : 0.1, height: high ? 1.5 : 0.1, rotation: high ? 180 : -180, opacity: high ? 1 : 0.1 };
    project.strokes[0].width = high ? 20 : 1;
    project.strokes[0].points = [{ x: high ? 1 : 0, y: high ? 1 : 0 }];
    project.photo!.width = high ? MAX_PHOTO_EDGE : 1;
    project.photo!.height = high ? MAX_PHOTO_EDGE : 1;
    assert.deepEqual(validateProject(project), project);
  }
});

test('validation rejects invalid garment fields and exact color or pattern lookalikes', () => {
  for (const [field, values] of Object.entries({
    bodyWidth: [159.9, 260.1, NaN, Infinity, '220'], bodyLength: [179.9, 300.1],
    sleeveLength: [24.9, 65.1], neckline: ['square', 1], pattern: ['floral', null],
    color: ['#fff', '#11223344', '#GG2233', '112233', 'red', '#112233<script>'],
    patternColor: ['#123', 'url(https://example.com)'],
  })) {
    for (const value of values) {
      const project = fixture();
      Object.assign(project.garment, { [field]: value });
      assert.throws(() => validateProject(project), new RegExp(field, 'i'));
    }
  }
});

test('validation rejects every placement boundary, nonfinite values and silent numeric coercion', () => {
  for (const [field, values] of Object.entries({
    x: [-0.01, 1.01], y: [-0.01, 1.01], width: [0.09, 1.51], height: [0.09, 1.51],
    rotation: [-180.1, 180.1], opacity: [0.09, 1.01],
  })) {
    for (const value of [...values, NaN, Infinity, '0.5', null]) {
      const project = fixture();
      Object.assign(project.placement, { [field]: value });
      assert.throws(() => validateProject(project), new RegExp(field, 'i'));
    }
  }
});

test('project structure, schema and text limits reject malformed inputs', () => {
  for (const value of [null, [], {}, { ...fixture(), schemaVersion: 2 }, { ...fixture(), garment: [] }, { ...fixture(), placement: null }, { ...fixture(), photo: false }, { ...fixture(), strokes: {} }]) {
    assert.throws(() => validateProject(value));
  }
  for (const [field, values] of Object.entries({ title: ['', ' ', 'x'.repeat(81), 8], note: ['x'.repeat(2001), null] })) {
    for (const value of values) assert.throws(() => validateProject({ ...fixture(), [field]: value }), new RegExp(field, 'i'));
  }
  const maximum = fixture();
  maximum.title = 'x'.repeat(80);
  maximum.note = 'x'.repeat(2000);
  maximum.photo!.name = 'x'.repeat(120);
  assert.deepEqual(validateProject(maximum), maximum);
});

test('prototype objects, dangerous own keys and accessors are rejected without invoking getters', () => {
  const inherited = Object.assign(Object.create({ inherited: true }), fixture());
  assert.throws(() => validateProject(inherited), /plain|prototype|object/i);
  const project = fixture();
  project.garment = Object.assign(Object.create({ color: '#ffffff' }), project.garment);
  assert.throws(() => validateProject(project), /plain|prototype|object/i);
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const unsafe = fixture();
    Object.defineProperty(unsafe, key, { value: {}, enumerable: true });
    assert.throws(() => validateProject(unsafe), /unsafe|prototype|property/i);
    assert.throws(() => parseProject(JSON.stringify(unsafe)), /unsafe|prototype|property/i);
  }
  let calls = 0;
  const getter = fixture();
  Object.defineProperty(getter, 'title', { get: () => { calls++; return 'unsafe'; }, enumerable: true });
  assert.throws(() => validateProject(getter), /accessor|property|plain/i);
  assert.equal(calls, 0);
});

test('validation rejects unsafe method values without executing caller-supplied array methods', () => {
  let calls = 0;
  const project = fixture();
  Object.defineProperty(project.strokes, 'map', { value: () => { calls++; return []; } });
  assert.throws(() => validateProject(project), /unsafe|property/i);
  assert.equal(calls, 0);
  for (const unsafe of [() => undefined, Symbol('unsafe'), 1n]) {
    assert.throws(() => validateProject(Object.assign(fixture(), { extra: unsafe })), /unsafe|property/i);
  }
});

test('stroke IDs, colors, widths and points must be finite, bounded, present and unique', () => {
  for (const [field, values] of Object.entries({ id: ['', 1], color: ['#fff', '<script>'], width: [0.99, 20.01, NaN, '4'], points: [null, [], new Array(1)] })) {
    for (const value of values) {
      const project = fixture();
      Object.assign(project.strokes[0], { [field]: value });
      assert.throws(() => validateProject(project));
    }
  }
  for (const field of ['x', 'y']) {
    for (const value of [-0.001, 1.001, NaN, Infinity, '0.2']) {
      const project = fixture();
      Object.assign(project.strokes[0].points[0], { [field]: value });
      assert.throws(() => validateProject(project), new RegExp(field, 'i'));
    }
  }
  const duplicate = fixture();
  duplicate.strokes.push(structuredClone(duplicate.strokes[0]));
  assert.throws(() => validateProject(duplicate), /ID|duplicate/i);
  const sparse = fixture();
  sparse.strokes = new Array(1);
  assert.throws(() => validateProject(sparse));
});

test('stroke, individual-point and total-point maximums accept exact limits and reject overflow', () => {
  assert.equal(MAX_STROKES, 100);
  assert.equal(MAX_STROKE_POINTS, 1000);
  assert.equal(MAX_TOTAL_POINTS, 12000);
  const project = fixture();
  const stroke = project.strokes[0];
  project.strokes = Array.from({ length: MAX_STROKES }, (_, index) => ({ ...stroke, id: `stroke-${index}`, points: [{ x: 0, y: 1 }] }));
  assert.equal(validateProject(project).strokes.length, MAX_STROKES);
  project.strokes.push({ ...stroke, id: 'overflow' });
  assert.throws(() => validateProject(project), /100|stroke/i);
  project.strokes = Array.from({ length: 12 }, (_, index) => ({ ...stroke, id: `stroke-${index}`, points: Array.from({ length: MAX_STROKE_POINTS }, () => ({ x: 0.5, y: 0.5 })) }));
  assert.equal(validateProject(project).strokes.flatMap(stroke => stroke.points).length, MAX_TOTAL_POINTS);
  project.strokes.push({ ...stroke, id: 'total-overflow', points: [{ x: 0, y: 0 }] });
  assert.throws(() => validateProject(project), /12000|12,000|total/i);
  project.strokes = [{ ...stroke, points: Array.from({ length: MAX_STROKE_POINTS + 1 }, () => ({ x: 0, y: 0 })) }];
  assert.throws(() => validateProject(project), /1000|1,000|point/i);
});

test('photo structural validation requires bounded JPEG data URLs, dimensions and names', () => {
  const prefix = 'data:image/jpeg;base64,';
  assert.equal(MAX_PHOTO_DATA_URL_LENGTH, 3 * 1024 * 1024);
  const largestBase64 = 'A'.repeat(Math.floor((MAX_PHOTO_DATA_URL_LENGTH - prefix.length) / 4) * 4);
  const project = fixture();
  project.photo!.dataUrl = prefix + largestBase64;
  assert.deepEqual(validateProject(project), project);
  for (const [field, values] of Object.entries({
    dataUrl: [prefix + largestBase64 + 'AAAA', 'https://example.com/photo.jpg', 'data:image/svg+xml;base64,AA==', 'data:image/png;base64,AA==', prefix, prefix + 'A===', prefix + 'AAA', prefix + 'AA ==', prefix + '<script>'],
    width: [0, 1201, 1.5, NaN, '600'], height: [0, 1201, Infinity],
    name: ['', ' ', 'x'.repeat(121), null],
  })) {
    for (const value of values) {
      const bad = fixture();
      Object.assign(bad.photo!, { [field]: value });
      assert.throws(() => validateProject(bad), new RegExp(field === 'dataUrl' ? 'photo|JPEG|data' : field, 'i'));
    }
  }
  assert.equal(validateProject({ ...fixture(), photo: null }).photo, null);
});

test('project JSON round trips all known fields and rejects malformed or oversized text by UTF-8 bytes', () => {
  const project = fixture();
  const roundTrip = parseProject(serializeProject(project));
  assert.deepEqual(roundTrip, project);
  assertIndependent(project, roundTrip);
  assert.throws(() => parseProject('{broken'), /JSON/i);
  assert.throws(() => parseProject(null as unknown as string), /text/i);
  assert.equal(MAX_PROJECT_BYTES, 6 * 1024 * 1024);
  const serialized = JSON.stringify(project);
  const exact = serialized + ' '.repeat(MAX_PROJECT_BYTES - new TextEncoder().encode(serialized).length);
  assert.deepEqual(parseProject(exact), project);
  assert.throws(() => parseProject(exact + ' '), /6 MiB|size|limit/i);
  assert.throws(() => parseProject('"' + 'é'.repeat(MAX_PROJECT_BYTES / 2) + '"'), /6 MiB|size|limit/i);
  assert.throws(() => serializeProject({ ...project, title: '' }));
});

test('history starts without undo or redo and returns independent validated snapshots', () => {
  const initial = fixture();
  const before = structuredClone(initial);
  const history = new ProjectHistory(initial);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
  assert.deepEqual(history.current, before);
  assertIndependent(initial, history.current);
  initial.garment.color = '#ffffff';
  initial.strokes[0].points[0].x = 0.9;
  initial.photo!.name = 'Changed.jpg';
  assert.deepEqual(history.current, before);
  const exposed = history.current;
  exposed.placement.x = 0.3;
  exposed.strokes[0].points.push({ x: 1, y: 1 });
  assert.deepEqual(history.current, before);
  assert.deepEqual(history.undo(), before);
  assert.deepEqual(history.redo(), before);
});

test('history commits, undoes and redoes each edit including clear and new projects', () => {
  const initial = fixture();
  const history = new ProjectHistory(initial);
  const moved = { ...initial, placement: { ...initial.placement, x: 0.8 } };
  const cleared = { ...moved, strokes: [] };
  assert.equal(history.commit(moved), true);
  assert.equal(history.commit(cleared), true);
  assert.equal(history.commit(createProject()), true);
  assert.deepEqual(history.undo(), cleared);
  assert.deepEqual(history.undo(), moved);
  assert.deepEqual(history.undo(), initial);
  assert.equal(history.canUndo, false);
  assert.deepEqual(history.redo(), moved);
  assert.deepEqual(history.redo(), cleared);
  assert.equal(history.canRedo, true);
  const current = history.redo();
  assert.deepEqual(current, createProject());
  current.garment.bodyLength = 280;
  assert.deepEqual(history.current, createProject());
  assert.equal(history.canRedo, false);
});

test('history no-op edits are omitted and preserve redo while a changed edit discards it', () => {
  const initial = fixture();
  const history = new ProjectHistory(initial);
  assert.equal(history.commit(structuredClone(initial)), false);
  history.commit(change(initial, 'Second'));
  history.undo();
  assert.equal(history.commit(Object.assign(structuredClone(initial), { ignored: true })), false);
  assert.equal(history.canRedo, true);
  assert.equal(history.commit(change(initial, 'Branch')), true);
  assert.equal(history.canRedo, false);
  assert.equal(history.redo().title, 'Branch');
  assert.equal(history.undo().title, 'First concept');
});

test('history retains exactly forty past edits and trims only the oldest', () => {
  assert.equal(MAX_HISTORY_STEPS, 40);
  const initial = fixture();
  const history = new ProjectHistory(initial);
  for (let index = 1; index <= 45; index++) history.commit(change(initial, `Edit ${index}`));
  for (let index = 44; index >= 5; index--) assert.equal(history.undo().title, `Edit ${index}`);
  assert.equal(history.canUndo, false);
  assert.equal(history.current.title, 'Edit 5');
  for (let index = 6; index <= 45; index++) assert.equal(history.redo().title, `Edit ${index}`);
  assert.equal(history.canRedo, false);
});

test('committed inputs and values returned by undo or redo cannot mutate stored history', () => {
  const initial = fixture();
  const history = new ProjectHistory(initial);
  const next = change(initial, 'Next');
  history.commit(next);
  next.photo!.width = 300;
  next.strokes[0].color = '#000000';
  assert.equal(history.current.photo!.width, 600);
  const undone = history.undo();
  undone.strokes[0].points[0].x = 1;
  assert.equal(history.current.strokes[0].points[0].x, 0.1);
  const redone = history.redo();
  redone.photo!.height = 100;
  assert.equal(history.current.photo!.height, 800);
});

test('history validates construction, commit and reset atomically before changing any state', () => {
  const initial = fixture();
  const invalid = { ...initial, schemaVersion: 2 };
  assert.throws(() => new ProjectHistory(invalid as Project), /version/i);
  const history = new ProjectHistory(initial);
  history.commit(change(initial, 'Second'));
  history.undo();
  assert.throws(() => history.commit(invalid as Project), /version/i);
  assert.throws(() => history.reset(invalid as Project), /version/i);
  assert.deepEqual(history.current, initial);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, true);
  const reset = createProject();
  history.reset(reset);
  reset.placement.x = 0.9;
  assert.deepEqual(history.current, createProject());
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
});
