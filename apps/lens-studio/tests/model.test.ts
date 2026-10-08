import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, decodeMask, encodeMask, fillMask, paintMask, parseProject, resetProjection, serializeProject, updateSettings, validateProject, validateSettings } from '../src/model.ts';
import { LIMITS } from '../src/types.ts';
import { photo } from './model-fixture.ts';

test('creation is detached with a unique UUID, fixed defaults and a complete subject mask', () => {
  const asset = photo(), project = createProject(asset);
  assert.match(project.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(project.id, createProject(asset).id);
  assert.equal(project.title, 'Lens study');
  assert.deepEqual(project.settings, { mode: 'fixed', sourceFocal: 50, targetFocal: 50, shiftX: 0, shiftY: 0, near: .6, far: 2 });
  assert.deepEqual(decodeMask(project.depth), new Uint8Array(48).fill(1));
  asset.width = 1; assert.equal(project.photo.width, 8);
  const detached = validateProject(project); detached.settings.near = .5;
  assert.equal(project.settings.near, .6);
});

test('settings enforce ranges, ratio, decimal precision and unused near-plane clearance atomically', () => {
  const project = createProject(photo()), before = structuredClone(project);
  for (const patch of [{ sourceFocal: 9 }, { targetFocal: 301 }, { sourceFocal: NaN }, { targetFocal: 12.49 },
    { sourceFocal: 50.001 }, { shiftX: .00001 }, { shiftY: .5001 }, { near: .6001 }, { far: 1 },
    { mode: 'perspective' as const, sourceFocal: 100, targetFocal: 25 }, { unknown: 1 }, { sourceFocal: true }]) {
    assert.throws(() => updateSettings(project, patch as never));
    assert.deepEqual(project, before);
  }
  const canonical = updateSettings(project, { sourceFocal: 50.12 + 1e-12, shiftX: -.1234, far: 3.456 });
  assert.equal(canonical.settings.sourceFocal, 50.12);
  assert.equal(updateSettings(project, { mode: 'perspective', near: .1, targetFocal: 47.5 }).settings.near, .1);
  assert.throws(() => validateSettings({ ...project.settings, extra: 1 }));
});

test('canonical masks enforce exact sizes and labels and never alias decoded bytes', () => {
  const labels = new Uint8Array([0, 1, 2, 1]);
  const mask = encodeMask(labels, 2, 2); labels[0] = 2;
  assert.deepEqual([...decodeMask(mask)], [0, 1, 2, 1]);
  const decoded = decodeMask(mask); decoded[0] = 2;
  assert.equal(decodeMask(mask)[0], 0);
  for (const bad of [{ ...mask, labels: mask.labels.slice(0, -1) }, { ...mask, labels: 'AAECAQ==' + '\n' },
    { ...mask, labels: 'AAECAx==' }, { ...mask, width: 1 }, { ...mask, width: 1.5 }, { ...mask, extra: 1 }]) assert.throws(() => decodeMask(bad));
  assert.throws(() => encodeMask(new Uint8Array([3]), 1, 1));
  assert.throws(() => encodeMask(new Uint8Array(0), 0, 0));
  assert.throws(() => encodeMask(new Uint8Array(4), 1, 1));
});

test('strict projects reject unknown keys, prototypes, mismatched dimensions and invalid Unicode', () => {
  const project = createProject(photo());
  for (const value of [{ ...project, schemaVersion: 2 }, { ...project, extra: 1 },
    { ...project, id: project.id.toUpperCase() }, { ...project, title: '\ud800' }, { ...project, title: 'x\0y' },
    { ...project, title: ' ' }, { ...project, title: 'x'.repeat(81) },
    { ...project, depth: encodeMask(new Uint8Array(4), 2, 2) },
    { ...project, photo: { ...project.photo, width: 7 } }, Object.assign(Object.create({ hidden: true }), project)]) assert.throws(() => validateProject(value));
  assert.equal(validateProject({ ...project, title: '  📷'.repeat(2).trim() + '  ' }).title, '📷  📷');
  assert.equal(validateProject({ ...project, title: '📷'.repeat(80) }).title, '📷'.repeat(80));
});

test('project serialization is compact, detached and round-trips authored text', () => {
  const project = createProject(photo()); project.title = 'A\nB\t<script>';
  const encoded = serializeProject(project);
  assert.equal(encoded, JSON.stringify(project));
  assert.deepEqual(parseProject(encoded), project);
  const restored = parseProject(encoded); restored.settings.shiftX = .2;
  assert.equal(project.settings.shiftX, 0);
});

test('UUIDs require exact string termination and titles reject C1 controls in direct and JSON inputs', () => {
  const project = createProject(photo());
  for (const changed of [{ ...project, id: project.id + '\n' }, { ...project, id: project.id + '\r\n' },
    { ...project, title: 'A\u0085B' }, { ...project, title: 'A\u009fB' }]) {
    assert.throws(() => validateProject(changed));
    assert.throws(() => parseProject(JSON.stringify(changed)));
  }
  assert.equal(validateProject({ ...project, title: 'A\nB\rC\tD' }).title, 'A\nB\rC\tD');
});

test('strict JSON rejects decoded duplicate keys, depth, unsafe numbers, malformed text and byte excess', () => {
  const encoded = serializeProject(createProject(photo()));
  for (const raw of [encoded.replace('"schemaVersion":1', '"schemaVersion":1,"schema\\u0056ersion":1'),
    encoded.replace('"sourceFocal":50', '"sourceFocal":1e999'), encoded.replace('"sourceFocal":50', '"sourceFocal":NaN'),
    encoded.replace('"sourceFocal":50', '"sourceFocal":9007199254740992'), encoded + '{}',
    '['.repeat(25) + '0' + ']'.repeat(25), '{"__proto__":{},"__proto__":{}}', '\ud800',
    ' '.repeat(LIMITS.projectBytes + 1)]) assert.throws(() => parseProject(raw));
  assert.throws(() => parseProject(encoded.replace('"title":"Lens study"', '"title":"\\ud800"')));
});

test('painting stamps pixel centers and clips source edges without changing inputs', () => {
  const project = createProject(photo(4, 4)), before = structuredClone(project);
  const painted = paintMask(project, 0, 1, [{ x: 0, y: 0 }]);
  assert.deepEqual([...decodeMask(painted.depth)], [0,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1]);
  assert.deepEqual(project, before);
  const dot = paintMask(project, 2, 1, [{ x: 1.5, y: 1.5 }, { x: 1.5, y: 1.5 }]);
  assert.deepEqual([...decodeMask(dot.depth)], [1,2,1,1, 2,2,2,1, 1,2,1,1, 1,1,1,1]);
});

test('stamp spacing is cumulative across tiny segments and includes the final endpoint', () => {
  const project = createProject(photo(12, 8));
  const direct = paintMask(project, 0, 3, [{ x: 1.1, y: 1.1 }, { x: 10.9, y: 5.9 }]);
  const split = Array.from({ length: 101 }, (_, i) => ({ x: 1.1 + 9.8 * i / 100, y: 1.1 + 4.8 * i / 100 }));
  assert.deepEqual(decodeMask(paintMask(project, 0, 3, split).depth), decodeMask(direct.depth));
  const short = paintMask(createProject(photo(4, 2)), 2, 1, [{ x: 0, y: .5 }, { x: .6, y: .5 }]);
  assert.equal(decodeMask(short.depth)[1], 2, 'endpoint stamp must reach center at x=1.5');
});

test('painting rejects invalid and excessive gestures before changing any labels', () => {
  const project = createProject(photo()), before = structuredClone(project);
  for (const points of [[], [{ x: -1, y: 0 }], [{ x: 9, y: 0 }], [{ x: NaN, y: 0 }],
    [{ x: 1, y: 1, pressure: 1 }], Array.from({ length: 2049 }, () => ({ x: 0, y: 0 })),
    Array.from({ length: 2048 }, (_, i) => ({ x: i % 2 ? 8 : 0, y: 0 }))]) assert.throws(() => paintMask(project, 0, 1, points));
  for (const radius of [0, 101, 1.1, NaN]) assert.throws(() => paintMask(project, 0, radius, [{ x: 1, y: 1 }]));
  assert.throws(() => paintMask(project, 3 as never, 1, [{ x: 1, y: 1 }]));
  assert.deepEqual(project, before);
});

test('fill and projection reset are detached and retain declared source, depths and assigned mask', () => {
  const original = createProject(photo());
  const filled = fillMask(original, 2);
  assert.deepEqual(decodeMask(filled.depth), new Uint8Array(48).fill(2));
  assert.deepEqual(decodeMask(original.depth), new Uint8Array(48).fill(1));
  const changed = updateSettings(filled, { mode: 'perspective', sourceFocal: 75, targetFocal: 100, shiftX: .2, shiftY: -.3, near: .8, far: 3 });
  const reset = resetProjection(changed);
  assert.deepEqual(reset.settings, { mode: 'perspective', sourceFocal: 75, targetFocal: 75, shiftX: 0, shiftY: 0, near: .8, far: 3 });
  assert.deepEqual(reset.depth, filled.depth);
  assert.throws(() => fillMask(original, -1 as never));
});
