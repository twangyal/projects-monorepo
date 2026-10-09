import type {SoundEcho} from './types.ts';

export const DEFAULT_ECHO: Readonly<SoundEcho> = Object.freeze({beats:1,decay:.5,repeats:3});
export function validateEcho(value: unknown): SoundEcho {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw new Error('Sound echo must be a plain object.');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 3 || keys.some(key => !['beats','decay','repeats'].includes(String(key)))) throw new Error('Sound echo needs exactly beats, decay and repeats.');
  const result = {} as SoundEcho;
  for (const key of ['beats','decay','repeats'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(value,key), min = key === 'beats' ? .25 : key === 'decay' ? .05 : 1, max = key === 'beats' ? 4 : key === 'decay' ? .95 : 8;
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'number' || !Number.isFinite(descriptor.value) || descriptor.value < min || descriptor.value > max || key === 'repeats' && !Number.isInteger(descriptor.value)) throw new Error(`Echo ${key} must be ${key === 'repeats' ? 'an integer' : 'a finite number'} from ${min} to ${max}.`);
    result[key] = descriptor.value;
  }
  return result;
}
