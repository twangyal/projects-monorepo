import { describe, expect, it } from 'vitest';
import { chooseTarget, DwellSelector, type Target } from './decision';

const targets: Target[] = [
  { id: 'read', label: 'Read article', rect: { x: 100, y: 100, width: 200, height: 80 } },
  { id: 'save', label: 'Save article', rect: { x: 420, y: 100, width: 100, height: 80 } },
];

describe('target decisions', () => {
  it('selects a nearby target and explains the choice', () => {
    const decision = chooseTarget({ x: 190, y: 140 }, targets);
    expect(decision.target?.id).toBe('read');
    expect(decision.reason).toMatch(/inside/i);
  });

  it('rejects distant, invalid and ambiguous signals', () => {
    expect(chooseTarget({ x: 900, y: 900 }, targets).target).toBeNull();
    expect(chooseTarget({ x: NaN, y: 140 }, targets).target).toBeNull();
    expect(chooseTarget({ x: 360, y: 140 }, targets).target).toBeNull();
    expect(chooseTarget({ x: 200, y: 140 }, [targets[0], { ...targets[0], id: 'overlap' }]).reason).toMatch(/ambiguous/i);
  });

  it('waits for a stable dwell without activating a target', () => {
    const selector = new DwellSelector(900);
    const decision = chooseTarget({ x: 200, y: 140 }, targets);
    expect(selector.update(decision, 0).ready).toBe(false);
    expect(selector.update(decision, 500).progress).toBeCloseTo(500 / 900);
    expect(selector.update(decision, 901).ready).toBe(true);
  });

  it('resets dwell on target changes, ambiguity and pause', () => {
    const selector = new DwellSelector(900);
    selector.update(chooseTarget({ x: 200, y: 140 }, targets), 0);
    expect(selector.update(chooseTarget({ x: 470, y: 140 }, targets), 1000).ready).toBe(false);
    expect(selector.update(chooseTarget({ x: 360, y: 140 }, targets), 2000).target).toBeNull();
    selector.reset();
    expect(selector.update(chooseTarget({ x: 200, y: 140 }, targets), 3000).ready).toBe(false);
  });
});
