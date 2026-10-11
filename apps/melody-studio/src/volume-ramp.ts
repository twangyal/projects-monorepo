import {MAX_COMPOSITION_BEATS} from './limits.ts';
import type {VolumeRamp} from './types.ts';

export const DEFAULT_VOLUME_RAMP: Readonly<VolumeRamp> = Object.freeze({start:0,end:4,from:1,to:0});

export function validateVolumeRamp(value: unknown): VolumeRamp {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) {
    throw new Error('Volume ramp must be a plain object.');
  }
  const keys = ['start','end','from','to'] as const;
  const supplied = Reflect.ownKeys(value);
  if (supplied.length !== keys.length || supplied.some(key => !keys.includes(key as typeof keys[number]))) {
    throw new Error('Volume ramp needs exactly start, end, from and to.');
  }
  const result = {} as VolumeRamp;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value,key);
    const max = key === 'start' || key === 'end' ? MAX_COMPOSITION_BEATS : 1;
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'number' || !Number.isFinite(descriptor.value) || descriptor.value < 0 || descriptor.value > max) {
      throw new Error(`Volume ramp ${key} must be a finite number from 0 to ${max}.`);
    }
    result[key] = descriptor.value;
  }
  if (result.end <= result.start) throw new Error('Volume ramp end beat must be after its start beat.');
  return result;
}

// End levels also apply before/after the interval. Beat zero is song time,
// so overlapping voices and delayed echoes share the same automation clock.
export function volumeRampLevel(ramp: Readonly<VolumeRamp>, beat: number): number {
  if (beat <= ramp.start) return ramp.from;
  if (beat >= ramp.end) return ramp.to;
  return ramp.from + (ramp.to - ramp.from) * ((beat - ramp.start) / (ramp.end - ramp.start));
}
