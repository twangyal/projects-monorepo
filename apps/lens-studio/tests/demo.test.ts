import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoProject } from '../src/demo.ts';

test('pre-aborted demo rejects AbortError before any browser drawing', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createDemoProject(controller.signal), { name: 'AbortError' });
});

test('demo without Canvas support reports actionable browser requirement', async () => {
  await assert.rejects(createDemoProject(), /canvas.*chromium/i);
});
