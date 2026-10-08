import type { SoundEnvelope } from './types.ts';

export const DEFAULT_ENVELOPE: Readonly<SoundEnvelope> = Object.freeze({ attack: .01, decay: 0, sustain: 1, release: .08 });
export const ENVELOPE_KEYS = ['attack', 'decay', 'sustain', 'release'] as const;

export function validateEnvelope(value: unknown): SoundEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Sound envelope must be a plain object.');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 4 || keys.some(key => !ENVELOPE_KEYS.includes(key as typeof ENVELOPE_KEYS[number]))) throw new Error('Sound envelope needs exactly attack, decay, sustain and release.');
  const result = {} as SoundEnvelope;
  for (const key of ENVELOPE_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'number' || !Number.isFinite(descriptor.value)
      || descriptor.value < 0 || descriptor.value > (key === 'sustain' ? 1 : 2)) throw new Error(`Sound ${key} must be a finite number from 0 to ${key === 'sustain' ? 1 : 2}.`);
    result[key] = descriptor.value;
  }
  return result;
}

/** Linear ADSR; note-off starts release at the held envelope's actual level. */
export function envelopeLevel(frame: number, duration: number, attack: number, decay: number, sustain: number, release: number): number {
  const at = Math.min(frame, duration);
  const held = attack > 0 && at < attack ? at / attack
    : decay > 0 && at < attack + decay ? 1 - (1 - sustain) * (at - attack) / decay : sustain;
  return frame <= duration ? held : release > 0 ? held * Math.max(0, 1 - (frame - duration) / release) : 0;
}
