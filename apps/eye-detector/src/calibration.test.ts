import { describe, expect, it } from 'vitest';
import { eyeFeatures, fitCalibration, predictGaze, type Sample } from './calibration';

function samples(): Sample[] {
  return [0.1, 0.5, 0.9].flatMap(x => [0.1, 0.5, 0.9].flatMap(y =>
    Array.from({ length: 5 }, () => ({ features: [x, y, 0.5, 0.5], point: { x, y } })),
  ));
}

describe('calibration', () => {
  it('maps eye features to a held-out screen position', () => {
    const model = fitCalibration(samples());
    expect(predictGaze(model, [0.32, 0.67, 0.5, 0.5])?.x).toBeCloseTo(0.32, 2);
    expect(predictGaze(model, [0.32, 0.67, 0.5, 0.5])?.y).toBeCloseTo(0.67, 2);
    expect(model.error).toBeLessThan(0.01);
  });

  it('rejects constant features instead of claiming successful calibration', () => {
    expect(() => fitCalibration(samples().map(s => ({ ...s, features: [0.5, 0.5, 0.5, 0.5] })))).toThrow(/movement/i);
  });

  it('requires nine distinct calibration points with enough observations', () => {
    expect(() => fitCalibration(samples().slice(0, 8))).toThrow(/nine/i);
    expect(() => fitCalibration(samples().map(s => ({ ...s, point: { x: 0.5, y: 0.5 } })))).toThrow(/nine/i);
  });

  it('rejects non-finite observations and an inconsistent feature count', () => {
    const invalid = samples();
    invalid[0].features[0] = NaN;
    expect(() => fitCalibration(invalid)).toThrow(/invalid/i);
    expect(() => fitCalibration(samples().map(s => ({ ...s, features: [1] })))).toThrow(/invalid/i);
  });

  it('rejects invalid and far-off-screen predictions', () => {
    const model = fitCalibration(samples());
    expect(predictGaze(model, [NaN, 1, 1, 1])).toBeNull();
    expect(predictGaze(model, [5, 5, 0.5, 0.5])).toBeNull();
  });

  it('rejects incomplete face data and closed eyes', () => {
    expect(eyeFeatures([])).toBeNull();
    expect(eyeFeatures(Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 })))).toBeNull();
  });

  it('extracts finite iris features from an open-eye mesh', () => {
    const mesh = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    for (const [a, b, top, bottom, iris] of [[33, 133, 159, 145, 468], [362, 263, 386, 374, 473]]) {
      mesh[a] = { x: 0.3, y: 0.5 };
      mesh[b] = { x: 0.7, y: 0.5 };
      mesh[top] = { x: 0.5, y: 0.45 };
      mesh[bottom] = { x: 0.5, y: 0.55 };
      mesh[iris] = { x: 0.55, y: 0.51 };
    }
    const features = eyeFeatures(mesh);
    expect(features).not.toBeNull();
    expect(features?.[0]).toBeCloseTo(0.625);
    expect(features?.[1]).toBeCloseTo(0.6);
  });
});
