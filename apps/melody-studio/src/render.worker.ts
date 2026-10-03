import { renderComposition } from './audio.ts';
import { validateComposition } from './model.ts';
import { encodeWav } from './wav.ts';
import type { Composition } from './types.ts';

self.onmessage = (event: MessageEvent<{ project: Composition; wav: boolean }>) => {
  try {
    const samples = renderComposition(validateComposition(event.data.project), 22050);
    const result = event.data.wav ? encodeWav(samples, 22050) : samples;
    self.postMessage({ result }, { transfer: [result.buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Could not render this composition.' });
  }
};
