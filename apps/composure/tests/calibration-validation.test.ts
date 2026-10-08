import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrate } from '../src/model.ts';

test('calibration rejects entirely sparse five-slot arrays', () => {
  assert.throws(() => calibrate(new Array<number>(5)));
});

test('calibration rejects a missing own reading even when other readings are valid', () => {
  const readings = [68, 70, 72, 70, 70];
  delete readings[2];
  assert.throws(() => calibrate(readings));
});

test('inherited numeric entries cannot stand in for an actual calibration reading', () => {
  const readings = [68, 70, 72, 70, 70];
  delete readings[2];
  const inherited = Object.create(Array.prototype) as number[];
  Object.defineProperty(inherited, '2', { value: 72 });
  Object.setPrototypeOf(readings, inherited);
  assert.equal(readings[2], 72);
  assert.equal(Object.hasOwn(readings, '2'), false);
  assert.throws(() => calibrate(readings));
});

test('five own finite readings retain the exact mean and do not mutate the input', () => {
  for (const readings of [[40, 40, 40, 40, 40], [120, 120, 120, 120, 120], [68, 70, 72, 70, 70], [60, 63, 66, 69, 72]]) {
    const before = [...readings];
    assert.equal(calibrate(readings), readings.reduce((sum, value) => sum + value, 0) / 5);
    assert.deepEqual(readings, before);
  }
  for (const value of [undefined, NaN, Infinity, -Infinity, '70', 39, 121]) {
    assert.throws(() => calibrate([70, 70, value, 70, 70] as number[]));
  }
});
