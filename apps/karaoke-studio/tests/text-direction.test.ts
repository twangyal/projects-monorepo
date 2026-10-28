import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { textLayout } from '../src/text-direction.ts';

test('bidi layout agrees with the server on RTL, mixed scripts, numbers and marks', () => {
  const cases = JSON.parse(readFileSync(new URL('./text-direction.json', import.meta.url), 'utf8')) as [string, string, boolean][];
  for (const [text, direction, wholeLine] of cases) assert.deepEqual(textLayout(text), { direction, wholeLine }, text);
});
