import Delaunator from 'delaunator';
import { drapeTest } from './drape-test.ts';
import { material } from './product.ts';

/** One fabric drape test per worker; the owner terminates it to cancel. */
self.onmessage = (event: MessageEvent<{ materialId: string }>) => {
  try {
    const result = drapeTest(material(event.data.materialId), Delaunator, {
      progress: (frame, frames) => { if (frame % 30 === 0) self.postMessage({ kind: 'progress', frame, frames }); },
    });
    self.postMessage({ kind: 'result', result });
  } catch (error) {
    self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : 'The drape test failed.' });
  }
};
