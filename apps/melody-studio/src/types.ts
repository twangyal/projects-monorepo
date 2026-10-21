/** `drums` plays each note's pitch as a General MIDI percussion key. */
export type Instrument = 'sine' | 'triangle' | 'sawtooth' | 'drums';
export interface Note {
  id: string;
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
}
export interface SoundEnvelope { attack: number; decay: number; sustain: number; release: number }
export interface SoundFilter { cutoff: number; resonance: number }
export interface SoundEcho { beats: number; decay: number; repeats: number }
export interface VolumeRamp { start: number; end: number; from: number; to: number }
export type VolumeCurve = {beat:number;level:number}[];
/** Each level is a stereo position: −1 left, 0 centre, +1 right. */
export type PanCurve = VolumeCurve;
export interface Track {
  id: string;
  name: string;
  instrument: Instrument;
  volume: number;
  muted: boolean;
  harmonics?: number[];
  envelope?: SoundEnvelope;
  filter?: SoundFilter;
  echo?: SoundEcho;
  volumeRamp?: VolumeRamp;
  volumeCurve?: VolumeCurve;
  /** -1 (left) to +1 (right); absent means centred. */
  pan?: number;
  /** Overrides static pan while present; follows absolute song time. */
  panCurve?: PanCurve;
  /** 0–1 share of the track sent to the shared reverb bus; absent means none. */
  reverbSend?: number;
  notes: Note[];
}
export interface ReverbBus { size: number; level: number }
export interface Composition {
  version: 1;
  title: string;
  tempo: number;
  tracks: Track[];
  /** Shared reverb bus settings; absent means the defaults. */
  reverb?: ReverbBus;
}
