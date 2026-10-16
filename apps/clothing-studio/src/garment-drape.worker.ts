import Delaunator from 'delaunator';
import { simulateGarment,type TopBodyShape } from './garment-drape.ts';
import { teeMesh, validateProduct, type Product } from './product.ts';

/** One garment drape per worker; the owner terminates it to cancel or when the design changes. */
self.onmessage = (event: MessageEvent<{ product: Product; bodyChest: number; bodyShape?:TopBodyShape }>) => {
  try {
    const product = validateProduct(event.data.product);
    const result = simulateGarment(product, teeMesh(product, Delaunator), event.data.bodyChest, {
      bodyShape:event.data.bodyShape,
      progress: (frame, frames) => { if (frame % 15 === 0) self.postMessage({ kind: 'progress', frame, frames }); },
    });
    self.postMessage({ kind: 'result', result }, { transfer: result.parts.map(part => part.positions.buffer as ArrayBuffer) });
  } catch (error) {
    self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : 'The drape simulation failed.' });
  }
};
