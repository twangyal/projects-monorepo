import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-wasm-binary?url';
import { decodePhoto } from './images.ts';
import { modelInput, photoDepth } from './depth-estimate.ts';
import type { PhotoAsset } from './types.ts';

/** One estimate per worker; the owner terminates it to cancel. Nothing leaves this browser. */
const scope = self as unknown as {
  name?: string;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: unknown, transfer?: Transferable[]): void;
  crossOriginIsolated?: boolean;
};
let received = false;
// With threads, onnxruntime starts helper workers from this same bundled script ("em-pthread");
// they belong to the runtime and must keep its own message handler.
if (!scope.name?.startsWith('em-pthread')) {
  scope.onmessage = event => {
    if (received) return;
    received = true;
    void estimate(event.data);
  };
}

async function estimate(value: unknown): Promise<void> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request.');
    const { model, photo } = value as { model?: unknown; photo?: unknown };
    if (!(model instanceof Blob) || !photo || typeof photo !== 'object') throw new Error('Invalid request.');
    const asset = photo as PhotoAsset;
    scope.postMessage({ kind: 'stage', stage: 'model' });
    ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, self.location.href).href };
    // Threads need cross-origin isolation (COOP/COEP); otherwise one thread is used.
    ort.env.wasm.numThreads = scope.crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)) : 1;
    ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(new Uint8Array(await model.arrayBuffer()), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    const raster = await decodePhoto(asset);
    const input = modelInput(raster);
    scope.postMessage({ kind: 'stage', stage: 'infer', threads: ort.env.wasm.numThreads });
    const started = performance.now();
    const outputs = await session.run({ [session.inputNames[0]!]: new ort.Tensor('float32', input.data, [1, 3, input.height, input.width]) });
    const seconds = (performance.now() - started) / 1000;
    const output = outputs[session.outputNames[0]!];
    if (!output || output.type !== 'float32' || output.dims.length !== 3 || output.dims[0] !== 1) throw new Error('The depth model returned an unexpected output.');
    const [, height, width] = output.dims as [number, number, number];
    const depth = photoDepth(output.data as Float32Array, width, height, raster.width, raster.height);
    void session.release();
    scope.postMessage({ kind: 'depth', width: raster.width, height: raster.height, values: depth, seconds, threads: ort.env.wasm.numThreads }, [depth.buffer]);
  } catch (error) {
    scope.postMessage({ kind: 'error', message: error instanceof Error && /depth|model|photo/i.test(error.message) ? error.message : 'Depth estimation failed in this browser.' });
  }
}
