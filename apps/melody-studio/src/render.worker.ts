import { renderComposition } from './audio.ts';
import { validateComposition, compositionDurationBeats } from './model.ts';
import { encodeWav, encodeWavChannels } from './wav.ts';
import { renderMix } from './mix.ts';
import { cropSection, sectionWindow, type SectionRange } from './section.ts';
import type { Composition } from './types.ts';

self.onmessage = (event: MessageEvent<{ project: Composition; wav: boolean; section?: SectionRange; mix?: boolean }>) => {
  try {
    const project = validateComposition(event.data.project);
    if (event.data.mix) {
      // The song mix: mono when no track uses pan or sends, otherwise stereo with the reverb bus.
      let channels = renderMix(project, 22050);
      if (event.data.section) {
        const { start, end } = event.data.section;
        const window = sectionWindow(start, end, project.tempo, compositionDurationBeats(project), 22050);
        channels = channels.map(channel => cropSection(channel, window));
      }
      if (event.data.wav) {
        const result = encodeWavChannels(channels, 22050);
        self.postMessage({ result }, { transfer: [result.buffer] });
      } else self.postMessage({ result: channels }, { transfer: channels.map(channel => channel.buffer) });
      return;
    }
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
