import Delaunator from 'delaunator';
import { simulateGarment, simulateOutfit, type TopBodyShape } from './garment-drape.ts';
import { layerOrder, sleeveAngleOf, teeMesh, validateProduct, withSleeveAngle, type Product } from './product.ts';

/** One garment drape per worker; the owner terminates it to cancel or when the design changes. */
self.onmessage = (event: MessageEvent<{ product: Product; companion?: Product; tucked?: boolean; bodyChest: number; bodyShape?:TopBodyShape }>) => {
  try {
    let product = validateProduct(event.data.product), companion = event.data.companion ? validateProduct(event.data.companion) : null;
    // A top worn under another is made for the outer one's arm pose.
    const layers = companion && layerOrder(product, companion);
    if (layers) {
      const posed = withSleeveAngle(layers.inner, sleeveAngleOf(layers.outer));
      if (layers.inner === product) product = posed; else companion = posed;
    }
    const options = {
      bodyShape:event.data.bodyShape,
      progress: (frame: number, frames: number) => { if (frame % 15 === 0) self.postMessage({ kind: 'progress', frame, frames }); },
    };
    const result = companion ? simulateOutfit(product, teeMesh(product, Delaunator), companion, teeMesh(companion, Delaunator), event.data.bodyChest, { ...options, tucked: event.data.tucked === true })
      : simulateGarment(product, teeMesh(product, Delaunator), event.data.bodyChest, options);
    const parts = [...result.parts, ...result.companion?.parts ?? []];
    self.postMessage({ kind: 'result', result }, { transfer: parts.map(part => part.positions.buffer as ArrayBuffer) });
  } catch (error) {
    self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : 'The drape simulation failed.' });
  }
};
