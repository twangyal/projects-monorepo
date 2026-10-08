import { HEIGHT, WIDTH, validateProject } from './model.ts';
import { createFrameRenderer, closeAssets, loadAssets, type Assets } from './render.ts';
import { createPngArchive, MAX_FRAME_PNG_BYTES } from './png-archive.ts';

const scope = self as unknown as { onmessage: ((event: MessageEvent<unknown>) => void) | null; postMessage(value: unknown, transfer?: Transferable[]): void; close(): void };
let started = false;
scope.onmessage = event => { if (started) return; started = true; void encode(event.data); };
async function encode(request: unknown): Promise<void> {
  let assets: Assets = new Map(), canvas: OffscreenCanvas | undefined;
  try {
    if (!request || typeof request !== 'object' || (request as { type?: unknown }).type !== 'start') throw new Error('Invalid PNG archive request.');
    const project = validateProject((request as { project?: unknown }).project);
    assets = await loadAssets(project);
    const renderer = createFrameRenderer(project, assets), archive = createPngArchive(project);
    canvas = new OffscreenCanvas(WIDTH, HEIGHT);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot render animation frames in a worker.');
    for (let frame = 0; frame < renderer.frameCount; frame++) {
      renderer.render(context, frame);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      if (blob.type !== 'image/png' || !blob.size || blob.size > MAX_FRAME_PNG_BYTES) throw new Error('PNG frame exceeds the 1 MiB limit or could not be encoded.');
      archive.addFrame(new Uint8Array(await blob.arrayBuffer()));
      scope.postMessage({ type: 'progress', fraction: (frame + 1) / renderer.frameCount });
    }
    const bytes = archive.finish(), buffer = bytes.buffer;
    scope.postMessage({ type: 'complete', buffer }, [buffer]);
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message.slice(0, 300) : 'PNG archive export failed.' });
  } finally {
    try { closeAssets(assets); if (canvas) canvas.width = canvas.height = 0; }
    finally { scope.close(); }
  }
}
