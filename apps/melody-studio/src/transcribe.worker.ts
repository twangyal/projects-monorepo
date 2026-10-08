import { transcribe } from './audio.ts';

self.onmessage = (event: MessageEvent<{ samples: Float32Array; sampleRate: number; tempo: number }>) => {
  try {
    const { samples, sampleRate, tempo } = event.data;
    self.postMessage({ result: transcribe(samples, sampleRate, tempo) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Could not detect this melody.' });
  }
};
