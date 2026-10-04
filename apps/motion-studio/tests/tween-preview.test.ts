import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { Project, ImageLayer } from '../src/model.ts';
import { createTweenPreview, type TweenPreview } from '../src/tween-preview.ts';

function fixture(): Project {
  return { schemaVersion: 2, title: 'Held drawings and moving pose', background: '#FFFFFF', frameCount: 12,
    layers: [{ id: 'ink', name: 'Ink', kind: 'drawing', cels: [
      { frame: 0, strokes: [{ color: '#FF0000', width: 4, points: [{ x: 1, y: 2 }, { x: 9, y: 2 }] }] },
      { frame: 4, strokes: [{ color: '#800080', width: 6, points: [{ x: 3, y: 5 }] }] },
      { frame: 8, strokes: [{ color: '#0000FF', width: 8, points: [{ x: 7, y: 9 }, { x: 11, y: 9 }] }] },
    ], keys: [
      { frame: 0, x: 100, y: 50, rotation: 0, scale: 1, opacity: 1, easing: 'linear' },
      { frame: 8, x: 180, y: 130, rotation: 0, scale: 1, opacity: 1, easing: 'linear' },
    ] }],
  };
}

/** Canvas API observation with the real shared renderer, not a replacement renderer. */
function recordingCanvas() {
  const calls: unknown[][] = [], values: Record<string, unknown> = {};
  for (const method of ['save', 'restore', 'setTransform', 'fillRect', 'translate', 'rotate', 'scale', 'setLineDash', 'beginPath', 'arc', 'fill', 'moveTo', 'lineTo', 'stroke', 'drawImage']) {
    values[method] = (...args: unknown[]) => calls.push([method, ...args]);
  }
  const ctx = new Proxy(values, { set(target, key, value) { calls.push(['set', key, value]); target[String(key)] = value; return true; } });
  const target = { width: 17, height: 19, getContext(kind: string) { calls.push(['getContext', kind]); return ctx; } };
  const canvas = new Proxy(target, { set(object, key, value) { calls.push(['canvas', key, value]); Reflect.set(object, key, value); return true; } }) as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

function clock(t: TestContext) {
  let now = 0, id = 0;
  const pending = new Map<number, FrameRequestCallback>(), all = new Map<number, FrameRequestCallback>();
  const previous = ['requestAnimationFrame', 'cancelAnimationFrame'].map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (callback: FrameRequestCallback) => {
    const next = ++id; pending.set(next, callback); all.set(next, callback); return next;
  } });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: (key: number) => { pending.delete(key); } });
  t.mock.method(performance, 'now', () => now);
  t.after(() => {
    for (const [index, name] of ['requestAnimationFrame', 'cancelAnimationFrame'].entries()) {
      if (previous[index]) Object.defineProperty(globalThis, name, previous[index]!);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  return { pending, all, setTime(value: number) { now = value; },
    tick(value: number) {
      now = value;
      assert.equal(pending.size, 1, 'Exactly one animation callback must be owned.');
      const [key, callback] = [...pending][0]; pending.delete(key); callback(value);
    },
  };
}

test('preview uses prepared shared held-cel and pose rendering and captures its candidate once', () => {
  const { canvas, calls } = recordingCanvas(), project = fixture(), frames: number[] = [];
  const preview = createTweenPreview(canvas, project, new Map(), 0, 8, frame => frames.push(frame));
  assert.equal(canvas.width, 640); assert.equal(canvas.height, 360); assert.equal(preview.frame, 0);
  assert.ok(calls.some(call => JSON.stringify(call) === '["moveTo",1,2]'));
  project.layers.splice(0); project.background = '#000000'; project.frameCount = 96;
  calls.length = 0; preview.showFrame(5);
  assert.ok(calls.some(call => JSON.stringify(call) === '["translate",150,100]'));
  assert.ok(calls.some(call => JSON.stringify(call) === '["arc",3,5,3,0,6.283185307179586]'));
  assert.ok(calls.some(call => JSON.stringify(call) === '["set","strokeStyle","#800080"]'));
  assert.ok(calls.some(call => JSON.stringify(call) === '["set","fillStyle","#FFFFFF"]'));
  assert.deepEqual(frames, [0, 5]); assert.equal(preview.frame, 5); preview.dispose();
});

test('candidate, range, callback and assets are admitted before touching the canvas', () => {
  const cases: [Project, number, number, (frame: number) => void][] = [
    [{ ...fixture(), frameCount: 999 }, 0, 8, () => {}],
    [fixture(), -1, 8, () => {}], [fixture(), 0, 12, () => {}], [fixture(), 8, 0, () => {}],
    [fixture(), .5, 8, () => {}], [fixture(), 0, NaN, () => {}],
    [fixture(), 0, 8, null as unknown as (frame: number) => void],
  ];
  for (const [project, start, end, callback] of cases) {
    const trace = recordingCanvas();
    assert.throws(() => createTweenPreview(trace.canvas, project, new Map(), start, end, callback));
    assert.deepEqual(trace.calls, []);
  }
  const image: ImageLayer = { id: 'photo', name: 'Photo', kind: 'image', keys: fixture().layers[0].keys,
    image: { dataUrl: 'data:image/png;base64,AAAA', width: 20, height: 10 } };
  const project = fixture(); project.layers.push(image);
  const trace = recordingCanvas();
  assert.throws(() => createTweenPreview(trace.canvas, project, new Map(), 0, 8, () => {}), /assets/i);
  assert.deepEqual(trace.calls, []);
});

test('invalid frame requests leave the rendered frame and active RAF untouched', t => {
  const raf = clock(t), { canvas, calls } = recordingCanvas();
  const preview = createTweenPreview(canvas, fixture(), new Map(), 2, 8, () => {}); preview.play();
  const before = [...calls], callback = [...raf.pending];
  for (const frame of [1, 9, 3.5, NaN, Infinity, '4' as unknown as number]) assert.throws(() => preview.showFrame(frame), /frame/i);
  assert.equal(preview.frame, 2); assert.deepEqual(calls, before); assert.deepEqual([...raf.pending], callback); preview.dispose();
});

test('12fps elapsed playback skips duplicate renders, clamps and stops at its end', t => {
  const raf = clock(t), frames: number[] = [], { canvas } = recordingCanvas();
  const preview = createTweenPreview(canvas, fixture(), new Map(), 2, 8, frame => frames.push(frame));
  preview.play(); preview.play();
  raf.tick(0); raf.tick(83); raf.tick(84); raf.tick(300); raf.tick(900);
  assert.deepEqual(frames, [2, 3, 5, 8]); assert.equal(preview.frame, 8); assert.equal(raf.pending.size, 0);
  preview.dispose();
});

test('stopping retains the frame, play at end restarts, and selected frames retire playback', t => {
  const raf = clock(t), frames: number[] = [], { canvas } = recordingCanvas();
  const preview = createTweenPreview(canvas, fixture(), new Map(), 0, 8, frame => frames.push(frame));
  preview.play(); raf.tick(250); preview.stop(); assert.equal(preview.frame, 3); assert.equal(raf.pending.size, 0);
  preview.showFrame(8); raf.setTime(1000); preview.play();
  assert.equal(preview.frame, 0); assert.equal(raf.pending.size, 1); raf.tick(1084); assert.equal(preview.frame, 1);
  preview.showFrame(4); assert.equal(raf.pending.size, 0); assert.equal(preview.frame, 4);
  assert.deepEqual(frames, [0, 3, 8, 0, 1, 4]); preview.dispose();
});

test('dispose zeros dedicated canvas and makes queued callbacks harmless without closing borrowed assets', t => {
  const raf = clock(t), trace = recordingCanvas(), project = fixture(), frames: number[] = [];
  let closed = 0;
  const bitmap = { width: 20, height: 10, close() { closed++; } } as ImageBitmap;
  project.layers.push({ id: 'photo', name: 'Photo', kind: 'image', keys: fixture().layers[0].keys,
    image: { dataUrl: 'data:image/png;base64,AAAA', width: 20, height: 10 } });
  const assets = new Map([['photo', bitmap]]);
  const preview = createTweenPreview(trace.canvas, project, assets, 0, 8, frame => frames.push(frame));
  assets.clear(); preview.showFrame(5);
  assert.ok(trace.calls.some(call => call[0] === 'drawImage' && call[1] === bitmap));
  preview.play(); const late = [...raf.pending.values()][0]; preview.dispose();
  assert.equal(trace.canvas.width, 0); assert.equal(trace.canvas.height, 0); assert.equal(raf.pending.size, 0);
  const before = [...trace.calls]; late(1000); preview.play(); preview.showFrame(8); preview.stop(); preview.dispose();
  assert.deepEqual(trace.calls, before); assert.deepEqual(frames, [0, 5]); assert.equal(closed, 0);
});

test('callback stop, seek and disposal cannot revive an old playback callback', t => {
  const raf = clock(t);
  for (const action of ['stop', 'seek', 'dispose'] as const) {
    const trace = recordingCanvas();
    const preview: TweenPreview = createTweenPreview(trace.canvas, fixture(), new Map(), 0, 8, frame => {
      if (frame !== 1) return;
      if (action === 'seek') preview.showFrame(4);
      else preview[action]();
    });
    preview.play(); raf.tick(84);
    assert.equal(raf.pending.size, 0); assert.equal(preview.frame, action === 'seek' ? 4 : 1); preview.dispose(); raf.setTime(0);
  }
});

test('reentrant play from end owns only its replacement playback', t => {
  const raf = clock(t), { canvas } = recordingCanvas();
  const preview: TweenPreview = createTweenPreview(canvas, fixture(), new Map(), 0, 8, frame => { if (frame === 8) preview.play(); });
  preview.play(); raf.tick(1000); assert.equal(preview.frame, 0); assert.equal(raf.pending.size, 1);
  raf.tick(1084); assert.equal(preview.frame, 1); assert.equal(raf.pending.size, 1); preview.dispose();
});

test('callback failures stop playback and cannot leave an animation running', t => {
  const raf = clock(t), { canvas } = recordingCanvas();
  const preview = createTweenPreview(canvas, fixture(), new Map(), 0, 8, frame => { if (frame === 1) throw new Error('Owner failed'); });
  preview.play(); assert.throws(() => raf.tick(84), /Owner failed/);
  assert.equal(raf.pending.size, 0); assert.equal(preview.frame, 1); preview.dispose();
});

test('a cancelled callback cannot draw or clear a newer pending playback', t => {
  const raf = clock(t), frames: number[] = [], trace = recordingCanvas();
  const preview = createTweenPreview(trace.canvas, fixture(), new Map(), 0, 8, frame => frames.push(frame));
  preview.play(); const retired = [...raf.pending.values()][0]; preview.stop();
  preview.showFrame(4); raf.setTime(100); preview.play();
  const current = [...raf.pending], before = [...trace.calls]; retired(1000);
  assert.deepEqual([...raf.pending], current); assert.deepEqual(trace.calls, before); assert.deepEqual(frames, [0, 4]);
  raf.tick(184); assert.equal(preview.frame, 5); preview.dispose();
});

test('released borrowed bitmaps refuse before drawing and terminate the pending preview', t => {
  const raf = clock(t), trace = recordingCanvas(), project = fixture();
  const bitmap = { width: 20, height: 10 } as ImageBitmap;
  project.layers.push({ id: 'photo', name: 'Photo', kind: 'image', keys: fixture().layers[0].keys,
    image: { dataUrl: 'data:image/png;base64,AAAA', width: 20, height: 10 } });
  const preview = createTweenPreview(trace.canvas, project, new Map([['photo', bitmap]]), 0, 8, () => {});
  preview.play(); Object.assign(bitmap, { width: 0, height: 0 }); const before = [...trace.calls];
  assert.throws(() => raf.tick(84), /assets/i);
  assert.deepEqual(trace.calls, before); assert.equal(preview.frame, 0); assert.equal(raf.pending.size, 0); preview.dispose();
});
