import { renderComposition } from './audio.ts';
import { validateComposition, compositionDurationBeats } from './model.ts';
import { encodeWav } from './wav.ts';
import { cropSection, sectionWindow, type SectionRange } from './section.ts';
import type { Composition } from './types.ts';

self.onmessage = (event: MessageEvent<{ project: Composition; wav: boolean; section?: SectionRange }>) => {
  try {
    const project = validateComposition(event.data.project);
    let samples = renderComposition(project, 22050);
    if (event.data.section) {
      const { start, end } = event.data.section;
      samples = cropSection(samples, sectionWindow(start, end, project.tempo, compositionDurationBeats(project), 22050));
    }
    const result = event.data.wav ? encodeWav(samples, 22050) : samples;
    self.postMessage({ result }, { transfer: [result.buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Could not render this composition.' });
  }
};
