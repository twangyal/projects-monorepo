import assert from 'node:assert/strict';
import test from 'node:test';
import { layerBounds, renderFrame } from '../src/render.ts';
import { createDrawingLayer, type ImageLayer } from '../src/model.ts';
test('drawing geometry includes rounded stroke extent and handles empty drawings', () => {
  const layer = createDrawingLayer();
  assert.deepEqual(layerBounds(layer), { width: 1, height: 1 });
  layer.strokes = [{ color: '#FF0000', width: 10, points: [{ x: -20, y: 5 }, { x: 40, y: 15 }] }];
  assert.deepEqual(layerBounds(layer), { width: 70, height: 20 });
  layer.keys.push({ ...layer.keys[0], frame: 95 });
  assert.equal(layerBounds(layer).width, 70);
});
test('image geometry fits 320 by 240 and never enlarges small images', () => {
  const base = createDrawingLayer();
  const layer: ImageLayer = { ...base, kind: 'image', image: { dataUrl: 'data:image/png;base64,AAAA', width: 800, height: 400 } };
  assert.deepEqual(layerBounds(layer), { width: 320, height: 160 });
  layer.image.width = 400; layer.image.height = 800;
  assert.deepEqual(layerBounds(layer), { width: 120, height: 240 });
  layer.image.width = 20; layer.image.height = 10;
  assert.deepEqual(layerBounds(layer), { width: 20, height: 10 });
});
test('public geometry and render reject invalid values before drawing', () => {
  const layer = createDrawingLayer(); layer.keys[0].scale = NaN;
  assert.throws(() => layerBounds(layer), /Scale/);
  const context = {} as CanvasRenderingContext2D;
  const project = { schemaVersion: 1 as const, title: 'Test', background: '#FFFFFF', frameCount: 12, layers: [] };
  assert.throws(() => renderFrame(context, project, NaN, new Map()), /frame/i);
  assert.throws(() => renderFrame(context, project, 12, new Map()), /frame/i);
});
