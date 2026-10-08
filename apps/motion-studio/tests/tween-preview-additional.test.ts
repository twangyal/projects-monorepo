import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Project } from '../src/model.ts';
import { createTweenPreview } from '../src/tween-preview.ts';

function project(): Project {
  return { schemaVersion: 2, title: 'Preview', background: '#FFFFFF', frameCount: 12, layers: [{
    id: 'ink', name: 'Ink', kind: 'drawing', keys: [{ frame: 0, x: 100, y: 100, scale: 1, rotation: 0, opacity: 1, easing: 'linear' }],
    cels: [{ frame: 0, strokes: [{ color: '#FF0000', width: 4, points: [{ x: 0, y: 0 }] }] },
      { frame: 5, strokes: [{ color: '#0000FF', width: 4, points: [{ x: 50, y: 0 }] }] }] }] };
}
function surface() {
  const colors: unknown[] = [];
  const ctx = Object.fromEntries(['save', 'restore', 'setTransform', 'fillRect', 'translate', 'rotate', 'scale', 'setLineDash',
    'beginPath', 'arc', 'fill', 'moveTo', 'lineTo', 'stroke'].map(name => [name, () => {}]));
  Object.defineProperty(ctx, 'fillStyle', { set(value) { colors.push(value); } });
  let accesses = 0;
  const canvas = { width: 640, height: 360, getContext() { accesses++; return ctx; } } as unknown as HTMLCanvasElement;
  return { canvas, colors, accesses: () => accesses };
}
function clock(t: TestContext) {
  let id = 0, now = 1000;
  t.mock.method(performance, 'now', () => now);
  const pending = new Map<number, FrameRequestCallback>(), canceled: number[] = [];
  const oldRequest = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = callback => { pending.set(++id, callback); return id; };
  globalThis.cancelAnimationFrame = key => { canceled.push(key); pending.delete(key); };
  t.after(() => { globalThis.requestAnimationFrame = oldRequest; globalThis.cancelAnimationFrame = oldCancel; });
  return { pending, canceled, tick(time: number) {
    now = time;
    const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback(time));
  } };
}

test('preview captures common held renderer once and invalid frames preserve current output', () => {
  const p = project(), s = surface(), frames: number[] = [];
  const preview = createTweenPreview(s.canvas, p, new Map(), 0, 10, frame => frames.push(frame));
  assert.equal(preview.frame, 0); assert.deepEqual(frames, [0]); assert.ok(s.colors.includes('#FF0000'));
  p.layers = []; p.background = '#000000';
  preview.showFrame(5); assert.equal(preview.frame, 5); assert.equal(s.colors.at(-1), '#0000FF');
  const before = s.colors.length;
  for (const frame of [-1, 11, 4.5, NaN]) assert.throws(() => preview.showFrame(frame));
  assert.equal(preview.frame, 5); assert.equal(s.colors.length, before);
});

test('invalid candidate/endpoints/callbacks refuse before accessing the canvas', () => {
  for (const [start, end] of [[-1, 10], [0, 12], [4, 3], [0, 5.5], [NaN, 5]]) {
    const s = surface(); assert.throws(() => createTweenPreview(s.canvas, project(), new Map(), start, end, () => {}));
    assert.equal(s.accesses(), 0);
  }
  const s = surface(), p = project(); p.frameCount = 3;
  assert.throws(() => createTweenPreview(s.canvas, p, new Map(), 0, 2, () => {})); assert.equal(s.accesses(), 0);
  assert.throws(() => createTweenPreview(s.canvas, project(), new Map(), 0, 5, null as unknown as (frame: number) => void));
  assert.equal(s.accesses(), 0);
});

test('elapsed12fps playback owns one callback, clamps/stops at end and can restart', t => {
  const c = clock(t), s = surface(), frames: number[] = [];
  const preview = createTweenPreview(s.canvas, project(), new Map(), 2, 5, frame => frames.push(frame));
  preview.play(); preview.play(); assert.equal(c.pending.size, 1);
  c.tick(1000); assert.equal(preview.frame, 2);
  c.tick(1084); assert.equal(preview.frame, 3); assert.equal(c.pending.size, 1);
  c.tick(1300); assert.equal(preview.frame, 5); assert.equal(c.pending.size, 0);
  preview.play(); assert.equal(preview.frame, 2); assert.equal(c.pending.size, 1);
  c.tick(1300); c.tick(1384); assert.equal(preview.frame, 3);
  preview.stop(); assert.equal(preview.frame, 3); assert.equal(c.pending.size, 0);
  assert.deepEqual(frames, [2, 3, 5, 2, 3]);
});

test('scrubbing and disposal cancel owned callbacks; late callbacks cannot redraw or notify', t => {
  const c = clock(t), s = surface(), frames: number[] = [];
  const preview = createTweenPreview(s.canvas, project(), new Map(), 0, 10, frame => frames.push(frame));
  preview.play(); const late = [...c.pending.values()][0];
  preview.showFrame(5); late(9999); assert.equal(preview.frame, 5); assert.equal(c.pending.size, 0);
  preview.play(); const departed = [...c.pending.values()][0];
  preview.dispose(); assert.equal(c.pending.size, 0); assert.equal(s.canvas.width, 0); assert.equal(s.canvas.height, 0);
  const before = s.colors.length, notifications = frames.length;
  departed(10000); preview.play(); preview.showFrame(1); preview.stop(); preview.dispose();
  assert.equal(s.colors.length, before); assert.equal(frames.length, notifications);
});

test('preview borrows image assets and never closes caller resources', t => {
  const c = clock(t), p = project(), s = surface(); let closed = 0;
  const bitmap = { width: 1, height: 1, close() { closed++; } } as ImageBitmap;
  p.layers = [{ id: 'photo', name: 'Photo', kind: 'image', keys: p.layers[0].keys,
    image: { dataUrl: 'data:image/png;base64,AAAA', width: 1, height: 1 } }];
  const canvas = { width: 640, height: 360, getContext() { const ctx = s.canvas.getContext('2d')!;
    ctx.drawImage = () => {}; return ctx; } } as unknown as HTMLCanvasElement;
  const assets = new Map([['photo', bitmap]]);
  const preview = createTweenPreview(canvas, p, assets, 0, 5, () => {});
  preview.play(); preview.dispose(); assert.equal(c.pending.size, 0);
  assert.equal(closed, 0); assert.equal(assets.get('photo'), bitmap);
});

test('restart notifications honor reentrant disposal/stop/play without leaking callbacks', t => {
  const c = clock(t);
  for (const action of ['dispose', 'stop', 'play'] as const) {
    const s = surface(); let react = false;
    const preview = createTweenPreview(s.canvas, project(), new Map(), 0, 5, frame => {
      if (react && frame === 0) { react = false; preview[action](); }
    });
    preview.showFrame(5); react = true; preview.play();
    assert.equal(c.pending.size, action === 'play' ? 1 : 0, action);
    preview.dispose(); assert.equal(c.pending.size, 0, action);
  }
});
