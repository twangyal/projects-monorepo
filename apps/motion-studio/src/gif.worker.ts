import { GIFEncoder } from 'gifenc';
import { FPS, HEIGHT, WIDTH, validateProject } from './model.ts';
import { closeAssets, loadAssets, createFrameRenderer, type Assets } from './render.ts';

const MAX_BYTES = 32 * 1024 * 1024;
const PALETTE = Array.from({ length: 256 }, (_, index) => [
  Math.round((index >> 5) * 255 / 7),
  Math.round(((index >> 2) & 7) * 255 / 7),
  (index & 3) * 85,
]);

// Keep the main project's DOM types: importing lib.webworker alongside lib.dom
// would declare conflicting globals. This is the actual module worker scope.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: unknown, transfer?: Transferable[]): void;
  close(): void;
};
let started = false;
scope.onmessage = event => {
  if (started) return;
  started = true;
  void encode(event.data);
};

async function encode(value: unknown): Promise<void> {
  let assets: Assets = new Map();
  let canvas: OffscreenCanvas | undefined;
  try {
    if (!value || typeof value !== 'object' || (value as { type?: unknown }).type !== 'start') {
      throw new Error('Invalid GIF export request.');
    }
    const project = validateProject((value as { project?: unknown }).project);
    assets = await loadAssets(project);
    canvas = new OffscreenCanvas(WIDTH, HEIGHT);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('This browser does not support worker canvas rendering.');
    const renderer = createFrameRenderer(project, assets);
    const encoder = GIFEncoder();
    const indexed = new Uint8Array(WIDTH * HEIGHT);
    for (let frame = 0; frame < renderer.frameCount; frame++) {
      renderer.render(context, frame);
      const rgba = context.getImageData(0, 0, WIDTH, HEIGHT).data;
      for (let pixel = 0, offset = 0; pixel < indexed.length; pixel++, offset += 4) {
        indexed[pixel] = (rgba[offset] & 224) | ((rgba[offset + 1] & 224) >> 3) | (rgba[offset + 2] >> 6);
      }
      // Rounded cumulative timestamps distribute 8/9-centisecond frames without
      // drift; gifenc accepts milliseconds and writes GIF centisecond delays.
      const delay = (Math.round((frame + 1) * 100 / FPS) - Math.round(frame * 100 / FPS)) * 10;
      encoder.writeFrame(indexed, WIDTH, HEIGHT, {
        palette: frame === 0 ? PALETTE : undefined, delay, repeat: 0, dispose: 1,
      });
      if (encoder.bytesView().byteLength > MAX_BYTES) throw new Error('GIF export exceeds the 32 MiB output limit.');
      scope.postMessage({ type: 'progress', fraction: (frame + 1) / renderer.frameCount });
    }
    encoder.finish();
    const bytes = encoder.bytesView();
    if (bytes.byteLength > MAX_BYTES) throw new Error('GIF export exceeds the 32 MiB output limit.');
    const buffer = Uint8Array.from(bytes).buffer;
    scope.postMessage({ type: 'complete', buffer }, [buffer]);
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message.slice(0, 300) : 'GIF export failed.' });
  } finally {
    try {
      closeAssets(assets);
      if (canvas) canvas.width = canvas.height = 0;
    } finally {
      scope.close();
    }
  }
}
