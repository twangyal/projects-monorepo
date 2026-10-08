export type Instrument = 'sine' | 'triangle' | 'sawtooth';
export interface Note {
  id: string;
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
}
export interface SoundEnvelope { attack: number; decay: number; sustain: number; release: number }
export interface SoundFilter { cutoff: number; resonance: number }
export interface Track {
  id: string;
  name: string;
  instrument: Instrument;
  volume: number;
  muted: boolean;
  envelope?: SoundEnvelope;
  filter?: SoundFilter;
  notes: Note[];
}
export interface Composition {
  version: 1;
  title: string;
  tempo: number;
  tracks: Track[];
}
