import test from 'node:test';
import assert from 'node:assert/strict';
import { switchOutfitEditing } from '../src/outfit-edit.ts';
import { createProject, validateProject } from '../src/model.ts';
import { template } from '../src/product.ts';

test('switching outfit editing preserves the complete independent garments and shared body', () => {
  const top = template('blank'), bottom = template('trousers');
  top.spec = { styleNumber: 'TEE', season: 'Summer', sampleSize: 'L' }; bottom.spec = { styleNumber: 'PANT', season: 'Summer', sampleSize: 'S' };
  const project = validateProject({ ...createProject(), product: top, wornWith: bottom, topBody: { chest: 100, waist: 82, hip: 102, chestDepth: 24, height: 178, hipDepth: 20 } });
  const before = structuredClone(project), next = switchOutfitEditing(project);
  assert.deepEqual(next.product, project.wornWith); assert.deepEqual(next.wornWith, project.product);
  assert.deepEqual(next.topBody, project.topBody); assert.deepEqual(switchOutfitEditing(next), project);
  next.product!.parts.front.color = '#123456';
  assert.deepEqual(project, before); assert.notEqual(next.product!.parts.front.color, project.wornWith!.parts.front.color);
});

test('switching refuses missing or incompatible outfit members without creating a primary', () => {
  for (const input of [createProject(), { ...createProject(), wornWith: template('trousers') }, { ...createProject(), product: template('blank') }, { ...createProject(), product: template('blank'), wornWith: template('ringer') }]) {
    const before = structuredClone(input); assert.throws(() => switchOutfitEditing(input)); assert.deepEqual(input, before);
  }
});
