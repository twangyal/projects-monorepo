import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTarget } from '../src/resolver.js';

test('resolves nested content only inside the allowed root', () => {
  const target = { disabled: false };
  const root = { contains: node => node === target };
  const doc = { elementFromPoint: () => ({ closest: () => target }) };
  assert.equal(resolveTarget(doc, root, 20, 40), target);
  assert.equal(resolveTarget(doc, { contains: () => false }, 20, 40), null);
  target.disabled = true;
  assert.equal(resolveTarget(doc, root, 20, 40), null);
});

test('rejects invalid coordinates before hit testing and empty space', () => {
  const doc = { elementFromPoint: () => { throw new Error('must not hit test'); } };
  for (const point of [[NaN, 0], [0, Infinity], [-1, 2], [2, -1]]) {
    assert.equal(resolveTarget(doc, {}, ...point), null);
  }
  assert.equal(resolveTarget({ elementFromPoint: () => null }, {}, 2, 3), null);
  assert.equal(resolveTarget({ elementFromPoint: () => ({}) }, {}, 2, 3), null);
});
