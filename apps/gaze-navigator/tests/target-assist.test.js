import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSIST_RADIUS, distanceToRect, resolveAssistedTarget } from '../src/target-assist.js';

function target(id, left, top, width = 100, height = 50) {
  const node = {
    id, disabled: false, dataset: {},
    getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }),
    contains: other => other === node,
    closest: () => node,
  };
  return node;
}

// A tiny page: targets are hit where their rectangles are, unless an overlay covers that point.
function page(targets, overlays = []) {
  const blank = { closest: () => null };
  const inside = (rect, x, y) => x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height;
  const document = {
    elementFromPoint(x, y) {
      if (overlays.some(rect => inside(rect, x, y))) return blank;
      return targets.find(node => inside(node.getBoundingClientRect(), x, y)) ?? blank;
    },
  };
  const root = { contains: node => targets.includes(node), querySelectorAll: () => targets };
  return { document, root };
}

const STANDARD = { radius: ASSIST_RADIUS.standard };

test('distance to a rectangle is zero inside and euclidean outside', () => {
  const rect = { left: 10, top: 10, width: 100, height: 50 };
  assert.equal(distanceToRect(50, 30, rect), 0);
  assert.equal(distanceToRect(0, 30, rect), 10);
  assert.equal(distanceToRect(113, 64, rect), 5);
});

test('direct hits win and are not marked as assisted', () => {
  const a = target('a', 0, 0);
  const { document, root } = page([a]);
  assert.deepEqual(resolveAssistedTarget(document, root, 50, 25, STANDARD), { target: a, assisted: false, ambiguous: false });
});

test('a nearby unique target is assisted within the radius only', () => {
  const a = target('a', 100, 100);
  const { document, root } = page([a]);
  const near = resolveAssistedTarget(document, root, 150, 190, STANDARD);
  assert.equal(near.target, a);
  assert.equal(near.assisted, true);
  assert.equal(resolveAssistedTarget(document, root, 150, 200, STANDARD).target, null, '50 px is beyond standard');
  assert.equal(resolveAssistedTarget(document, root, 150, 200, { radius: ASSIST_RADIUS.wide }).target, a);
  assert.equal(resolveAssistedTarget(document, root, 150, 160, { radius: ASSIST_RADIUS.off }).target, null, 'off is exact only');
});

test('similarly close targets abstain while a clearly closer one is chosen', () => {
  const a = target('a', 0, 0);
  const b = target('b', 0, 100);
  const { document, root } = page([a, b]);
  const between = resolveAssistedTarget(document, root, 50, 75, STANDARD);
  assert.deepEqual(between, { target: null, assisted: false, ambiguous: true });
  assert.equal(resolveAssistedTarget(document, root, 50, 60, STANDARD).target, a, '10 px versus 40 px');
});

test('disabled, hidden, ineligible and covered targets are never suggested', () => {
  const disabled = target('disabled', 0, 0);
  disabled.disabled = true;
  const hidden = target('hidden', 0, 0, 0, 0);
  const ineligible = target('ineligible', 200, 0);
  const covered = target('covered', 400, 0);
  const { document, root } = page([disabled, hidden, ineligible, covered], [{ left: 380, top: 0, width: 200, height: 60 }]);
  assert.equal(resolveAssistedTarget(document, root, 50, 70, STANDARD).target, null);
  assert.equal(resolveAssistedTarget(document, root, 250, 70, { ...STANDARD, eligible: node => node !== ineligible }).target, null);
  assert.equal(resolveAssistedTarget(document, root, 450, 70, STANDARD).target, null);
  const direct = resolveAssistedTarget(document, root, 250, 25, { ...STANDARD, eligible: node => node !== ineligible });
  assert.equal(direct.target, null, 'a direct hit on an ineligible control does not fall back to a neighbor');
});

test('hysteresis keeps the current target just outside the radius and against a slightly closer rival', () => {
  const a = target('a', 0, 0);
  const alone = page([a]);
  assert.equal(resolveAssistedTarget(alone.document, alone.root, 50, 105, STANDARD).target, null, '55 px without a current target');
  assert.equal(resolveAssistedTarget(alone.document, alone.root, 50, 105, { ...STANDARD, current: a }).target, a, 'within radius + 12 px');
  assert.equal(resolveAssistedTarget(alone.document, alone.root, 50, 115, { ...STANDARD, current: a }).target, null, 'beyond radius + 12 px');
  const b = target('b', 0, 120);
  const { document, root } = page([a, b]);
  assert.equal(resolveAssistedTarget(document, root, 50, 90, { ...STANDARD, current: a }).target, a, '40 px versus 30 px stays put');
  assert.equal(resolveAssistedTarget(document, root, 50, 110, { ...STANDARD, current: a }).target, b, 'a 50 px advantage switches');
});

test('invalid coordinates resolve to nothing without hit testing', () => {
  const document = { elementFromPoint: () => { throw new Error('must not hit test'); } };
  const root = { querySelectorAll: () => { throw new Error('must not scan'); } };
  for (const point of [[NaN, 0], [0, Infinity], [-1, 5]]) {
    assert.equal(resolveAssistedTarget(document, root, ...point, STANDARD).target, null);
  }
});
