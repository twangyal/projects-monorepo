import type { ReverbBus } from './types.ts';

/** Validation for the stereo mix fields; kept apart from the renderer so the model stays light. */
export const DEFAULT_REVERB: Readonly<ReverbBus> = Object.freeze({ size: 0.5, level: 0.5 });

function plainNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be a finite number from ${min} to ${max}.`);
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-9) throw new Error(`${label} uses at most two decimals.`);
  return value;
}
export function validatePan(value: unknown): number { return plainNumber(value, 'Pan', -1, 1); }
export function validateSend(value: unknown): number { return plainNumber(value, 'Reverb send', 0, 1); }
export function validateReverb(value: unknown): ReverbBus {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Reverb bus must be a plain object.');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || keys.some(key => key !== 'size' && key !== 'level')) throw new Error('Reverb bus needs exactly size and level.');
  const field = (key: 'size' | 'level'): number => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) throw new Error('Reverb bus cannot contain accessors.');
    return plainNumber(descriptor.value, key === 'size' ? 'Reverb size' : 'Reverb level', 0, 1);
  };
  return { size: field('size'), level: field('level') };
}

