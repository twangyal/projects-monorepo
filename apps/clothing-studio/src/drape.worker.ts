import { simulateDrape, type FabricKind } from './drape.ts';
import type { SkirtDraft } from './construction.ts';
import type { BodyMeasurements } from './body-fitting.ts';

/** One simulation per worker; the owner terminates it to cancel. */
self.onmessage = (event: MessageEvent<{ construction: SkirtDraft; fabric: FabricKind; body?: BodyMeasurements }>) => {
  try {
    const { construction, fabric, body } = event.data;
    const result = simulateDrape(construction, fabric, body, { progress: (frame, frames) => { if (frame % 20 === 0) self.postMessage({ kind: 'progress', frame, frames }); } });
    self.postMessage({ kind: 'result', result }, { transfer: [result.positions.buffer] });
  } catch (error) {
    self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : 'The drape simulation failed.' });
  }
};
